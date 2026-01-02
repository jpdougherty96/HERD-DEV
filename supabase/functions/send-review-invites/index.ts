import { serve } from "https://deno.land/std/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireInternal } from "../_shared/internal.ts";
import { createAdminClient } from "../_shared/supabase.ts";
const DEFAULT_BASE_URL = "https://herd.rent";
const HERD_BASE_URL = normalizeBaseUrl(Deno.env.get("HERD_BASE_URL") || DEFAULT_BASE_URL, DEFAULT_BASE_URL);

function normalizeBaseUrl(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const lower = trimmed.toLowerCase();
  if (lower.includes("localhost") || lower.includes("127.0.0.1")) return fallback;
  return trimmed.replace(/\/+$/, "");
}

const admin = createAdminClient();

serve(async (req: Request) => {
  const cors = corsHeaders(req, "GET, POST, OPTIONS");
  const preflight = handleCors(req, "GET, POST, OPTIONS");
  if (preflight) return preflight;

  const unauthorized = requireInternal(req, cors);
  if (unauthorized) return unauthorized;

  try {
    // Multi-day support: use classes.end_date when available, otherwise fall back to legacy single-day heuristic.
    const { data: rows, error } = await admin
      .from("bookings")
      .select(`
        id, user_id, reviewed, status,
        classes!inner(
          id, host_id, title, start_date, end_date, start_time, number_of_days, hours_per_day
        ),
        profiles!inner(email, full_name)
      `)
      .in("status", ["APPROVED", "PAID"])
      .eq("reviewed", false);

    if (error) throw error;

    const now = new Date();

    const finishedMoreThan24hAgo = (c: any) => {
      const start = new Date(`${c.start_date}T${c.start_time || "00:00:00"}Z`);
      if (isNaN(start.getTime())) return false;

      const numberOfDays = Number(c.number_of_days || 1);
      const endDateStr = typeof c.end_date === "string" && c.end_date.length ? c.end_date : null;
      const isMultiDay =
        (endDateStr && endDateStr !== c.start_date) ||
        numberOfDays > 1;

      if (!isMultiDay) {
        const totalHours = Number(c.hours_per_day || 0) * numberOfDays;
        const end = new Date(start.getTime() + totalHours * 3600 * 1000);
        const effectiveEnd = totalHours > 0 ? end : start;
        return now.getTime() - effectiveEnd.getTime() >= 24 * 3600 * 1000;
      }

      const endInstant = new Date(`${(endDateStr ?? c.start_date)}T${c.start_time || "00:00:00"}Z`);
      if (isNaN(endInstant.getTime())) return false;
      return now.getTime() - endInstant.getTime() >= 24 * 3600 * 1000;
    };

    const candidates = (rows || []).filter((b: any) => finishedMoreThan24hAgo(b.classes));
    if (!candidates.length) return new Response("No pending invites", { status: 200, headers: cors });

    const bookingIds = candidates
      .map((b: any) => b.id)
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);

    const existingTokenBookings = new Set<string>();
    if (bookingIds.length > 0) {
      const { data: existingTokens, error: tokenLookupErr } = await admin
        .from("review_tokens")
        .select("booking_id")
        .in("booking_id", bookingIds);

      if (tokenLookupErr) {
        console.error("token lookup error", tokenLookupErr);
      } else if (Array.isArray(existingTokens)) {
        existingTokens.forEach((row: any) => {
          if (typeof row?.booking_id === "string" && row.booking_id.length > 0) {
            existingTokenBookings.add(row.booking_id);
          }
        });
      }
    }

    const pendingInvites = candidates.filter((b: any) => !existingTokenBookings.has(b.id));
    if (!pendingInvites.length) return new Response("No pending invites", { status: 200, headers: cors });

    // Process each: create token, queue email
    for (const b of pendingInvites) {
      const token = crypto.randomUUID();
      const expires = new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString(); // 14 days

      // Upsert a fresh token (handles re-runs safely)
      const { error: tokenErr } = await admin.from("review_tokens").upsert({
        token,
        booking_id: b.id,
        user_id: b.user_id,
        host_id: b.classes.host_id,
        expires_at: expires,
        used_at: null
      });
      if (tokenErr) {
        console.error("token insert error", tokenErr);
        continue;
      }

      const reviewUrl = `${HERD_BASE_URL.replace(/\/$/, "")}/review?token=${token}`;

      // Use your email outbox system
      const vars = {
        REVIEW_URL: reviewUrl,
        CLASS_TITLE: b.classes.title,
        GUEST_NAME: b.profiles?.full_name || "",
      };

      const { error: qErr } = await admin.rpc("enqueue_email_job", {
        p_type: "review_invite_guest",
        p_to_email: b.profiles?.email ?? null,
        p_subject: "How was your host?",
        p_template: "REVIEW_INVITE_GUEST", // add this template to your mailer
        p_vars: vars as any
      });

      if (qErr) console.error("enqueue_email_job error", qErr);
    }

    return new Response(`Invites queued: ${pendingInvites.length}`, { status: 200, headers: cors });
  } catch (e) {
    console.error("[send-review-invites]", e);
    return new Response("Error", { status: 500, headers: cors });
  }
});
