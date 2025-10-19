import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUFFER_HOURS = Number(Deno.env.get("PAYOUT_BUFFER_HOURS") || "24"); // release +24h after class
const SITE_URL = (Deno.env.get("SITE_URL") || "https://herdstaging.dev").replace(/\/+$/, "");

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
    const groupedByClass = new Map<string, any[]>();
    for (const row of rows) {
      const classId = typeof row.class_id === "string" ? row.class_id : null;
      if (!classId) continue;
      const bucket = groupedByClass.get(classId);
      if (bucket) bucket.push(row);
      else groupedByClass.set(classId, [row]);
    }

    if (groupedByClass.size === 0) {
      console.log("[release-held-payments] ⚠️ No valid class payouts found");
      return json({ ok: true, count: 0 });
    }

    const [targetClassId, classRows] = groupedByClass.entries().next().value as [string, any[]];
    console.log(`[release-held-payments] Processing class ${targetClassId} (${classRows.length} bookings)`);

    let success = 0;
    let failed = 0;
    const now = new Date();
    const reviewUnlockIds: string[] = [];
    const processedBookingIds: string[] = [];

    for (const r of classRows) {
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

      const amount = Math.max(Number(r.host_payout_cents || 0), 0);
      const destination = typeof r.host_stripe_account_id === "string" ? r.host_stripe_account_id : null;
      const sourceCharge = typeof r.stripe_charge_id === "string" ? r.stripe_charge_id : null;

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
          description: `HERD payout for booking ${bookingId}`,
        };

        if (sourceCharge && sourceCharge.startsWith("ch_")) {
          transferParams.source_transaction = sourceCharge;
        } else {
          transferParams.transfer_group = `booking_${bookingId}`;
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

        processedBookingIds.push(bookingId);
        console.log(`[release-held-payments] 💸 Released ${bookingId} → ${destination} ($${(amount / 100).toFixed(2)})`);
        success++;
      } catch (e) {
        console.error(`[release-held-payments] ❌ Transfer failed for ${bookingId}`, e);
        failed++;
        break;
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

    if (processedBookingIds.length) {
      try {
        const { data: bookingRows, error: bookingRowsErr } = await supabase
          .from("bookings")
          .select("id, total_cents, platform_fee_cents, host_payout_cents")
          .in("id", processedBookingIds);

        if (bookingRowsErr) throw bookingRowsErr;

        const totals = (bookingRows ?? []).reduce(
          (acc, row) => {
            acc.totalCollected += Number(row.total_cents ?? 0);
            acc.platformFees += Number(row.platform_fee_cents ?? 0);
            acc.hostEarnings += Number(row.host_payout_cents ?? 0);
            return acc;
          },
          { totalCollected: 0, platformFees: 0, hostEarnings: 0 },
        );

        const { data: classInfo, error: classErr } = await supabase
          .from("classes")
          .select("id, title, host_id, host:profiles!classes_host_id_fkey(email, full_name)")
          .eq("id", targetClassId)
          .maybeSingle();

        if (classErr) throw classErr;

        const hostEmail = classInfo?.host?.email || null;
        if (hostEmail) {
          const firstBookingId = processedBookingIds[0];
          const bookingUrl = `${SITE_URL}/dashboard?role=host&tab=bookings${firstBookingId ? `&booking=${firstBookingId}` : ""}`;

          await supabase.rpc("enqueue_email_job", {
            p_type: "payout_released_host",
            p_to_email: hostEmail,
            p_subject: null,
            p_template: "PAYOUT_RELEASED_HOST",
            p_vars: {
              CLASS_TITLE: classInfo?.title || "HERD Class",
              TOTAL_COLLECTED: (totals.totalCollected / 100).toFixed(2),
              PLATFORM_FEES: (totals.platformFees / 100).toFixed(2),
              HOST_EARNINGS: (totals.hostEarnings / 100).toFixed(2),
              BOOKING_COUNT: String(processedBookingIds.length),
              BOOKING_URL: bookingUrl,
            } as Record<string, string>,
          });

          console.log(`[release-held-payments] 📬 Notified host ${hostEmail} for class ${classInfo?.title || targetClassId}`);
        } else {
          console.warn(`[release-held-payments] ⚠️ Host email missing for class ${targetClassId}`);
        }
      } catch (notifyErr) {
        console.error("[release-held-payments] ⚠️ Failed to enqueue payout summary email", notifyErr);
      }
    }

    const remainingClasses = Math.max(0, groupedByClass.size - 1);
    return json({ ok: true, success, failed, class_id: targetClassId, remaining_classes: remainingClasses });
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
