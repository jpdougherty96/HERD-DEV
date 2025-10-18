// supabase/functions/create-checkout-session/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:3000";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function headers(extra: Record<string, string> = {}) {
  return {
    ...corsHeaders,
    ...extra,
  };
}

serve(async (_req: Request) => {
  if (_req.method === "OPTIONS")
    return new Response(null, { status: 200, headers: corsHeaders });
  if (_req.method !== "POST")
    return new Response("Method Not Allowed", { status: 405, headers: headers() });

  try {
    const { class_id, user_id, qty = 1, student_names } = await _req.json();
    if (!class_id || !user_id) {
      return new Response(JSON.stringify({ error: "Missing class_id or user_id" }), {
        status: 400,
        headers: headers({ "Content-Type": "application/json" }),
      });
    }

    const requestedQty = Number.parseInt(String(qty), 10);
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
      return new Response(JSON.stringify({ error: "Invalid quantity selected" }), {
        status: 400,
        headers: headers({ "Content-Type": "application/json" }),
      });
    }

    // 🧠 Fetch class data
    const { data: cls, error: clsErr } = await admin
      .from("classes")
      .select("id, title, price_per_person_cents, auto_approve")
      .eq("id", class_id)
      .single();

    if (clsErr || !cls) {
      console.error("❌ Class fetch error:", clsErr);
      return new Response(JSON.stringify({ error: "Class not found" }), {
        status: 404,
        headers: headers({ "Content-Type": "application/json" }),
      });
    }

    const { data: spots, error: spotsErr } = await admin.rpc("available_spots", { class_uuid: class_id });
    if (spotsErr) {
      console.error("❌ available_spots error:", spotsErr);
      return new Response(JSON.stringify({ error: "Unable to verify availability" }), {
        status: 400,
        headers: headers({ "Content-Type": "application/json" }),
      });
    }

    const seatsRemaining = typeof spots === "number" ? Math.max(0, spots) : 0;
    if (seatsRemaining <= 0) {
      return new Response(JSON.stringify({ error: "This class is fully booked" }), {
        status: 400,
        headers: headers({ "Content-Type": "application/json" }),
      });
    }

    if (requestedQty > seatsRemaining) {
      return new Response(
        JSON.stringify({
          error: seatsRemaining === 1 ? "Only 1 seat remains for this class" : `Only ${seatsRemaining} seats remain for this class`,
        }),
        {
          status: 400,
          headers: headers({ "Content-Type": "application/json" }),
        },
      );
    }

    const studentNames = Array.isArray(student_names)
      ? student_names
          .map((name: unknown) => (typeof name === "string" ? name.trim() : ""))
          .filter(Boolean)
          .slice(0, requestedQty)
      : [];

    // 💰 Convert to cents and include HERD fee
    const normalizeToCents = (value: number): number => {
      if (!Number.isFinite(value) || value <= 0) return 0;
      if (Math.abs(value) >= 100 && Number.isInteger(value)) return Math.round(value);
      return Math.round(value * 100);
    };

    const basePriceCents = normalizeToCents(Number(cls.price_per_person_cents ?? 0));
    const herdFeeRate = Number(Deno.env.get("HERD_FEE_RATE") ?? 0.08);
    const totalPerStudentCents = Math.round(basePriceCents * (1 + herdFeeRate));
    const amount = totalPerStudentCents * requestedQty;

    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid amount" }), {
        status: 400,
        headers: headers({ "Content-Type": "application/json" }),
      });
    }

    // ⚙️ Capture strategy
    const capture_method = cls.auto_approve ? "automatic" : "manual";

    const transferGroup = `booking_${class_id}_${user_id}`;
    const requestOrigin = _req.headers.get("origin");
    const normalizedSite = (requestOrigin && requestOrigin.startsWith("http") ? requestOrigin : SITE_URL).replace(/\/$/, "");
    const origin = normalizedSite || SITE_URL.replace(/\/$/, "");
    const successUrl = Deno.env.get("STRIPE_SUCCESS_URL") ?? `${origin}/classes/checkout/success`;
    const cancelUrl = Deno.env.get("STRIPE_CANCEL_URL") ?? `${origin}/classes/checkout/cancel`;

    // 💳 Create checkout session with metadata
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      metadata: {
        class_id,
        user_id,
        qty: String(requestedQty),
        student_names: JSON.stringify(studentNames),
        transfer_group: transferGroup,
      },
      payment_intent_data: {
        metadata: {
          class_id,
          user_id,
          qty: String(requestedQty),
          student_names: JSON.stringify(studentNames),
          transfer_group: transferGroup,
        },
        capture_method,
        transfer_group: transferGroup,
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Class: ${cls.title}` },
            unit_amount: totalPerStudentCents, // ✅ includes HERD fee
          },
          quantity: requestedQty,
        },
      ],
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: headers({ "Content-Type": "application/json" }),
    });
  } catch (err: any) {
    console.error("❌ create-checkout-session:", err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || "Unknown error" }), {
      status: 500,
      headers: headers({ "Content-Type": "application/json" }),
    });
  }
});
