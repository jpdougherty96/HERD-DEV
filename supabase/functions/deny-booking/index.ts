// supabase/functions/deny-booking/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getStripe } from "../_shared/stripe.ts";
import { createAdminClient } from "../_shared/supabase.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const stripe = getStripe(STRIPE_SECRET_KEY, Stripe);
const admin = createAdminClient();

serve(async (_req: Request) => {
  const cors = corsHeaders(_req, "POST, OPTIONS");
  const preflight = handleCors(_req, "POST, OPTIONS");
  if (preflight) return preflight;
  if (_req.method !== "POST")
    return new Response("Method Not Allowed", { status: 405, headers: cors });

  try {
    const auth = await requireAuth(_req);
    if ("error" in auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { booking_id, message } = await _req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "Missing booking_id" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: b, error } = await admin
      .from("bookings")
      .select(
        "id, status, payment_status, stripe_payment_intent_id, stripe_checkout_session_id, stripe_refund_id, class_id",
      )
      .eq("id", booking_id)
      .single();

    if (error || !b) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (b.status !== "PENDING") {
      return new Response(JSON.stringify({ error: "Not deniable" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: cls, error: clsErr } = await admin
      .from("classes")
      .select("id, host_id")
      .eq("id", b.class_id)
      .single();

    if (clsErr || !cls) {
      return new Response(JSON.stringify({ error: "Class not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (cls.host_id !== auth.user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let paymentIntentId = b.stripe_payment_intent_id ?? null;
    if (!paymentIntentId && b.stripe_checkout_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(b.stripe_checkout_session_id, {
          expand: ["payment_intent"],
        });
        paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null;
        if (paymentIntentId) {
          await admin
            .from("bookings")
            .update({
              stripe_payment_intent_id: paymentIntentId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", booking_id);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[deny-booking] Checkout session lookup failed:", message);
      }
    }

    let refundId = b.stripe_refund_id ?? null;
    let nextPaymentStatus: "REFUNDED" | "FAILED" | "PENDING" = "FAILED";

    if (b.payment_status === "REFUNDED" || refundId) {
      nextPaymentStatus = "REFUNDED";
    } else if (paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (pi.status === "requires_capture") {
          await stripe.paymentIntents.cancel(paymentIntentId);
          nextPaymentStatus = "FAILED";
        } else if (pi.status === "succeeded") {
          const refund = await stripe.refunds.create(
            { payment_intent: paymentIntentId },
            { idempotencyKey: `deny_${booking_id}` },
          );
          refundId = refund.id;
          nextPaymentStatus = "REFUNDED";
        } else {
          nextPaymentStatus = "FAILED";
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[deny-booking] PaymentIntent handling failed:", message);
        nextPaymentStatus = "FAILED";
      }
    }

    // Update booking record
    const { error: updateErr } = await admin
      .from("bookings")
      .update({
        status: "DENIED",
        payment_status: nextPaymentStatus,
        denied_at: new Date().toISOString(),
        host_message: message ? String(message) : null,
        stripe_refund_id: refundId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_id);

    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[deny-booking]", e);
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
