import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireInternal } from "../_shared/internal.ts";
import { getStripe } from "../_shared/stripe.ts";
import { createAdminClient } from "../_shared/supabase.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const stripe = getStripe(STRIPE_SECRET_KEY, Stripe);
const admin = createAdminClient();

const isTerminalBookingStatus = (status: string | null, paymentStatus: string | null) =>
  status === "DENIED" || status === "CANCELLED" || paymentStatus === "REFUNDED";

serve(async (req: Request) => {
  const cors = corsHeaders(req, "GET, POST, OPTIONS");
  const preflight = handleCors(req, "GET, POST, OPTIONS");
  if (preflight) return preflight;

  const unauthorized = requireInternal(req, cors);
  if (unauthorized) return unauthorized;

  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, service: "reconcile-payments" }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let processed = 0;
  let resolved = 0;
  let failed = 0;

  try {
    const { data: rows, error } = await admin
      .from("payment_reconciliations")
      .select("id, booking_id, stripe_payment_intent_id, stripe_checkout_session_id, details")
      .eq("status", "OPEN");

    if (error) throw error;

    for (const row of rows ?? []) {
      processed++;
      try {
        const { data: booking, error: bookingErr } = await admin
          .from("bookings")
          .select(
            "id, status, payment_status, capture_status, stripe_payment_intent_id, stripe_checkout_session_id, captured_at",
          )
          .eq("id", row.booking_id)
          .maybeSingle();

        if (bookingErr) throw bookingErr;

        if (!booking) {
          await admin
            .from("payment_reconciliations")
            .update({
              status: "RESOLVED",
              resolved_at: new Date().toISOString(),
              details: { ...(row.details ?? {}), error: "booking_not_found" },
            })
            .eq("id", row.id);
          resolved++;
          continue;
        }

        if (isTerminalBookingStatus(booking.status ?? null, booking.payment_status ?? null)) {
          await admin
            .from("payment_reconciliations")
            .update({
              status: "RESOLVED",
              resolved_at: new Date().toISOString(),
              details: {
                ...(row.details ?? {}),
                skipped: "terminal_booking_status",
                booking_status: booking.status ?? null,
              },
            })
            .eq("id", row.id);
          resolved++;
          continue;
        }

        if (booking.capture_status === "CAPTURED" && booking.payment_status === "HELD") {
          await admin
            .from("payment_reconciliations")
            .update({
              status: "RESOLVED",
              resolved_at: new Date().toISOString(),
              details: { ...(row.details ?? {}), skipped: "already_captured" },
            })
            .eq("id", row.id);
          resolved++;
          continue;
        }

        const paymentIntentId =
          row.stripe_payment_intent_id ||
          booking.stripe_payment_intent_id ||
          null;

        if (!paymentIntentId) {
          await admin
            .from("bookings")
            .update({
              capture_status: "CAPTURE_FAILED",
              capture_last_error: "Missing payment_intent_id for reconciliation",
              updated_at: new Date().toISOString(),
            })
            .eq("id", booking.id);

          await admin
            .from("payment_reconciliations")
            .update({
              status: "RESOLVED",
              resolved_at: new Date().toISOString(),
              details: { ...(row.details ?? {}), error: "missing_payment_intent_id" },
            })
            .eq("id", row.id);
          resolved++;
          continue;
        }

        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        const isCaptured = pi.status === "succeeded";
        const nowIso = new Date().toISOString();

        if (isCaptured) {
          const { error: updateErr } = await admin
            .from("bookings")
            .update({
              status: "APPROVED",
              payment_status: "HELD",
              capture_status: "CAPTURED",
              captured_at: booking.captured_at ?? nowIso,
              capture_last_error: null,
              stripe_payment_intent_id: booking.stripe_payment_intent_id ?? paymentIntentId,
              updated_at: nowIso,
            })
            .eq("id", booking.id);

          if (updateErr) throw updateErr;

          await admin
            .from("payment_reconciliations")
            .update({
              status: "RESOLVED",
              resolved_at: nowIso,
              details: { ...(row.details ?? {}), pi_status: pi.status, action: "marked_captured" },
            })
            .eq("id", row.id);
          resolved++;
          continue;
        }

        const { error: failErr } = await admin
          .from("bookings")
          .update({
            capture_status: "CAPTURE_FAILED",
            capture_last_error: `PaymentIntent status ${pi.status}`,
            updated_at: nowIso,
          })
          .eq("id", booking.id);

        if (failErr) throw failErr;

        await admin
          .from("payment_reconciliations")
          .update({
            status: "RESOLVED",
            resolved_at: nowIso,
            details: { ...(row.details ?? {}), pi_status: pi.status, action: "marked_failed" },
          })
          .eq("id", row.id);
        resolved++;
      } catch (rowErr) {
        failed++;
        console.error("[reconcile-payments] row failed", rowErr);
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, resolved, failed }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[reconcile-payments] unexpected error", err);
    return new Response(JSON.stringify({ error: message, processed, resolved, failed }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
