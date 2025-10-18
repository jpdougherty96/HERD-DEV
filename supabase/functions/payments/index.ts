// supabase/functions/payments/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import Stripe from "npm:stripe";
import { createClient } from "npm:@supabase/supabase-js";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:3000";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:3000";
const EMAILS_KEY = Deno.env.get("EMAILS_KEY") || null; // optional, for sending emails

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing required env vars: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

const stripe = new Stripe(STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" });
const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
};
const withCors = (body: BodyInit, status = 200, extra: HeadersInit = {}) =>
  new Response(body, { status, headers: { ...cors, ...extra } });
const json = (data: unknown, status = 200) =>
  withCors(JSON.stringify(data), status, { "content-type": "application/json" });

const matches = (pathname: string, suffix: string) =>
  pathname === suffix || pathname.endsWith(suffix);

// (optional) send confirmed emails via your existing emails function
async function sendConfirmedEmails(bookingId: string) {
  try {
    const { data: b } = await admin
      .from("bookings")
      .select("id, class_id, user_id, qty, total_cents")
      .eq("id", bookingId)
      .single();
    if (!b) return;

    const { data: c } = await admin
      .from("classes")
      .select("title, start_date, address_street, address_city, address_state, address_zip, host_id")
      .eq("id", b.class_id)
      .single();

    const { data: guest } = await admin.from("profiles").select("email, full_name").eq("id", b.user_id).single();
    const { data: host }  = await admin.from("profiles").select("email, full_name").eq("id", c?.host_id).single();

    const base = SUPABASE_URL!.replace(".supabase.co", ".functions.supabase.co");
    const sendUrl = `${base}/emails/send`;
    const headers: Record<string,string> = { "Content-Type": "application/json" };
    if (EMAILS_KEY) headers["x-herd-key"] = EMAILS_KEY;

    const fullAddr = [c?.address_street, c?.address_city, c?.address_state, c?.address_zip].filter(Boolean).join(", ");

    // Guest
    await fetch(sendUrl, {
      method: "POST", headers,
      body: JSON.stringify({
        to: guest?.email,
        subject: `Booking Confirmed: ${c?.title}`,
        template: "BOOKING_CONFIRMED_GUEST",
        vars: {
          GUEST_NAME: guest?.full_name ?? "Guest",
          CLASS_TITLE: c?.title ?? "Class",
          INSTRUCTOR_NAME: host?.full_name ?? "Instructor",
          CLASS_DATE: c?.start_date,
          STUDENT_COUNT: String(b.qty ?? 1),
          STUDENT_NAMES: "",
          TOTAL_AMOUNT: (Number(b.total_cents) / 100).toFixed(2),
          CLASS_ADDRESS: fullAddr,
        },
      }),
    });

    // Host
    if (host?.email) {
      await fetch(sendUrl, {
        method: "POST", headers,
        body: JSON.stringify({
          to: host.email,
          subject: `New Booking: ${c?.title}`,
          template: "BOOKING_CONFIRMED_HOST",
          vars: {
            HOST_NAME: host.full_name ?? "Host",
            CLASS_TITLE: c?.title ?? "Class",
            GUEST_NAME: guest?.full_name ?? "Guest",
            STUDENT_COUNT: String(b.qty ?? 1),
            STUDENT_NAMES: "",
            CLASS_DATE: c?.start_date,
            HOST_EARNINGS: ((Number(b.total_cents) * 0.95) / 100).toFixed(2),
          },
        }),
      });
    }
  } catch (e) {
    console.error("sendConfirmedEmails error:", e);
  }
}

serve(async (_req: Request) => {
  const url = new URL(_req.url);

  // Preflight
  if (_req.method === "OPTIONS") return withCors("ok");

  try {
    // Health & debug
    if (_req.method === "GET" && (matches(url.pathname, "/health") || url.pathname === "/")) {
      return json({ ok: true, fn: "payments", at: new Date().toISOString(), saw_pathname: url.pathname, routes: ["/health", "/create-checkout", "/confirm", "/debug"] });
    }
    if (_req.method === "GET" && matches(url.pathname, "/debug")) {
      return json({ method: _req.method, pathname: url.pathname, origin: ALLOWED_ORIGIN });
    }

    // 1) Create Checkout session
    if (_req.method === "POST" && matches(url.pathname, "/create-checkout")) {
      const { booking_id } = await _req.json().catch(() => ({} as any));
      if (!booking_id) return withCors("booking_id required", 400);

      const { data: booking, error: bErr } = await admin
        .from("bookings")
        .select("id, total_cents, user_id, class_id")
        .eq("id", booking_id)
        .single();
      if (bErr || !booking) return withCors("booking not found", 404);

      const { data: profile } = await admin
        .from("profiles")
        .select("email")
        .eq("id", booking.user_id)
        .single();

      // IMPORTANT: include {CHECKOUT_SESSION_ID} placeholder
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: profile?.email || undefined,
        line_items: [{
          price_data: {
            currency: "usd",
            unit_amount: booking.total_cents,
            product_data: { name: "HERD class booking" },
          },
          quantity: 1,
        }],
        metadata: {
          booking_id: booking.id,
          class_id: booking.class_id,
          user_id: booking.user_id,
        },
        payment_intent_data: {
          metadata: {
            booking_id: booking.id,
            class_id: booking.class_id,
            user_id: booking.user_id,
          },
        },
        success_url: `${SITE_URL}/checkout/success?b=${booking.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/checkout/cancel?b=${booking.id}`,
      });

      await admin
        .from("bookings")
        .update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() })
        .eq("id", booking.id);

      return json({ url: session.url });
    }

    // 2) Confirm endpoint (fallback if webhook didn’t run)
    // Accepts: { session_id } OR { booking_id } (we look up session_id from DB)
    if (_req.method === "POST" && matches(url.pathname, "/confirm")) {
      const { session_id, booking_id } = await _req.json().catch(() => ({} as any));

      let sid = session_id as string | undefined;
      let bid = booking_id as string | undefined;

      if (!sid && !bid) {
        return withCors("session_id or booking_id required", 400);
      }

      if (!sid && bid) {
        // look up the session id from the booking row
        const { data: b } = await admin
          .from("bookings")
          .select("stripe_checkout_session_id")
          .eq("id", bid)
          .single();
        sid = b?.stripe_checkout_session_id ?? undefined;
      }

      if (!sid) return withCors("no session id available to confirm", 400);

      // retrieve session + PI
      const session = await stripe.checkout.sessions.retrieve(sid, { expand: ["payment_intent"] });
      const pi = typeof session.payment_intent === "object" ? session.payment_intent : null;

      // extract booking id from metadata (preferred)
      const metaBookingId = (session.metadata?.booking_id as string) || (pi?.metadata?.booking_id as string) || bid;
      if (!metaBookingId) return withCors("booking not found in metadata", 400);

      const paid =
        session.payment_status === "paid" ||
        (pi && (pi.status === "succeeded" || pi.status === "requires_capture" /* in case of manual capture */));

      if (!paid) {
        return json({
          ok: false,
          reason: "not_paid",
          session_status: session.status,
          session_payment_status: session.payment_status,
          pi_status: pi?.status ?? null,
        }, 409);
      }

      // idempotent update to PAID/APPROVED
      const update: Record<string, unknown> = {
        payment_status: "PAID",
        status: "APPROVED",
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        stripe_checkout_session_id: session.id,
      };
      if (pi?.id) update.stripe_payment_intent_id = pi.id;

      await admin
        .from("bookings")
        .update(update)
        .eq("id", metaBookingId)
        .neq("payment_status", "PAID");

      // optional emails (no-op if EMAILS_KEY is unset)
      await sendConfirmedEmails(metaBookingId);

      return json({ ok: true, booking_id: metaBookingId });
    }

    return withCors("Not found", 404);
  } catch (e: any) {
    console.error("payments error:", e);
    return withCors(e?.message || "Server error", 500);
  }
});
