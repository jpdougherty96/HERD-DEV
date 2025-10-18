import { serve } from "https://deno.land/std/http/server.ts";
import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 🟢 Added CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HERD_FEE_RATE = Number(Deno.env.get("HERD_FEE_RATE") ?? 0.08);

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const round = (n: number) => Math.round(n);

serve(async (_req: Request) => {
  try {
    // 🟢 Handle CORS preflight
    if (_req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (_req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    const { booking_id } = await _req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "Missing booking_id" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: b } = await admin
      .from("bookings")
      .select("id, status, total_cents, stripe_payment_intent_id")
      .eq("id", booking_id)
      .single();

    if (!b || !["PENDING", "APPROVED"].includes(b.status) || !b.stripe_payment_intent_id) {
      return new Response(JSON.stringify({ error: "Not approvable" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // 1️⃣ Capture payment
    const pi = await stripe.paymentIntents.capture(b.stripe_payment_intent_id);

    // 2️⃣ Compute platform/host split
    const total = Number(b.total_cents || 0);
    const platform_fee_cents = round(total * HERD_FEE_RATE);
    const host_payout_cents = total - platform_fee_cents;

    // 3️⃣ Update booking — funds now held
    await admin
      .from("bookings")
      .update({
        status: "APPROVED",
        approved_at: new Date().toISOString(),
        payment_status: "HELD",
        platform_fee_cents,
        host_payout_cents,
        stripe_charge_id:
          (typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id) ||
          null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_id);

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
      headers: corsHeaders, // 🟢 Added
    });
  } catch (e: any) {
    console.error("[approve-booking]", e);
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: corsHeaders, // 🟢 Added
    });
  }
});
