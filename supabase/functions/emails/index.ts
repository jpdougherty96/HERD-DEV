// supabase/functions/emails/index.ts
// HERD Email Dispatcher — processes queued jobs and supports direct sends

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@3.2.0";

type EmailVars = Record<string, unknown>;

interface EmailJob {
  id: string;
  type: string | null;
  to_email: string | null;
  subject: string | null;
  template: string | null;
  vars: EmailVars | null;
  attempts: number;
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const resend = new Resend(Deno.env.get("RESEND_API_KEY")!);

const RAW_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? null;
const SANDBOX_FROM_EMAIL = Deno.env.get("RESEND_SANDBOX_FROM_EMAIL") ?? "HERD Sandbox <onboarding@resend.dev>";
const NODE_ENV = (Deno.env.get("NODE_ENV") ?? Deno.env.get("ENVIRONMENT") ?? "").toLowerCase();
const IS_PRODUCTION = NODE_ENV === "production" || NODE_ENV === "prod";
const FORCE_SANDBOX = Deno.env.get("RESEND_FORCE_SANDBOX") === "true";
const AUTO_SANDBOX = FORCE_SANDBOX || (!IS_PRODUCTION && Deno.env.get("RESEND_AUTO_SANDBOX") !== "false");
const EMAILS_KEY = Deno.env.get("EMAILS_KEY") ?? null;
const RATE_LIMIT_MS = Number(Deno.env.get("EMAILS_RATE_LIMIT_MS") ?? "250");
const MAX_ATTEMPTS = Number(Deno.env.get("EMAILS_MAX_ATTEMPTS") ?? "5");
const DEFAULT_BATCH_LIMIT = Number(Deno.env.get("EMAILS_DISPATCH_BATCH") ?? "20");
const EMAIL_BASE_URL =
  Deno.env.get("EMAILS_BASE_URL") ??
  Deno.env.get("SITE_URL") ??
  "http://localhost:3000";
const BASE_URL_OBJECT = (() => {
  try {
    return new URL(EMAIL_BASE_URL);
  } catch {
    return new URL("http://localhost:3000");
  }
})();
const FORCE_LOCAL_BASE =
  Deno.env.get("EMAILS_FORCE_LOCALHOST") === "true" || !IS_PRODUCTION;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "content-type, x-herd-key, authorization, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function withCors(extra: Record<string, string> = {}) {
  return { ...CORS_HEADERS, ...extra };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ "Content-Type": "application/json" }),
  });
}

function isAuthorized(req: Request) {
  if (!EMAILS_KEY) return true;
  const header = req.headers.get("x-herd-key") ?? req.headers.get("X-Herd-Key");
  return header === EMAILS_KEY;
}

function normalizeType(type?: string | null, template?: string | null) {
  if (type && type.trim().length) return type.trim();
  if (template && template.trim().length) {
    return template
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }
  return "generic_notification";
}

function normalizeVars(raw?: EmailVars | null): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
    else if (value instanceof Date) out[key] = value.toISOString();
    else out[key] = JSON.stringify(value);
  }
  return out;
}

function toRecipientList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    return items.length ? items : undefined;
  }
  const single = String(value).trim();
  return single ? [single] : undefined;
}

function delay(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function buildFromBase(path?: string | null) {
  const base = new URL(BASE_URL_OBJECT.toString());
  if (!path || !path.trim().length) return base.toString();

  const trimmed = path.trim();

  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const external = new URL(trimmed);
      base.pathname = external.pathname;
      base.search = external.search;
      base.hash = external.hash;
      return base.toString();
    }
  } catch {
    // ignore parse errors
  }

  if (trimmed.startsWith("?")) {
    base.search = trimmed;
    base.hash = "";
    return base.toString();
  }
  if (trimmed.startsWith("#")) {
    base.hash = trimmed;
    return base.toString();
  }

  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return new URL(normalized, base).toString();
}

function toAbsoluteUrl(input?: string | null, fallbackPath?: string) {
  const candidate = !FORCE_LOCAL_BASE && input && input.trim().length ? input.trim() : null;
  if (candidate) {
    try {
      return new URL(candidate, BASE_URL_OBJECT).toString();
    } catch {
      // fall back to base handling
    }
  }
  if (fallbackPath) {
    return buildFromBase(fallbackPath);
  }
  return BASE_URL_OBJECT.toString();
}

function hostDashboardLink(preferred: string | null | undefined, params: Record<string, string | null | undefined>) {
  const search = new URLSearchParams();
  search.set("page", "dashboard");
  for (const [key, rawValue] of Object.entries(params)) {
    if (rawValue === undefined || rawValue === null) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    search.set(key, value);
  }
  const fallbackPath = `/dashboard?${search.toString()}`;
  return toAbsoluteUrl(preferred ?? undefined, fallbackPath);
}

function extractEmail(address: string | null | undefined) {
  if (!address) return null;
  const trimmed = address.trim();
  const match = trimmed.match(/<([^>]+)>$/);
  const email = match ? match[1] : trimmed;
  return email.includes("@") ? email : null;
}

function resolveSender(preferred?: string | null) {
  const candidate = preferred ?? RAW_FROM_EMAIL;
  if (AUTO_SANDBOX) {
    const replyTo = extractEmail(candidate);
    return { from: SANDBOX_FROM_EMAIL, replyTo: replyTo ?? undefined };
  }
  if (!candidate) {
    return { from: SANDBOX_FROM_EMAIL };
  }
  const email = extractEmail(candidate);
  const domain = email?.split("@").pop()?.toLowerCase() ?? "";
  const verifiedDomains = (Deno.env.get("RESEND_VERIFIED_DOMAINS") ?? "")
    .split(",")
    .map((d: string) => d.trim().toLowerCase())
    .filter(Boolean);
  const isVerified = verifiedDomains.includes(domain);
  const isResendDomain = domain.endsWith(".resend.dev");
  if (isVerified || isResendDomain) {
    return { from: candidate };
  }
  if (FORCE_SANDBOX) {
    return { from: SANDBOX_FROM_EMAIL, replyTo: email ?? undefined };
  }
  return { from: candidate };
}

async function deliverEmail(opts: {
  to: string;
  type: string;
  subject?: string | null;
  vars?: Record<string, string>;
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  replyTo?: string | null;
  from?: string | null;
}) {
  const vars = opts.vars ?? {};
  const subject = (opts.subject && opts.subject.trim().length)
    ? opts.subject
    : subjectFor(opts.type, vars);

  const sender = resolveSender(opts.from ?? null);
  const replyTo = opts.replyTo ?? sender.replyTo ?? undefined;

  const html = renderHtml(opts.type, vars);
  const text = renderText(opts.type, vars);

  const result = await resend.emails.send({
    from: sender.from,
    to: opts.to,
    subject,
    html,
    text,
    cc: opts.cc,
    bcc: opts.bcc,
    reply_to: replyTo,
  });

  const resendError = (result as { error?: { message?: string } }).error;
  if (resendError) {
    throw new Error(resendError.message ?? "Resend email delivery failed");
  }

  const resendData = (result as { data?: { id?: string | null } }).data;
  return { id: resendData?.id ?? null, subject };
}

async function claimJob(job: EmailJob) {
  const { data, error } = await supabase
    .from("email_jobs")
    .update({
      status: "SENDING",
      attempts: job.attempts + 1,
      last_error: null,
    })
    .eq("id", job.id)
    .eq("status", "QUEUED")
    .select("id, attempts");

  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0];
}

async function completeJob(jobId: string, status: "SENT" | "FAILED" | "QUEUED", attempts: number, lastError?: string) {
  const payload: Record<string, unknown> = {
    status,
    attempts,
    last_error: lastError ?? null,
  };
  if (status === "SENT") {
    payload.sent_at = new Date().toISOString();
  }
  const { error } = await supabase
    .from("email_jobs")
    .update(payload)
    .eq("id", jobId);
  if (error) throw error;
}

async function processQueue(limit: number) {
  const summary = {
    pulled: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  const { data: jobs, error } = await supabase
    .from("email_jobs")
    .select("id, type, to_email, subject, template, vars, attempts")
    .eq("status", "QUEUED")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  if (!jobs || jobs.length === 0) return { ...summary, pulled: 0 };

  summary.pulled = jobs.length;

  for (const job of jobs) {
    if (!job.to_email) {
      summary.failed++;
      const errMsg = "Missing recipient email";
      await completeJob(job.id, "FAILED", job.attempts + 1, errMsg);
      continue;
    }

    const claim = await claimJob(job);
    if (!claim) {
      summary.skipped++;
      continue;
    }

    summary.claimed++;

    const attempts = claim.attempts ?? job.attempts + 1;
    const type = normalizeType(job.type ?? undefined, job.template ?? undefined);
    const vars = normalizeVars(job.vars ?? undefined);

    try {
      const to = job.to_email;
      const subject = job.subject ?? null;
      await deliverEmail({ to, type, subject, vars });
      await completeJob(job.id, "SENT", attempts);
      summary.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lastError = message.slice(0, 500);
      const retry = attempts < MAX_ATTEMPTS;
      await completeJob(job.id, retry ? "QUEUED" : "FAILED", attempts, lastError);
      summary.failed++;
      console.error("[emails] send error", job.id, message);
    }

    if (RATE_LIMIT_MS > 0) {
      await delay(RATE_LIMIT_MS);
    }
  }

  return summary;
}

// ---- helper: build subject lines
function subjectFor(type: string, vars: Record<string, string>) {
  const title = vars.CLASS_TITLE || "HERD Class";
  switch (type) {
    case "booking_requested_host":
      return `New booking request: ${title}`;
    case "booking_requested_guest":
      return `Your booking request for ${title}`;
    case "booking_confirmed_host":
      return `Booking confirmed: ${title}`;
    case "booking_confirmed_guest":
      return `Your booking is confirmed: ${title}`;
    case "booking_denied_guest":
      return `Booking denied: ${title}`;
    case "class_start_reminder":
      return `Reminder: ${title} starts soon`;
    case "payout_released_host":
      return `Your HERD payout has been deposited`;
    case "review_invite_guest":
      return `How was your class with ${vars.HOST_NAME || "your host"}?`;
    case "review_comment_host":
      return `You received feedback from ${vars.GUEST_NAME || "a guest"}`;
    case "payout_released_host_batch":
      return `Your HERD payout for ${title} has been released`;
    default:
      return `HERD notification: ${title}`;
  }
}

function v(vars: Record<string, string>, key: string, fallback = "") {
  const value = vars[key];
  return value && value.trim().length ? value : fallback;
}

function formatCurrencyValue(input?: string | null) {
  if (!input) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^-?\$/.test(trimmed)) return trimmed;
  const negative = trimmed.startsWith("-");
  const numeric = negative ? trimmed.slice(1).trim() : trimmed;
  const prefixed = `$${numeric}`;
  return negative ? `-${prefixed}` : prefixed;
}

function currency(vars: Record<string, string>, key: string): string {
  return formatCurrencyValue(v(vars, key));
}

function formatDateRangeText(start?: string, end?: string, separator = " to ") {
  const startValue = start?.trim() ?? "";
  const endValue = end?.trim() ?? "";
  if (!startValue) return "";
  if (!endValue || endValue === startValue) return startValue;
  return `${startValue}${separator}${endValue}`;
}

function renderBody(type: string, vars: Record<string, string>) {
  const lines: string[] = [];
  const hostName = v(vars, "HOST_NAME", "Host");
  const guestName = v(vars, "GUEST_NAME", "Guest");
  const classTitle = v(vars, "CLASS_TITLE", "your class");
  const classDate = v(vars, "CLASS_DATE");
  const classEndDate = v(vars, "CLASS_END_DATE");
  const classDateRange = formatDateRangeText(classDate, classEndDate);
  const classTime = v(vars, "CLASS_TIME");
  const classAddress = v(vars, "CLASS_ADDRESS");
  const studentCount = v(vars, "STUDENT_COUNT");
  const totalAmount = currency(vars, "TOTAL_AMOUNT");
  const totalCollected = currency(vars, "TOTAL_COLLECTED");
  const platformFees = currency(vars, "PLATFORM_FEES");
  const hostEarnings = currency(vars, "HOST_EARNINGS");

  switch (type) {
    case "booking_requested_host": {
      lines.push(`Hi ${hostName},`, "");
      lines.push(`${guestName} requested to book ${classTitle}.`);
      if (studentCount) lines.push(`Guests: ${studentCount}`);
      if (classDateRange) lines.push(`Dates: ${classDateRange}${classTime ? ` at ${classTime}` : ""}`);
      if (classAddress) lines.push(`Location: ${classAddress}`);
      lines.push("");
      if (v(vars, "APPROVE_URL")) lines.push(`Approve: ${v(vars, "APPROVE_URL")}`);
      if (v(vars, "DECLINE_URL")) lines.push(`Decline: ${v(vars, "DECLINE_URL")}`);
      if (!v(vars, "APPROVE_URL") && !v(vars, "DECLINE_URL")) {
        lines.push("Visit your HERD dashboard to approve or decline this request.");
      }
      break;
    }

    case "booking_requested_guest": {
      lines.push(`Hi ${guestName},`, "");
      lines.push(`We sent your booking request for ${classTitle} to ${hostName}.`);
      lines.push("We'll email you as soon as the host responds.");
      break;
    }

    case "booking_confirmed_host": {
      lines.push(`Hi ${hostName},`, "");
      lines.push(`Great news! ${guestName}'s booking for ${classTitle} is confirmed.`);
      if (studentCount) lines.push(`Guests: ${studentCount}`);
      if (classDateRange) lines.push(`Dates: ${classDateRange}${classTime ? ` at ${classTime}` : ""}`);
      if (classAddress) lines.push(`Location: ${classAddress}`);
      if (classDate && classEndDate && classEndDate !== classDate) {
        lines.push(`This class runs from ${classDate} to ${classEndDate}.`);
      }
      lines.push("");
      lines.push("Visit your HERD dashboard if you need to message the guest or adjust details.");
      break;
    }

    case "booking_confirmed_guest": {
      lines.push(`Hi ${guestName},`, "");
      lines.push(`Your booking for ${classTitle} is confirmed!`);
      if (classDateRange) lines.push(`Dates: ${classDateRange}${classTime ? ` at ${classTime}` : ""}`);
      if (classAddress) lines.push(`Location: ${classAddress}`);
      if (totalAmount) lines.push(`Total paid: ${totalAmount}`);
      if (classDate && classEndDate && classEndDate !== classDate) {
        lines.push(`Your class runs from ${classDate} to ${classEndDate}.`);
      }
      lines.push("");
      lines.push("Reach out to your host from the HERD dashboard if you have any questions.");
      break;
    }

    case "class_start_reminder": {
      lines.push(`Hi ${guestName},`, "");
      lines.push(`Just a reminder—${classTitle} is coming up.`);
      if (classDateRange) lines.push(`Dates: ${classDateRange}${classTime ? ` at ${classTime}` : ""}`);
      if (classDate && classEndDate && classEndDate !== classDate) {
        lines.push(`Your class runs from ${classDate} to ${classEndDate}.`);
      }
      if (classAddress) lines.push(`Location: ${classAddress}`);
      lines.push("");
      lines.push("We can't wait to see what you learn!");
      break;
    }

    case "booking_denied_guest": {
      lines.push(`Hi ${guestName},`, "");
      lines.push(`We’re sorry — your booking request for ${classTitle} wasn’t approved.`);
      lines.push("Your host may have reached capacity or had a schedule conflict.");
      if (v(vars, "HOST_MESSAGE")) lines.push("", `Host note: ${v(vars, "HOST_MESSAGE")}`);
      lines.push("");
      lines.push("Browse other classes on HERD to find a great fit.");
      break;
    }

    case "payout_released_host":
    case "payout_released_host_batch": {
      lines.push(`Hi ${hostName},`, "");
      lines.push(`Your payout for ${classTitle} has been released.`);
      if (totalCollected) lines.push(`Total collected: ${totalCollected}`);
      if (platformFees) lines.push(`Platform fees: ${platformFees}`);
      if (hostEarnings) lines.push(`Your earnings: ${hostEarnings}`);
      if (v(vars, "ESTIMATED_ARRIVAL")) lines.push(`Estimated arrival: ${v(vars, "ESTIMATED_ARRIVAL")}`);
      lines.push("");
      lines.push("Check your payout history anytime from the HERD dashboard.");
      break;
    }

    case "review_invite_guest": {
      lines.push(`Hi ${guestName},`, "");
      lines.push(`Thanks for attending ${classTitle}! We'd love to hear how it went.`);
      if (v(vars, "REVIEW_URL")) {
        lines.push("", `Share your feedback: ${v(vars, "REVIEW_URL")}`);
      }
      lines.push("");
      lines.push("Your insights help hosts improve and the community grow. Thank you!");
      break;
    }

    case "review_comment_host": {
      lines.push(`Hi ${hostName},`, "");
      lines.push(`${guestName} left new feedback on ${classTitle}.`);
      lines.push("Log into HERD to read the full review and keep growing your classes.");
      break;
    }

    default: {
      const greetingName = v(vars, "GUEST_NAME", v(vars, "HOST_NAME", "there"));
      lines.push(`Hi ${greetingName},`, "");
      lines.push("You have an update from HERD.");
      lines.push("Visit your dashboard for the latest details.");
      break;
    }
  }

  lines.push("", "— The HERD Team");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function renderText(type: string, vars: Record<string, string>) {
  return renderBody(type, vars);
}

const EMAIL_THEME = {
  brand: "#C54A2C",
  brandText: "#FFF9F1",
  bodyBg: "#F5F0E6",
  cardBg: "#FFFEFB",
  border: "#E7E0D4",
  heading: "#3C4F21",
  text: "#2E2B23",
  muted: "#6B6E58",
  badgeBg: "#E1E8D8",
  badgeText: "#40502B",
  button: "#C54A2C",
  buttonText: "#FFFFFF",
  buttonAlt: "#E7DACC",
  footerBg: "#EFE7DA",
  footerText: "#6B6E58",
};

// ---- HTML renderer
function renderHtml(type: string, vars: Record<string, string>) {
  const title = subjectFor(type, vars);
  const year = new Date().getFullYear();
  const hostName = v(vars, "HOST_NAME", "Host");
  const guestName = v(vars, "GUEST_NAME", "Guest");
  const classTitle = v(vars, "CLASS_TITLE", "your class");
  const classDate = v(vars, "CLASS_DATE");
  const classEndDate = v(vars, "CLASS_END_DATE");
  const classDateRange = formatDateRangeText(classDate, classEndDate, " – ");
  const classTime = v(vars, "CLASS_TIME");
  const classAddress = v(vars, "CLASS_ADDRESS");
  const studentCount = v(vars, "STUDENT_COUNT");
  const totalAmount = currency(vars, "TOTAL_AMOUNT");
  const totalCollected = currency(vars, "TOTAL_COLLECTED");
  const platformFees = currency(vars, "PLATFORM_FEES");
  const hostEarnings = currency(vars, "HOST_EARNINGS");
  const stripeFees = currency(vars, "STRIPE_FEES");
  const bookingId = v(vars, "BOOKING_ID");
  const guestId = v(vars, "GUEST_ID");
  const classId = v(vars, "CLASS_ID");
  const conversationId = v(vars, "CONVERSATION_ID");
  const supportEmail = v(
    vars,
    "SUPPORT_EMAIL",
    type.includes("payout") ? "payments@herd.com" : "support@herd.app",
  );
  const dashboardUrl = toAbsoluteUrl(v(vars, "DASHBOARD_URL"), "/dashboard") ?? toAbsoluteUrl(undefined, "/dashboard") ?? EMAIL_BASE_URL;
  const classesUrl = toAbsoluteUrl(v(vars, "CLASSES_URL"), "/classes");
  const hostBookingsUrl = hostDashboardLink(v(vars, "BOOKING_URL"), {
    tab: "bookings",
    booking: bookingId,
  });
  const hostApproveUrl = hostDashboardLink(v(vars, "APPROVE_URL"), {
    tab: "bookings",
    booking: bookingId,
  });
  const hostDeclineUrl = hostDashboardLink(v(vars, "DECLINE_URL"), {
    tab: "bookings",
    booking: bookingId,
  });
  const hostMessagesUrl = hostDashboardLink(v(vars, "MESSAGE_URL"), {
    tab: "messages",
    booking: bookingId,
    guest: guestId,
    guest_name: guestName,
    class: classId,
    class_title: classTitle,
    conversation: conversationId,
  });

  const section = (heading: string, content: string) => {
    if (!content.trim()) return "";
    return `
      <div style="margin-top:32px;">
        <h3 style="margin:0 0 12px;font-size:16px;font-weight:600;color:${EMAIL_THEME.heading};">${heading}</h3>
        ${content}
      </div>
    `;
  };

  const detailTable = (rows: Array<{ label: string; value?: string; icon?: string }>) => {
    const htmlRows = rows
      .filter((r) => r.value && r.value.trim())
      .map(
        (r) => `
          <tr>
            <td style="padding:6px 0;color:${EMAIL_THEME.muted};font-size:13px;white-space:nowrap;">
              ${r.icon ? `<span style="margin-right:8px;">${r.icon}</span>` : ""}${r.label}
            </td>
            <td style="padding:6px 0;color:${EMAIL_THEME.text};font-size:14px;">${r.value}</td>
          </tr>`,
      )
      .join("");
    if (!htmlRows.trim()) return "";
    return `
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${htmlRows}</tbody>
      </table>
    `;
  };

  const amountTable = (
    rows: Array<{ label: string; value?: string; emphasize?: boolean; muted?: boolean }>,
  ) => {
    const htmlRows = rows
      .filter((r) => r.value && r.value.trim())
      .map(
        (r) => `
          <tr>
            <td style="padding:10px 0;color:${r.muted ? EMAIL_THEME.muted : EMAIL_THEME.text};font-size:14px;">${r.label}</td>
            <td style="padding:10px 0;color:${r.emphasize ? "#3E6B34" : EMAIL_THEME.text};font-size:${
              r.emphasize ? "16px" : "14px"
            };text-align:right;font-weight:${r.emphasize ? "600" : "400"};">${r.value}</td>
          </tr>`,
      )
      .join("");
    if (!htmlRows.trim()) return "";
    return `
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${htmlRows}</tbody>
      </table>
    `;
  };

  const bulletList = (items: string[]) => {
  const filtered = items.filter((item) => item && item.trim());
  if (!filtered.length) return "";
  return `
      <ul style="margin:12px 0 0;padding-left:20px;color:${EMAIL_THEME.muted};font-size:14px;line-height:1.6;">
        ${filtered.map((item) => `<li style="margin:6px 0;">${item}</li>`).join("")}
      </ul>
    `;
  };

  const buttonBaseStyle = `
      display:inline-block;
      padding:12px 24px;
      border-radius:14px;
      font-size:14px;
      font-weight:600;
      text-decoration:none;
      min-width:180px;
      text-align:center;
      letter-spacing:0.2px;
  `
    .replace(/\s+/g, " ")
    .trim();

  const primaryButton = (label: string, href?: string | null, fallbackPath?: string) => {
    const resolved = toAbsoluteUrl(href ?? undefined, fallbackPath);
    if (!resolved) return "";
    return `
      <a href="${resolved}" target="_blank" style="${buttonBaseStyle};background:${EMAIL_THEME.button};color:${EMAIL_THEME.buttonText};box-shadow:0 6px 16px rgba(197,74,44,0.18);">
        ${label}
      </a>
    `;
  };

  const secondaryButton = (label: string, href?: string | null, fallbackPath?: string) => {
    const resolved = toAbsoluteUrl(href ?? undefined, fallbackPath);
    if (!resolved) return "";
    return `
      <a href="${resolved}" target="_blank" style="${buttonBaseStyle};background:${EMAIL_THEME.buttonAlt};color:${EMAIL_THEME.heading};">
        ${label}
      </a>
    `;
  };

  const ctaRow = (...buttons: string[]) => {
    const rendered = buttons.filter((btn) => btn && btn.trim());
    if (!rendered.length) return "";
    return `
      <div style="margin-top:32px;display:flex;gap:12px;flex-wrap:wrap;">
        ${rendered.join("")}
      </div>
    `;
  };

  let heroLabel = "";
  let greeting = `Hi ${type.includes("guest") ? guestName : hostName},`;
  let intro = "You have a new update from HERD.";
  const sections: string[] = [];
  let whatsNext: string | null = null;
  let cta = "";
  let closingLine = "Thank you for being part of the HERD community!";
  let signature = "Best regards,<br>The HERD Team";

  switch (type) {
    case "payout_released_host":
    case "payout_released_host_batch": {
      heroLabel = "Payment Released";
      intro = `Great news! Your payment for <strong>${classTitle}</strong> has been released and is on its way to your account.`;

      sections.push(
        section(
          "Class Details",
          detailTable([
            { label: "Dates", value: classDateRange, icon: "📅" },
            { label: "Time", value: classTime, icon: "⏰" },
            { label: "Location", value: classAddress, icon: "📍" },
            { label: "Attendees", value: studentCount ? `${studentCount}` : "", icon: "👥" },
          ]),
        ),
      );

      sections.push(
        section(
          "Payment Breakdown",
          `
            <div style="background:${EMAIL_THEME.badgeBg};border-radius:16px;padding:18px;">
              ${amountTable([
                { label: "Total Revenue", value: totalCollected || totalAmount },
                { label: "Platform Fee", value: platformFees, muted: true },
                { label: "Stripe Fee", value: stripeFees },
                { label: "Your Payment", value: hostEarnings, emphasize: true },
              ])}
            </div>
          `,
        ),
      );

      sections.push(
        section(
          "Payment Information",
          detailTable([
            { label: "Payment Method", value: v(vars, "PAYMENT_METHOD", "Bank Account ending in ****") },
            { label: "Estimated Arrival", value: v(vars, "ESTIMATED_ARRIVAL", "1–2 business days") },
            { label: "Payout ID", value: v(vars, "PAYOUT_ID") },
          ]),
        ),
      );

      whatsNext = bulletList([
        "You'll receive a notification once the payment arrives in your account.",
        "View your payment history anytime in your HERD dashboard.",
        "Questions? Our support team is here to help.",
      ]);

      cta = ctaRow(
        primaryButton("Create New Class", v(vars, "CREATE_CLASS_URL"), "/create-class"),
        secondaryButton("View Payments", v(vars, "PAYOUTS_URL"), "/dashboard/payouts"),
      );
      break;
    }

    case "booking_requested_host": {
      heroLabel = "Booking Request";
      intro = `${guestName} would love to join <strong>${classTitle}</strong>. Review the request and respond when you're ready.`;

      sections.push(
        section(
          "Class Details",
          detailTable([
            { label: "Dates", value: classDateRange, icon: "📅" },
            { label: "Time", value: classTime, icon: "⏰" },
            { label: "Location", value: classAddress, icon: "📍" },
            { label: "Students", value: studentCount, icon: "👥" },
          ]),
        ),
      );

      sections.push(
        section(
          "Request Summary",
          detailTable([
            { label: "Guest", value: guestName },
            { label: "Guest Email", value: v(vars, "GUEST_EMAIL") },
            { label: "Requested Students", value: studentCount },
            { label: "Estimated Earnings", value: hostEarnings },
          ]),
        ),
      );

      whatsNext = bulletList([
        "Approve or decline within 24 hours for the best guest experience.",
        "Message the guest if you need more details before deciding.",
        "Need help? We're always available to support you.",
      ]);

      cta = ctaRow(
        primaryButton("Review Request", hostApproveUrl),
        secondaryButton("Decline", hostDeclineUrl),
      );
      break;
    }

    case "booking_requested_guest": {
      heroLabel = "Request Received";
      intro = `We let ${hostName} know you'd like to join <strong>${classTitle}</strong>. We'll email you as soon as they respond.`;

      sections.push(
        section(
          "Request Details",
          detailTable([
            { label: "Class", value: classTitle },
            { label: "Host", value: hostName },
            { label: "Dates", value: classDateRange },
            { label: "Guests", value: studentCount },
            { label: "Total Amount", value: totalAmount },
          ]),
        ),
      );

      whatsNext = bulletList([
        "Hosts usually respond within 24 hours.",
        "You won’t be charged until the host approves your booking.",
        "Need to make a change? Reply to this email and our team can help.",
      ]);

      cta = ctaRow(primaryButton("View Your Request", v(vars, "BOOKING_URL"), "/dashboard"));
      break;
    }

    case "booking_confirmed_host": {
      heroLabel = "Booking Confirmed";
      const rangeNote = classDateRange ? ` The class runs from ${classDateRange}.` : "";
      intro = `You're all set! ${guestName}'s booking for <strong>${classTitle}</strong> is confirmed.${rangeNote}`;

      sections.push(
        section(
          "Class Details",
          detailTable([
            { label: "Dates", value: classDateRange, icon: "📅" },
            { label: "Time", value: classTime, icon: "⏰" },
            { label: "Location", value: classAddress, icon: "📍" },
            { label: "Students", value: studentCount, icon: "👥" },
          ]),
        ),
      );

      sections.push(
        section(
          "Guest Details",
          detailTable([
            { label: "Guest Name", value: guestName },
            { label: "Guest Email", value: v(vars, "GUEST_EMAIL") },
            { label: "Student Names", value: v(vars, "STUDENT_NAMES") },
            { label: "Host Earnings", value: hostEarnings },
          ]),
        ),
      );

      whatsNext = bulletList([
        "Send the guest a welcome message to say hello.",
        "Review your class logistics and materials.",
        "Track this booking and more in your HERD dashboard.",
      ]);

      cta = ctaRow(
        primaryButton("View Booking", hostBookingsUrl),
        secondaryButton("Message Guest", hostMessagesUrl),
      );
      break;
    }

    case "booking_confirmed_guest": {
      heroLabel = "Booking Confirmed";
      const rangeNote = classDateRange ? ` Your class runs from ${classDateRange}.` : "";
      intro = `Great news! Your booking for <strong>${classTitle}</strong> is confirmed.${rangeNote}`;

      sections.push(
        section(
          "Class Details",
          detailTable([
            { label: "Host", value: hostName },
            { label: "Dates", value: classDateRange },
            { label: "Time", value: classTime },
            { label: "Location", value: classAddress },
            { label: "Students", value: studentCount },
            { label: "Total Paid", value: totalAmount },
          ]),
        ),
      );

      whatsNext = bulletList([
        "Plan to arrive a few minutes early.",
        "Message your host anytime from your HERD dashboard.",
        "Invite a friend—many classes welcome extra guests!",
      ]);

      cta = ctaRow(primaryButton("View Booking", v(vars, "BOOKING_URL"), "/dashboard"));
      break;
    }

    case "class_start_reminder": {
      heroLabel = "Class Reminder";
      const rangeNote = classDateRange ? ` It runs from ${classDateRange}.` : "";
      intro = `Get ready! <strong>${classTitle}</strong> is coming up soon.${rangeNote}`;

      sections.push(
        section(
          "Class Details",
          detailTable([
            { label: "Host", value: hostName },
            { label: "Dates", value: classDateRange },
            { label: "Time", value: classTime },
            { label: "Location", value: classAddress },
          ]),
        ),
      );

      whatsNext = bulletList([
        "Review any preparatory notes from your host.",
        "Confirm travel plans and arrive a bit early.",
        "Reach out through HERD messaging if you have last-minute questions.",
      ]);

      cta = ctaRow(primaryButton("View Booking", v(vars, "BOOKING_URL"), "/dashboard"));
      break;
    }

    case "booking_denied_guest": {
      heroLabel = "Booking Update";
      intro = `We’re sorry — your booking request for <strong>${classTitle}</strong> wasn’t approved.`;
      sections.push(
        section(
          "Why this happens",
          `<p style="margin:0;color:${EMAIL_THEME.muted};font-size:14px;line-height:1.7;">Your host may have reached capacity or had a schedule conflict.</p>`,
        ),
      );

      const hostMessage = v(vars, "HOST_MESSAGE");
      if (hostMessage) {
        sections.push(
          section(
            "Host Message",
            `<div style="background:${EMAIL_THEME.badgeBg};border-radius:16px;padding:18px;color:${EMAIL_THEME.heading};font-size:14px;line-height:1.6;">${hostMessage}</div>`,
          ),
        );
      }

      whatsNext = bulletList([
        "Explore similar classes from other HERD hosts.",
        "Reach out if you need help finding the perfect experience.",
      ]);

      cta = ctaRow(primaryButton("Find Another Class", classesUrl));
      break;
    }

    case "review_invite_guest": {
      heroLabel = "Share Your Experience";
      intro = `We hope you enjoyed <strong>${classTitle}</strong>. Could you take a minute to share how it went?`;

      whatsNext = bulletList([
        "Reviews help hosts grow and guide future guests.",
        "It only takes a minute, and you can update it anytime.",
      ]);

      cta = ctaRow(primaryButton("Leave a Review", v(vars, "REVIEW_URL"), "/dashboard/reviews"));
      break;
    }

    case "review_comment_host": {
      heroLabel = "New Review";
      intro = `${guestName} just shared feedback about <strong>${classTitle}</strong>.`;

      whatsNext = bulletList([
        "Respond to reviews to keep the conversation going.",
        "Highlight great feedback in your class description.",
      ]);

      cta = ctaRow(primaryButton("Read Review", v(vars, "REVIEW_DASHBOARD_URL"), "/dashboard/reviews"));
      break;
    }
  }

  const badge = heroLabel
    ? `<div style="display:inline-block;background:${EMAIL_THEME.badgeBg};color:${EMAIL_THEME.badgeText};font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;margin-bottom:18px;">${heroLabel}</div>`
    : "";

  const sectionsHtml = sections.filter(Boolean).join("");
  const whatsNextHtml = whatsNext
    ? section("What's Next?", whatsNext)
    : "";

  const closingHtml = `
    <p style="margin:36px 0 4px;font-size:14px;color:${EMAIL_THEME.text};line-height:1.6;">${closingLine}</p>
    <p style="margin:0;color:${EMAIL_THEME.muted};font-size:13px;line-height:1.6;">${signature}</p>
  `;

  const footerHtml = `
    <div style="background:${EMAIL_THEME.footerBg};padding:20px 28px;text-align:center;color:${EMAIL_THEME.footerText};font-size:13px;line-height:1.6;">
      <p style="margin:0 0 6px;">Questions? Contact us at <a href="mailto:${supportEmail}" style="color:${EMAIL_THEME.heading};text-decoration:none;">${supportEmail}</a></p>
      <p style="margin:0;">© ${year} HERD. All rights reserved.</p>
    </div>
  `;

  return `
    <div style="background:${EMAIL_THEME.bodyBg};padding:32px 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      <div style="max-width:640px;margin:0 auto;background:${EMAIL_THEME.cardBg};border-radius:24px;overflow:hidden;box-shadow:0 18px 48px rgba(197,74,44,0.12);">
        <div style="background:${EMAIL_THEME.brand};padding:28px 32px;">
          <div style="font-family:'Rye','Georgia',serif;font-size:34px;letter-spacing:1px;color:${EMAIL_THEME.brandText};">HERD</div>
        </div>
        <div style="padding:36px 36px 24px;color:${EMAIL_THEME.text};">
          ${badge}
          <p style="margin:0 0 12px;font-size:16px;font-weight:600;color:${EMAIL_THEME.heading};">${greeting}</p>
          <p style="margin:0;font-size:15px;line-height:1.7;color:${EMAIL_THEME.text};">${intro}</p>
          ${sectionsHtml}
          ${whatsNextHtml}
          ${cta}
          ${closingHtml}
        </div>
        ${footerHtml}
      </div>
    </div>
  `;
}

serve(async (_req: Request) => {
  if (_req.method === "OPTIONS") {
    return new Response("ok", { headers: withCors() });
  }

  const url = new URL(_req.url);
  let path = url.pathname.startsWith("/emails") ? url.pathname.slice("/emails".length) : url.pathname;
  if (path === "") path = "/";
  if (!path.startsWith("/")) path = `/${path}`;

  if (_req.method === "GET" && (path === "/health" || path === "/")) {
    return json({ ok: true, service: "emails", time: new Date().toISOString() });
  }

  if (!isAuthorized(_req)) {
    return new Response("Unauthorized", { status: 401, headers: withCors() });
  }

  if (_req.method === "POST" && path === "/send") {
    const payload = await _req.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const to = (payload as Record<string, unknown>).to ?? (payload as Record<string, unknown>).to_email;
    if (!to || String(to).trim().length === 0) {
      return json({ error: "Missing recipient email" }, 400);
    }

    const type = normalizeType(
      (payload as Record<string, unknown>).type as string | undefined,
      (payload as Record<string, unknown>).template as string | undefined,
    );
    const vars = normalizeVars((payload as Record<string, unknown>).vars as EmailVars | undefined);

    try {
      const result = await deliverEmail({
        to: String(to),
        type,
        subject: (payload as Record<string, unknown>).subject as string | undefined,
        vars,
        cc: toRecipientList((payload as Record<string, unknown>).cc),
        bcc: toRecipientList((payload as Record<string, unknown>).bcc),
        replyTo: (payload as Record<string, unknown>).reply_to as string | undefined,
        from: (payload as Record<string, unknown>).from as string | undefined,
      });

      return json({ sent: true, type, id: result.id, subject: result.subject });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[emails] direct send failed", message);
      return json({ error: message }, 500);
    }
  }

  if (_req.method === "POST" && (path === "/" || path === "/dispatch" || path === "/process")) {
    const body = _req.bodyUsed ? await _req.json().catch(() => ({} as Record<string, unknown>)) : {};
    const limitRaw = (body as Record<string, unknown>).limit ?? url.searchParams.get("limit");
    const limit = Number(limitRaw);
    const batchSize = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_BATCH_LIMIT;

    try {
      const summary = await processQueue(batchSize);
      return json({ ...summary, batchSize });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[emails] queue processing error", message);
      return json({ error: message }, 500);
    }
  }

  return json({ error: "Not Found", path }, 404);
});
