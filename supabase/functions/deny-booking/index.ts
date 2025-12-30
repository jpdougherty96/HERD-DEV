// supabase/functions/deny-booking/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=denonext";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
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
      .select("id, status, stripe_payment_intent_id, class_id")
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

    // Cancel the uncaptured PaymentIntent
    if (b.stripe_payment_intent_id) {
      try {
        await stripe.paymentIntents.cancel(b.stripe_payment_intent_id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[deny-booking] Cancel failed:", message);
      }
    }

    // Update booking record
    const { error: updateErr } = await admin
      .from("bookings")
      .update({
        status: "DENIED",
        payment_status: "FAILED",
        denied_at: new Date().toISOString(),
        host_message: message ? String(message) : null,
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
