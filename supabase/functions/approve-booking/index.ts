import { serve } from "https://deno.land/std/http/server.ts";
import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getStripe } from "../_shared/stripe.ts";
import { createAdminClient } from "../_shared/supabase.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const HERD_FEE_RATE = Number(Deno.env.get("HERD_FEE_RATE") ?? 0.15);

const stripe = getStripe(STRIPE_SECRET_KEY, Stripe);
const admin = createAdminClient();
const round = (n: number) => Math.round(n);

serve(async (_req: Request) => {
  const cors = corsHeaders(_req, "POST, OPTIONS");
  const preflight = handleCors(_req, "POST, OPTIONS");
  if (preflight) return preflight;

  if (_req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  try {

    const auth = await requireAuth(_req);
    if ("error" in auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { booking_id } = await _req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "Missing booking_id" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: b } = await admin
      .from("bookings")
      .select(
        "id, status, total_cents, stripe_payment_intent_id, stripe_checkout_session_id, class_id, capture_status, capture_attempt_count, payment_status",
      )
      .eq("id", booking_id)
      .single();

    if (!b || !["PENDING", "APPROVED"].includes(b.status)) {
      return new Response(JSON.stringify({ error: "Not approvable" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let paymentIntentId = b.stripe_payment_intent_id ?? null;
    if (!paymentIntentId) {
      if (!b.stripe_checkout_session_id) {
        return new Response(JSON.stringify({ error: "Missing stripe_payment_intent_id and checkout session id" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

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
    }

    if (!paymentIntentId) {
      return new Response(JSON.stringify({ error: "Unable to resolve Stripe PaymentIntent for capture" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (b.capture_status === "CAPTURED" || b.payment_status === "HELD") {
      return new Response(JSON.stringify({ ok: true, already_captured: true }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (b.capture_status === "CAPTURE_IN_PROGRESS") {
      return new Response(JSON.stringify({ error: "Capture already in progress" }), {
        status: 409,
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

    const startCaptureAt = new Date().toISOString();
    const { error: captureStartErr } = await admin
      .from("bookings")
      .update({
        capture_status: "CAPTURE_IN_PROGRESS",
        capture_attempt_count: (b.capture_attempt_count ?? 0) + 1,
        capture_last_error: null,
        updated_at: startCaptureAt,
      })
      .eq("id", booking_id);

    if (captureStartErr) {
      throw captureStartErr;
    }

    // 1️⃣ Capture payment
    let pi: Stripe.PaymentIntent;
    try {
      pi = await stripe.paymentIntents.capture(paymentIntentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin
        .from("bookings")
        .update({
          capture_status: "CAPTURE_FAILED",
          capture_last_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking_id);
      return new Response(JSON.stringify({ error: "Stripe capture failed", details: message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 2️⃣ Compute platform/host split (total includes HERD fee)
    const total = Number(b.total_cents || 0);
    const hostPortion = total / (1 + HERD_FEE_RATE);
    const platform_fee_cents = round(hostPortion * HERD_FEE_RATE);
    const host_payout_cents = round(hostPortion);
    const stripe_fee_cents = round(total * 0.029 + 30);

    // 3️⃣ Update booking — funds now held
    const capturedAt = new Date().toISOString();
    const { error: captureUpdateErr } = await admin
      .from("bookings")
      .update({
        status: "APPROVED",
        approved_at: capturedAt,
        payment_status: "HELD",
        platform_fee_cents,
        host_payout_cents,
        stripe_fee_cents,
        stripe_charge_id:
          (typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id) ||
          null,
        capture_status: "CAPTURED",
        captured_at: capturedAt,
        capture_last_error: null,
        updated_at: capturedAt,
      })
      .eq("id", booking_id);

    if (captureUpdateErr) {
      console.error("[approve-booking] capture succeeded but booking update failed", captureUpdateErr);
      const details = { error: captureUpdateErr.message ?? String(captureUpdateErr) };

      const { error: reconErr } = await admin.from("payment_reconciliations").insert({
        booking_id,
        stripe_payment_intent_id: paymentIntentId,
        stripe_checkout_session_id: b.stripe_checkout_session_id ?? null,
        reason: "CAPTURE_SUCCEEDED_DB_FAILED",
        status: "OPEN",
        details,
      });

      if (reconErr) {
        console.error("[approve-booking] failed to insert reconciliation", reconErr);
      }

      await admin
        .from("bookings")
        .update({
          capture_status: "NEEDS_RECONCILE",
          capture_last_error: details.error,
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking_id);

      return new Response(
        JSON.stringify({ error: "Capture succeeded but booking update failed; reconciliation required." }),
        {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        },
      );
    }

    // 4️⃣ Enqueue confirmation emails
    await admin.rpc("enqueue_booking_email_job", {
      _booking_id: booking_id,
      _type: "booking_confirmed_host",
      _template: "BOOKING_CONFIRMED_HOST",
    });
    await admin.rpc("enqueue_booking_email_job", {
      _booking_id: booking_id,
      _type: "booking_confirmed_guest",
      _template: "BOOKING_CONFIRMED_GUEST",
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[approve-booking]", e);
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
