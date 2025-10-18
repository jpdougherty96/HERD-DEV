// supabase/functions/emails/index.ts
// HERD Email Dispatcher — simplified HTML-only version (friendly-business tone)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@3.2.0";

// Setup clients
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const resend = new Resend(Deno.env.get("RESEND_API_KEY")!);
const BASE_URL = (Deno.env.get("SITE_URL") ?? "https://herdstaging.dev").replace(/\/+$/, "");
const MAX_ATTEMPTS = Number.parseInt(Deno.env.get("EMAILS_MAX_ATTEMPTS") ?? "5", 10) || 5;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

// Allowed email types
type EmailType =
  | "booking_requested_host"
  | "booking_requested_guest"
  | "booking_confirmed_host"
  | "booking_confirmed_guest"
  | "booking_denied_guest"
  | "class_start_reminder"
  | "payout_released_host"
  | "review_invite_guest"
  | "review_comment_host"
  | "message_new_conversation"
  | "message_unread_reminder";

interface EmailVars {
  [key: string]: string;
}

const isEmailType = (value: unknown): value is EmailType =>
  typeof value === "string" &&
  [
    "booking_requested_host",
    "booking_requested_guest",
    "booking_confirmed_host",
    "booking_confirmed_guest",
    "booking_denied_guest",
    "class_start_reminder",
    "payout_released_host",
    "review_invite_guest",
    "review_comment_host",
    "message_new_conversation",
    "message_unread_reminder",
  ].includes(value);

// Util helpers
function subjectFor(type: EmailType, v: EmailVars): string {
  const title = v.CLASS_TITLE || "HERD Class";
  switch (type) {
    case "booking_requested_host":
      return `New booking request: ${title}`;
    case "booking_requested_guest":
      return `Booking request sent: ${title}`;
    case "booking_confirmed_host":
      return `Booking confirmed: ${title}`;
    case "booking_confirmed_guest":
      return `Your booking is confirmed: ${title}`;
    case "booking_denied_guest":
      return `Booking not approved: ${title}`;
    case "class_start_reminder":
      return `Reminder: ${title} starts soon`;
    case "payout_released_host":
      return `Payout released for ${title}`;
    case "review_invite_guest":
      return `Share your thoughts on ${title}`;
    case "review_comment_host":
      return `You received feedback for ${title}`;
    case "message_new_conversation":
      return `${v.SENDER_NAME || "Someone"} messaged you about ${v.CONTEXT_TITLE || "a listing"}`;
    case "message_unread_reminder":
      return `You have unread messages on HERD`;
    default:
      return `HERD notification`;
  }
}

function renderEmailHTML(type: EmailType, v: EmailVars): string {
  const header = `<div style="background:#556B2F;padding:20px;border-radius:16px 16px 0 0;color:#fff;font-size:28px;font-weight:bold;text-align:center;">HERD</div>`;
  const footer = `<div style="padding:20px;text-align:center;color:#777;font-size:13px;">© ${new Date().getFullYear()} HERD — <a href="https://herdstaging.dev" style="color:#777;">herdstaging.dev</a></div>`;

  const section = (title: string, body: string) =>
    `<div style="margin-bottom:24px;"><h3 style="margin:0 0 8px;color:#3c4f21;">${title}</h3><p style="margin:0;color:#333;font-size:15px;line-height:1.6;">${body}</p></div>`;

  const button = (label: string, href: string) =>
    `<a href="${href}" style="display:inline-block;margin-top:12px;padding:12px 24px;background:#c54a2c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">${label}</a>`;

  let body = "";
  const dashUrl = `${BASE_URL}/dashboard`;
  const guestBookingsUrl = `${BASE_URL}/dashboard/guestview/mybookings`;
  const messagesUrl = `${dashUrl}?tab=messages`;
  const payoutsUrl = `${dashUrl}?tab=payouts`;

  switch (type) {
    case "booking_requested_host":
      body = `
        <p>Hi ${v.HOST_NAME || "Host"},</p>
        <p>${v.GUEST_NAME || "A guest"} requested to book <strong>${v.CLASS_TITLE}</strong>.</p>
        ${v.STUDENT_NAMES ? `<p>Students: ${v.STUDENT_NAMES}</p>` : ""}
        ${section(
          "Class Details",
          `
            ${v.CLASS_DATE || ""}${v.CLASS_TIME ? " at " + v.CLASS_TIME : ""}<br/>
            ${v.CLASS_ADDRESS || ""}
          `.trim()
        )}
        ${button("Review Request", v.REVIEW_URL || dashUrl)}
      `;
      break;

    case "booking_requested_guest":
      body = `
        <p>Hi ${v.GUEST_NAME || "there"},</p>
        <p>Your request for <strong>${v.CLASS_TITLE}</strong> is on its way to ${v.HOST_NAME || "the host"}.</p>
        <p>We&apos;ll email you as soon as they respond. You can keep tabs on the request from your dashboard.</p>
        ${button("View Request", v.BOOKING_URL || guestBookingsUrl)}
      `;
      break;

    case "booking_confirmed_host":
      body = `
        <p>Hi ${v.HOST_NAME || "Host"},</p>
        <p>${v.GUEST_NAME || "A guest"}’s booking for <strong>${v.CLASS_TITLE}</strong> is confirmed.</p>
        ${section(
          "Guest Details",
          `
            Name: ${v.GUEST_NAME || "Guest"}<br/>
            ${v.STUDENT_NAMES ? `Students: ${v.STUDENT_NAMES}<br/>` : ""}
            Guests booked: ${v.GUEST_COUNT || v.QTY || "1"}
          `.trim()
        )}
        ${section(
          "Payout Summary",
          `
            Total collected: ${v.TOTAL_COLLECTED || v.TOTAL_AMOUNT || "—"}<br/>
            Platform fees: ${v.PLATFORM_FEES || "—"}<br/>
            Your earnings: <strong>${v.HOST_EARNINGS || "—"}</strong>
          `.trim()
        )}
        ${button("View Booking", v.BOOKING_URL || dashUrl)}
      `;
      break;

    case "booking_confirmed_guest":
      body = `
        <p>Hi ${v.GUEST_NAME || "there"},</p>
        <p>Your booking for <strong>${v.CLASS_TITLE}</strong> is confirmed.</p>
        ${section(
          "Class Details",
          `
            Date: ${v.CLASS_DATE || "See booking"}${v.CLASS_TIME ? " at " + v.CLASS_TIME : ""}<br/>
            Location: ${v.CLASS_ADDRESS || "See booking"}<br/>
            Guests attending: ${v.GUEST_COUNT || v.QTY || "1"}
          `.trim()
        )}
        ${section("Total Paid", `<strong>${v.TOTAL_AMOUNT || v.TOTAL_COLLECTED || "View receipt in your dashboard"}</strong>`)}
        ${button("View Booking", v.BOOKING_URL || guestBookingsUrl)}
      `;
      break;

    case "booking_denied_guest":
      body = `<p>Hi ${v.GUEST_NAME || "there"},</p><p>We’re sorry — your booking for <strong>${v.CLASS_TITLE}</strong> wasn’t approved.</p>${button("Find Another Class", BASE_URL + "/classes")}`;
      break;

    case "class_start_reminder":
      body = `
        <p>Hi ${v.GUEST_NAME || "there"},</p>
        <p>This is a reminder that <strong>${v.CLASS_TITLE}</strong> starts soon.</p>
        ${section(
          "Details",
          `
            Date: ${v.CLASS_DATE || "See booking"}${v.CLASS_TIME ? " at " + v.CLASS_TIME : ""}<br/>
            Location: ${v.CLASS_ADDRESS || "See booking"}<br/>
            Host: ${v.HOST_NAME || "HERD Host"}
          `.trim()
        )}
        ${button("View Booking", v.BOOKING_URL || guestBookingsUrl)}
      `;
      break;

    case "payout_released_host":
      body = `
        <p>Hi ${v.HOST_NAME || "Host"},</p>
        <p>Your payout for <strong>${v.CLASS_TITLE}</strong> is on its way.</p>
        ${section(
          "Payout Breakdown",
          `
            Total collected: ${v.TOTAL_COLLECTED || "—"}<br/>
            Platform fees: ${v.PLATFORM_FEES || "—"}<br/>
            Stripe fees: ${v.STRIPE_FEES || "—"}<br/>
            Your payout: <strong>${v.HOST_EARNINGS || "—"}</strong>
          `.trim()
        )}
        ${button("View Payouts", v.PAYOUTS_URL || payoutsUrl)}
      `;
      break;

    case "review_invite_guest":
      body = `<p>Hi ${v.GUEST_NAME || "there"},</p><p>We hope you enjoyed <strong>${v.CLASS_TITLE}</strong>. Share your experience!</p>${button("Leave a Review", v.REVIEW_URL || dashUrl)}`;
      break;

    case "review_comment_host":
      body = `<p>Hi ${v.HOST_NAME || "Host"},</p><p>${v.GUEST_NAME || "A guest"} left new feedback for <strong>${v.CLASS_TITLE}</strong>.</p>${button("Read Review", dashUrl + "?tab=reviews")}`;
      break;

    case "message_new_conversation":
      body = `<p>Hi ${v.RECIPIENT_NAME || "there"},</p><p>${v.SENDER_NAME || "Someone"} sent you a message about <strong>${v.CONTEXT_TITLE || "a listing"}</strong>.</p>${button("View Conversation", v.CONVERSATION_URL || messagesUrl)}`;
      break;

    case "message_unread_reminder":
      body = `<p>Hi ${v.RECIPIENT_NAME || "there"},</p><p>You have unread messages waiting on HERD.</p>${button("Go to Messages", messagesUrl)}`;
      break;
  }

  return `
  <div style="background:#f8f9f6;padding:32px;font-family:Helvetica,Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08);">
      ${header}
      <div style="padding:28px 32px;font-size:15px;color:#333;line-height:1.6;">
        ${body}
        <p style="margin-top:32px;color:#6b6b6b;">— The HERD Team</p>
      </div>
      ${footer}
    </div>
  </div>`;
}

// Send email
async function sendEmail(to: string, type: EmailType, vars: EmailVars) {
  const subject = subjectFor(type, vars);
  const html = renderEmailHTML(type, vars);

  const result = await resend.emails.send({
    from: "HERD <notifications@herdstaging.dev>",
    to,
    subject,
    html,
  });

  return result;
}

function normalizeVars(raw: unknown): EmailVars {
  if (!raw || typeof raw !== "object") return {};
  const output: EmailVars = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      output[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      output[key] = String(value);
    } else if (value instanceof Date) {
      output[key] = value.toISOString();
    } else {
      try {
        output[key] = JSON.stringify(value);
      } catch {
        output[key] = String(value);
      }
    }
  }
  return output;
}

async function processQueuedJobs(limit = 25) {
  const summary = {
    pulled: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  const { data: jobs, error } = await supabase
    .from("email_jobs")
    .select("id, type, to_email, vars, attempts")
    .eq("status", "QUEUED")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  if (!jobs || jobs.length === 0) return summary;

  summary.pulled = jobs.length;

  for (const job of jobs) {
    const jobId = job.id;
    if (!jobId) {
      summary.skipped++;
      continue;
    }

    const attempts = Number.isFinite(job.attempts) ? Number(job.attempts) : 0;

    const markJob = async (payload: Record<string, unknown>) => {
      await supabase.from("email_jobs").update(payload).eq("id", jobId);
    };

    if (!job.to_email) {
      await markJob({
        status: "FAILED",
        attempts: attempts + 1,
        last_error: "Missing to_email",
      });
      summary.failed++;
      continue;
    }

    if (!isEmailType(job.type)) {
      await markJob({
        status: "FAILED",
        attempts: attempts + 1,
        last_error: `Unsupported email type: ${job.type ?? "unknown"}`.slice(0, 250),
      });
      summary.failed++;
      continue;
    }

    try {
      await sendEmail(job.to_email, job.type, normalizeVars(job.vars));
      await markJob({
        status: "SENT",
        attempts: attempts + 1,
        last_error: null,
        sent_at: new Date().toISOString(),
      });
      summary.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nextAttempts = attempts + 1;
      const shouldFail = nextAttempts >= MAX_ATTEMPTS;
      await markJob({
        status: shouldFail ? "FAILED" : "QUEUED",
        attempts: nextAttempts,
        last_error: message.slice(0, 250),
      });
      if (shouldFail) summary.failed++;
      else summary.skipped++;
    }
  }

  return summary;
}

// Supabase handler
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) ?? {};
    } catch {
      body = {};
    }

    const to = typeof body.to === "string" && body.to.trim().length > 0 ? body.to.trim() : null;
    const rawType = body.type;

    if (to && rawType) {
      if (!isEmailType(rawType)) {
        return new Response(JSON.stringify({ error: "Unsupported email type" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      try {
        const result = await sendEmail(to, rawType, normalizeVars(body.vars));
        return new Response(JSON.stringify({ ok: true, result }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[emails] direct send failed", err);
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    try {
      const limit = typeof body.limit === "number" && Number.isFinite(body.limit)
        ? Math.max(1, Math.min(1000, Math.floor(body.limit)))
        : undefined;
      const summary = await processQueuedJobs(limit);
      return new Response(JSON.stringify({ ok: true, ...summary }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[emails] queue processing error", err);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, service: "emails" }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
