import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=denonext";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireInternal } from "../_shared/internal.ts";
import { createAdminClient } from "../_shared/supabase.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error("Missing required environment variables");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
const supabase = createAdminClient();

type PendingBookingRow = {
  id: string;
  status: string | null;
  payment_status: string | null;
  stripe_payment_intent_id: string | null;
  class_id: string | null;
  user_id: string | null;
  classes: {
    id: string;
    title: string | null;
    host_id: string | null;
    start_date: string | null;
    end_date: string | null;
    start_time: string | null;
  } | null;
};

const computeClassEndMillis = (cls: PendingBookingRow["classes"]) => {
  if (!cls) return null;
  const dateStr = cls.end_date ?? cls.start_date;
  if (!dateStr) return null;
  const end = new Date(`${dateStr}T${cls.start_time || "00:00:00"}`);
  if (Number.isNaN(end.getTime())) return null;
  end.setHours(23, 59, 59, 999);
  return end.getTime();
};

serve(async (req) => {
  const cors = corsHeaders(req, "GET, POST, OPTIONS");
  const preflight = handleCors(req, "GET, POST, OPTIONS");
  if (preflight) return preflight;

  const unauthorized = requireInternal(req, cors);
  if (unauthorized) return unauthorized;

  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, service: "expire-pending-bookings" }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const limit = (() => {
      const raw = Number.parseInt(url.searchParams.get("limit") ?? "500", 10);
      if (!Number.isFinite(raw) || raw <= 0) return 500;
      return Math.min(raw, 1000);
    })();

    const nowMs = Date.now();

    const { data, error } = await supabase
      .from("bookings")
      .select(
        `
          id,
          status,
          payment_status,
          stripe_payment_intent_id,
          class_id,
          user_id,
          classes!inner(
            id,
            title,
            host_id,
            start_date,
            end_date,
            start_time
          )
        `,
      )
      .eq("status", "PENDING")
      .limit(limit) as { data: PendingBookingRow[] | null; error: any };

    if (error) {
      console.error("[expire-pending-bookings] fetch error:", error);
      return new Response(JSON.stringify({ error: "Failed to load bookings" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const rows = data ?? [];
    const expired = rows.filter((row) => {
      const endMs = computeClassEndMillis(row.classes);
      return endMs !== null && endMs < nowMs;
    });

    const summary = {
      scanned: rows.length,
      expired: expired.length,
      cancelled: 0,
      failed: 0,
    };

    for (const row of expired) {
      try {
        if (row.stripe_payment_intent_id) {
          try {
            await stripe.paymentIntents.cancel(row.stripe_payment_intent_id);
          } catch (cancelErr) {
            console.warn(
              `[expire-pending-bookings] ⚠️ Unable to cancel PI ${row.stripe_payment_intent_id} for booking ${row.id}`,
              cancelErr,
            );
          }
        }

        const { error: updateErr } = await supabase
          .from("bookings")
          .update({
            status: "DENIED",
            payment_status: "FAILED",
            denied_at: new Date().toISOString(),
            host_message: "Automatically denied because the class date has passed.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        if (updateErr) throw updateErr;

        summary.cancelled++;
      } catch (rowErr) {
        summary.failed++;
        console.error(`[expire-pending-bookings] ❌ Failed to expire booking ${row.id}`, rowErr);
      }
    }

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[expire-pending-bookings] unexpected error", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
