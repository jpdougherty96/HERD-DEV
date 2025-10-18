import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUFFER_HOURS = Number(Deno.env.get("PAYOUT_BUFFER_HOURS") || "24"); // release +24h after class

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (_req: Request) => {
  if (_req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    console.log(`[release-held-payments] 🔍 Checking for payouts older than ${BUFFER_HOURS}h`);

    // 1️⃣ Find due bookings via SQL helper
    const { data: rows, error } = await supabase.rpc("herd_due_payouts", { buffer_hours: BUFFER_HOURS });
    if (error) throw error;
    if (!rows?.length) {
      console.log("[release-held-payments] ✅ No payouts due");
      return json({ ok: true, count: 0 });
    }

    console.log(`[release-held-payments] Found ${rows.length} bookings to pay out`);
    let success = 0, failed = 0;
    const now = new Date();
    const reviewUnlockIds: string[] = [];

    for (const r of rows) {
      const bookingId = typeof r.id === "string" ? r.id : null;
      if (!bookingId) continue;
      const classEndUtcStr = typeof r.class_end_utc === "string" ? r.class_end_utc : null;
      const classEndDateStr = typeof r.class_end_date === "string" ? r.class_end_date : null;

      let unlockAt: Date | null = null;
      if (classEndUtcStr) {
        const classEndUtc = new Date(classEndUtcStr);
        if (!isNaN(classEndUtc.getTime())) {
          unlockAt = new Date(classEndUtc.getTime() + 24 * 3600 * 1000);
        }
      }

      if (!unlockAt && classEndDateStr) {
        const fallback = new Date(`${classEndDateStr}T00:00:00Z`);
        if (!isNaN(fallback.getTime())) {
          unlockAt = new Date(fallback.getTime() + 24 * 3600 * 1000);
        }
      }

      if (unlockAt && now >= unlockAt) {
        reviewUnlockIds.push(bookingId);
      }
    }

    if (reviewUnlockIds.length) {
      try {
        await supabase
          .from("bookings")
          .update({ review_allowed: true, updated_at: new Date().toISOString() })
          .in("id", reviewUnlockIds)
          .eq("review_allowed", false);
        console.log(`[release-held-payments] ✅ Enabled reviews for ${reviewUnlockIds.length} bookings`);
      } catch (unlockErr) {
        console.error("[release-held-payments] ⚠️ Failed to unlock reviews", unlockErr);
      }
    }

    // 2️⃣ Iterate and process transfers
    for (const r of rows) {
      const bookingId = typeof r.id === "string" ? r.id : String(r.id);
      const amount = Math.max(Number(r.host_payout_cents || 0), 0);
      const destination = r.host_stripe_account_id as string | null;
      const sourceCharge = r.stripe_charge_id as string | null;

      if (!amount || !destination) {
        console.warn(`[release-held-payments] ⚠️ Skipping ${bookingId} — missing data`, { amount, destination, sourceCharge });
        failed++;
        continue;
      }

      try {
        const transferParams: Stripe.TransferCreateParams = {
          amount,
          currency: "usd",
          destination,
          transfer_group: `booking_${bookingId}`,
          description: `HERD payout for booking ${bookingId}`,
        };

        if (sourceCharge && sourceCharge.startsWith("ch_")) {
          transferParams.source_transaction = sourceCharge;
        }

        const transfer = await stripe.transfers.create(transferParams);

        await supabase
          .from("bookings")
          .update({
            payment_status: "COMPLETED",
            stripe_transfer_id: transfer.id,
            paid_out_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", bookingId)
          .throwOnError();
        // 5️⃣ notify host
        try {
          await supabase.rpc("enqueue_booking_email_job", {
            _booking_id: bookingId,
            _type: "payout_released_host",
            _template: "PAYOUT_RELEASED_HOST",
          });
          console.log(`[release-held-payments] 📬 Notified host for booking ${bookingId}`);
        } catch (notifyErr) {
          console.error(`[release-held-payments] ⚠️ Could not enqueue payout email for ${bookingId}`, notifyErr);
        }

        console.log(`[release-held-payments] 💸 Released ${bookingId} → ${destination} ($${(amount / 100).toFixed(2)})`);
        success++;
      } catch (e) {
        console.error(`[release-held-payments] ❌ Transfer failed for ${bookingId}`, e);
        failed++;
      }
    }

    return json({ ok: true, success, failed });
  } catch (err: any) {
    console.error("[release-held-payments] ❌", err);
    return json({ error: err.message || String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
