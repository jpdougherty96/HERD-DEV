import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireInternal } from "../_shared/internal.ts";
import { getStripe } from "../_shared/stripe.ts";
import { createAdminClient } from "../_shared/supabase.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const BUFFER_HOURS = Number(Deno.env.get("PAYOUT_BUFFER_HOURS") || "24"); // release +24h after class
const SITE_URL = (Deno.env.get("SITE_URL") || "https://herdstaging.dev").replace(/\/+$/, "");

const stripe = getStripe(STRIPE_SECRET_KEY, Stripe);
const supabase = createAdminClient();

const isEligiblePayoutStatus = (status: string | null) =>
  status === null || status === "NONE" || status === "DUE" || status === "FAILED";

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const hashString = async (value: string) => {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return toHex(hash);
};

serve(async (_req: Request) => {
  const cors = corsHeaders(_req, "GET, POST, OPTIONS");
  const preflight = handleCors(_req, "GET, POST, OPTIONS");
  if (preflight) return preflight;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  const unauthorized = requireInternal(_req, cors);
  if (unauthorized) return unauthorized;

  try {
    console.log(`[release-held-payments] 🔍 Checking for payouts older than ${BUFFER_HOURS}h`);

    // 1️⃣ Find due bookings via SQL helper
    const { data: rows, error } = await supabase.rpc("herd_due_payouts", { buffer_hours: BUFFER_HOURS });
    if (error) throw error;
    if (!rows?.length) {
      console.log("[release-held-payments] ✅ No payouts due");
      return json({ ok: true, count: 0 });
    }

    const bookingIds = rows
      .map((row: any) => (typeof row.id === "string" ? row.id : null))
      .filter(Boolean) as string[];
    const classIds = Array.from(
      new Set(rows.map((row: any) => (typeof row.class_id === "string" ? row.class_id : null)).filter(Boolean)),
    ) as string[];

    if (!bookingIds.length || !classIds.length) {
      console.log("[release-held-payments] ⚠️ No valid due bookings found");
      return json({ ok: true, count: 0 });
    }

    const { data: bookingRows, error: bookingErr } = await supabase
      .from("bookings")
      .select(
        "id, status, payment_status, payout_status, payout_attempt_count, host_payout_cents, class_id, review_allowed, total_cents, platform_fee_cents",
      )
      .in("id", bookingIds);

    if (bookingErr) throw bookingErr;

    const { data: classRows, error: classErr } = await supabase
      .from("classes")
      .select("id, title, host_id, host:profiles!classes_host_id_fkey(id, email, full_name, stripe_account_id, stripe_connected)")
      .in("id", classIds);

    if (classErr) throw classErr;

    const bookingsById = new Map<string, any>();
    for (const row of bookingRows ?? []) {
      if (row?.id) bookingsById.set(row.id, row);
    }

    const classesById = new Map<string, any>();
    for (const row of classRows ?? []) {
      if (row?.id) classesById.set(row.id, row);
    }

    const now = new Date();
    const reviewUnlockIds: string[] = [];
    const groups = new Map<string, { host: any; classIds: Set<string>; bookingIds: string[]; rows: any[] }>();

    for (const r of rows) {
      const bookingId = typeof r.id === "string" ? r.id : null;
      const classId = typeof r.class_id === "string" ? r.class_id : null;
      if (!bookingId || !classId) continue;

      const booking = bookingsById.get(bookingId);
      if (!booking) continue;

      const eligible =
        booking.status === "APPROVED" &&
        booking.payment_status === "HELD" &&
        isEligiblePayoutStatus(booking.payout_status ?? null);
      if (!eligible) continue;

      const classInfo = classesById.get(classId);
      if (!classInfo) continue;

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

      const hostId = classInfo.host_id as string | undefined;
      if (!hostId) continue;

      const hostGroup = groups.get(hostId) ?? {
        host: classInfo.host,
        classIds: new Set<string>(),
        bookingIds: [],
        rows: [],
      };
      hostGroup.classIds.add(classId);
      hostGroup.bookingIds.push(bookingId);
      hostGroup.rows.push({ booking, due: r, classInfo });
      groups.set(hostId, hostGroup);
    }

    if (groups.size === 0) {
      console.log("[release-held-payments] ✅ No eligible payouts after filtering");
      return json({ ok: true, count: 0 });
    }

    // Stripe model:
    // - Charge occurs on platform (Checkout).
    // - Later payout uses transfers from platform balance to host connected account.
    const runDate = now.toISOString().slice(0, 10).replace(/-/g, "");
    let hostsProcessed = 0;
    let transfersCreated = 0;
    let bookingsPaid = 0;
    let failedHosts = 0;

    for (const [hostId, group] of groups) {
      hostsProcessed++;
      const host = group.host;
      const stripeAccountId =
        host && typeof host.stripe_account_id === "string" ? host.stripe_account_id : null;
      const stripeConnected = Boolean(host?.stripe_connected);
      const bookingIdsForHost = Array.from(new Set(group.bookingIds)).sort();
      const nowIso = new Date().toISOString();

      if (!stripeAccountId || !stripeConnected) {
        const errorMessage = "Missing or unverified Stripe connected account";
        for (const entry of group.rows) {
          const booking = entry.booking;
          if (!booking?.id) continue;
          await supabase
            .from("bookings")
            .update({
              payout_status: "FAILED",
              payout_last_error: errorMessage,
              payout_attempt_count: (booking.payout_attempt_count ?? 0) + 1,
              updated_at: nowIso,
            })
            .eq("id", booking.id);
        }
        failedHosts++;
        continue;
      }

      const totalAmount = group.rows.reduce((sum, entry) => {
        const booking = entry.booking;
        const amount = booking?.host_payout_cents ?? entry.due?.host_payout_cents ?? 0;
        return sum + Math.max(Number(amount || 0), 0);
      }, 0);

      if (totalAmount <= 0) {
        for (const entry of group.rows) {
          const booking = entry.booking;
          if (!booking?.id) continue;
          await supabase
            .from("bookings")
            .update({
              payout_status: "FAILED",
              payout_last_error: "Invalid payout amount",
              payout_attempt_count: (booking.payout_attempt_count ?? 0) + 1,
              updated_at: nowIso,
            })
            .eq("id", booking.id);
        }
        failedHosts++;
        continue;
      }

      let markFailed = false;
      for (const entry of group.rows) {
        const booking = entry.booking;
        if (!booking?.id) continue;
        const { error: markErr } = await supabase
          .from("bookings")
          .update({
            payout_status: "IN_PROGRESS",
            payout_attempt_count: (booking.payout_attempt_count ?? 0) + 1,
            payout_last_error: null,
            updated_at: nowIso,
          })
          .eq("id", booking.id);
        if (markErr) {
          console.warn("[release-held-payments] ⚠️ Failed to mark payout in progress", markErr);
          markFailed = true;
        }
      }

      if (markFailed) {
        await supabase
          .from("bookings")
          .update({
            payout_status: "FAILED",
            payout_last_error: "Failed to mark payout in progress",
            updated_at: nowIso,
          })
          .in("id", bookingIdsForHost);
        failedHosts++;
        continue;
      }

      const bookingKey = `${hostId}:${totalAmount}:${bookingIdsForHost.join(",")}`;
      const idempotencyKey = `payout_${hostId}_${(await hashString(bookingKey)).slice(0, 20)}`;

      let batch: { id: string } | null = null;
      const { data: createdBatch, error: batchErr } = await supabase
        .from("payout_batches")
        .insert({
          host_id: hostId,
          stripe_account_id: stripeAccountId,
          total_amount_cents: totalAmount,
          status: "CREATED",
          booking_ids: bookingIdsForHost,
          idempotency_key: idempotencyKey,
        })
        .select("id")
        .single();

      if (batchErr) {
        const message = typeof batchErr?.message === "string" ? batchErr.message : "";
        const isUniqueViolation = batchErr?.code === "23505" || message.includes("duplicate key");
        if (isUniqueViolation) {
          const { data: existingBatch, error: existingErr } = await supabase
            .from("payout_batches")
            .select("id")
            .eq("idempotency_key", idempotencyKey)
            .single();
          if (existingErr || !existingBatch) {
            await supabase
              .from("bookings")
              .update({
                payout_status: "FAILED",
                payout_last_error: "Failed to load existing payout batch",
                updated_at: new Date().toISOString(),
              })
              .in("id", bookingIdsForHost);
            failedHosts++;
            continue;
          }
          batch = existingBatch;
        } else {
          await supabase
            .from("bookings")
            .update({
              payout_status: "FAILED",
              payout_last_error: "Failed to create payout batch",
              updated_at: new Date().toISOString(),
            })
            .in("id", bookingIdsForHost);
          failedHosts++;
          continue;
        }
      } else {
        batch = createdBatch;
      }

      if (!batch) {
        await supabase
          .from("bookings")
          .update({
            payout_status: "FAILED",
            payout_last_error: "Missing payout batch",
            updated_at: new Date().toISOString(),
          })
          .in("id", bookingIdsForHost);
        failedHosts++;
        continue;
      }

      try {
        const transfer = await stripe.transfers.create(
          {
            amount: totalAmount,
            currency: "usd",
            destination: stripeAccountId,
            transfer_group: `host_${hostId}_${runDate}`,
            metadata: {
              booking_ids: bookingIdsForHost.join(","),
              host_id: hostId,
              batch_id: batch.id,
            },
          },
          { idempotencyKey },
        );

        transfersCreated++;
        bookingsPaid += bookingIdsForHost.length;

        await supabase
          .from("bookings")
          .update({
            payout_status: "PAID",
            stripe_transfer_id: transfer.id,
            paid_out_at: new Date().toISOString(),
            payout_last_error: null,
            updated_at: new Date().toISOString(),
          })
          .in("id", bookingIdsForHost);

        await supabase
          .from("payout_batches")
          .update({
            stripe_transfer_id: transfer.id,
            status: "SENT",
            sent_at: new Date().toISOString(),
          })
          .eq("id", batch.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await supabase
          .from("bookings")
          .update({
            payout_status: "FAILED",
            payout_last_error: message,
            updated_at: new Date().toISOString(),
          })
          .in("id", bookingIdsForHost);
        await supabase
          .from("payout_batches")
          .update({
            status: "FAILED",
          })
          .eq("id", batch.id);
        console.error(`[release-held-payments] ❌ Transfer failed for host ${hostId}`, err);
        failedHosts++;
        continue;
      }

      const hostEmail = host?.email || null;
      if (hostEmail) {
        const bookingUrl = `${SITE_URL}/dashboard?role=host&tab=bookings`;
        const classTitles = Array.from(group.classIds).map((classId) => classesById.get(classId)?.title).filter(Boolean);
        const titleLabel =
          classTitles.length === 1 ? classTitles[0] : classTitles.length > 1 ? "Multiple classes" : "HERD classes";
        const totals = group.rows.reduce(
          (acc: { totalCollected: number; platformFees: number; hostEarnings: number }, entry: any) => {
            const booking = entry.booking;
            acc.totalCollected += Number(booking?.total_cents ?? 0);
            acc.platformFees += Number(booking?.platform_fee_cents ?? 0);
            acc.hostEarnings += Number(booking?.host_payout_cents ?? 0);
            return acc;
          },
          { totalCollected: 0, platformFees: 0, hostEarnings: 0 },
        );

        try {
          await supabase.rpc("enqueue_email_job", {
            p_type: "payout_released_host",
            p_to_email: hostEmail,
            p_subject: null,
            p_template: "PAYOUT_RELEASED_HOST",
            p_vars: {
              CLASS_TITLE: titleLabel,
              TOTAL_COLLECTED: (totals.totalCollected / 100).toFixed(2),
              PLATFORM_FEES: (totals.platformFees / 100).toFixed(2),
              HOST_EARNINGS: (totals.hostEarnings / 100).toFixed(2),
              BOOKING_COUNT: String(bookingIdsForHost.length),
              BOOKING_URL: bookingUrl,
            } as Record<string, string>,
          });
        } catch (notifyErr) {
          console.error("[release-held-payments] ⚠️ Failed to enqueue payout summary email", notifyErr);
        }
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

    return json({
      ok: true,
      hosts_processed: hostsProcessed,
      transfers_created: transfersCreated,
      bookings_paid: bookingsPaid,
      failed_hosts: failedHosts,
    });
  } catch (err: any) {
    console.error("[release-held-payments] ❌", err);
    return json({ error: err.message || String(err) }, 500);
  }
});
