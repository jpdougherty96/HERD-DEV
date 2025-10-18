// supabase/functions/deny-booking/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

serve(async (_req: Request) => {
  if (_req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (_req.method !== "POST")
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  try {
    const { booking_id, message } = await _req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "Missing booking_id" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: b, error } = await admin
      .from("bookings")
      .select("id, status, stripe_payment_intent_id")
      .eq("id", booking_id)
      .single();

    if (error || !b) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    if (b.status !== "PENDING") {
      return new Response(JSON.stringify({ error: "Not deniable" }), {
        status: 400,
        headers: corsHeaders,
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

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    console.error("[deny-booking]", e);
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
