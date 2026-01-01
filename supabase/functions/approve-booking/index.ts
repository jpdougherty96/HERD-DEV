import { serve } from "https://deno.land/std/http/server.ts";
import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const HERD_FEE_RATE = Number(Deno.env.get("HERD_FEE_RATE") ?? 0.15);

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
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
      .select("id, status, total_cents, stripe_payment_intent_id, class_id")
      .eq("id", booking_id)
      .single();

    if (!b || !["PENDING", "APPROVED"].includes(b.status) || !b.stripe_payment_intent_id) {
      return new Response(JSON.stringify({ error: "Not approvable" }), {
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

    // 1️⃣ Capture payment
    const pi = await stripe.paymentIntents.capture(b.stripe_payment_intent_id);

    // 2️⃣ Compute platform/host split (total includes HERD fee)
    const total = Number(b.total_cents || 0);
    const hostPortion = total / (1 + HERD_FEE_RATE);
    const platform_fee_cents = round(hostPortion * HERD_FEE_RATE);
    const host_payout_cents = round(hostPortion);
    const stripe_fee_cents = round(total * 0.029 + 30);

    // 3️⃣ Update booking — funds now held
    await admin
      .from("bookings")
      .update({
        status: "APPROVED",
        approved_at: new Date().toISOString(),
        payment_status: "HELD",
        platform_fee_cents,
        host_payout_cents,
        stripe_fee_cents,
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
