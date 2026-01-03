/*
SQL migration snippet:
create unique index if not exists webhook_logs_stripe_id_key
  on public.webhook_logs (stripe_id);
create unique index if not exists bookings_stripe_checkout_session_id_key
  on public.bookings (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
*/
// supabase/functions/stripe-webhook/index.ts
import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getStripe } from "../_shared/stripe.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { LIABILITY_VERSION } from "../_shared/liability.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const STRIPE_CONNECT_WEBHOOK_SECRET = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET");
const STRIPE_CLI_WEBHOOK_SECRET = Deno.env.get("STRIPE_CLI_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("HERD_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("HERD_SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const HERD_FEE_RATE = Number(Deno.env.get("HERD_FEE_RATE") ?? 0.15);

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required environment variables");
}

const stripe = getStripe(STRIPE_SECRET_KEY, Stripe);
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const supabase = createAdminClient();

const roundCents = (n: number) => Math.round(n);
const computeStripeFeeCents = (totalCents: number) => Math.round(totalCents * 0.029 + 30);

// Some Supabase/PostgREST errors include a code for unique violations.
// In practice you might see "23505" for Postgres unique violation.
const isUniqueViolation = (err: any) =>
  err?.code === "23505" ||
  String(err?.message ?? "").toLowerCase().includes("duplicate") ||
  String(err?.details ?? "").toLowerCase().includes("already exists");

/* -------------------------------------------------------------------------- */

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req, "POST, OPTIONS");
  const preflight = handleCors(req, "POST, OPTIONS");
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  try {
    const sig = req.headers.get("stripe-signature");
    const isConnectEvent = !!req.headers.get("stripe-account");
    const rawBody = await req.text();

    // -----------------------
    // 1) Verify signature
    // -----------------------
    let event: Stripe.Event;
    const cliMode = Deno.env.get("STRIPE_CLI_MODE") === "true";
    const nodeEnv = Deno.env.get("NODE_ENV") ?? "";
    const allowCliBypass = cliMode && nodeEnv !== "production";

    const baseSecret = isConnectEvent ? STRIPE_CONNECT_WEBHOOK_SECRET : STRIPE_WEBHOOK_SECRET;

    if (allowCliBypass && !STRIPE_CLI_WEBHOOK_SECRET) {
      console.warn("[webhook] ⚠️ CLI mode; skipping verification");
      event = JSON.parse(rawBody);
    } else {
      const secretToUse = allowCliBypass ? STRIPE_CLI_WEBHOOK_SECRET : baseSecret;
      if (!secretToUse) throw new Error("Missing Stripe webhook secret");
      if (!sig) throw new Error("Missing stripe-signature header");

      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        sig,
        secretToUse,
        undefined,
        cryptoProvider,
      );

      console.log(`[webhook] ✅ Signature verified (${isConnectEvent ? "Connect" : "Platform"})`);
    }

    console.log(`[webhook] Event received: ${event.type} (id=${event.id})`);

    // -----------------------
    // 2) Idempotency guard (webhook event id)
    //    Insert into webhook_logs; if already exists => return 200 and do nothing.
    // -----------------------
    try {
      const { error: logErr } = await supabase.from("webhook_logs").insert([
        {
          stripe_id: event.id,
          event_type: event.type,
          payload: event, // stored as JSONB in DB ideally
          created_at: new Date().toISOString(),
        },
      ]);

      if (logErr) {
        if (isUniqueViolation(logErr)) {
          console.log(`[webhook] 🔁 Duplicate event ignored (id=${event.id})`);
          return new Response(JSON.stringify({ received: true, duplicate: true }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...cors },
          });
        }
        console.error("[webhook] ❌ Failed to write webhook_logs", logErr);
        // IMPORTANT: return 400 so Stripe retries (since we didn't record it safely)
        return new Response("Webhook Error: failed to record event", { status: 400, headers: cors });
      }
    } catch (e) {
      console.error("[webhook] ❌ Exception writing webhook_logs", e);
      return new Response("Webhook Error: failed to record event", { status: 400, headers: cors });
    }

    // -----------------------
    // 3) Handle event types
    // -----------------------
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const metadata = s.metadata || {};
        const paymentIntentMetadata =
          typeof s.payment_intent === "object" && s.payment_intent
            ? s.payment_intent.metadata ?? {}
            : {};
        const readMetadataValue = (key: string): string | undefined => {
          const sessionValue = metadata[key];
          if (typeof sessionValue === "string") return sessionValue;
          const piValue = (paymentIntentMetadata as Record<string, string | undefined>)[key];
          return typeof piValue === "string" ? piValue : undefined;
        };
        const class_id = (metadata.class_id as string | undefined) ?? null;
        const user_id = (metadata.user_id as string | undefined) ?? null;
        const qty = Number(metadata.qty || 1);
        const total_cents = s.amount_total ?? 0;

        const paymentIntentId =
          typeof s.payment_intent === "string"
            ? s.payment_intent
            : s.payment_intent?.id ?? null;

        // Parse student names
        let studentNames: string[] = [];
        const rawNames =
          (metadata.student_names as string | undefined) ??
          (typeof s.payment_intent === "object"
            ? ((s.payment_intent?.metadata?.student_names as string | undefined) ?? undefined)
            : undefined);

        if (typeof rawNames === "string" && rawNames.trim().length > 0) {
          try {
            const parsed = JSON.parse(rawNames);
            if (Array.isArray(parsed)) {
              studentNames = parsed
                .map((name) => (typeof name === "string" ? name.trim() : ""))
                .filter((name) => name.length > 0);
            }
          } catch (_err) {
            studentNames = rawNames
              .split(",")
              .map((name) => name.trim())
              .filter((name) => name.length > 0);
          }
        }

        const liabilityAcceptedRaw = readMetadataValue("liability_accepted");
        const liabilityVersion = readMetadataValue("liability_version") ?? null;
        const liabilityAccepted = liabilityAcceptedRaw === "true" || liabilityAcceptedRaw === "1";
        const liabilityValid = liabilityAccepted && liabilityVersion === LIABILITY_VERSION;

        // Booking-level idempotency: if a booking already exists for this session, stop.
        try {
          const { data: existing } = await supabase
            .from("bookings")
            .select("id")
            .eq("stripe_checkout_session_id", s.id)
            .maybeSingle();

          if (existing?.id) {
            console.log(`[webhook] 🔁 Booking already exists for session ${s.id} (booking=${existing.id})`);
            break;
          }
        } catch (e) {
          console.warn("[webhook] ⚠️ Could not check existing booking; proceeding", e);
        }

        const holdNow = new Date().toISOString();
        const { data: hold, error: holdErr } = await supabase
          .from("booking_holds")
          .update({ status: "CONSUMED" })
          .eq("stripe_checkout_session_id", s.id)
          .eq("status", "HELD")
          .gt("expires_at", holdNow)
          .select("id, class_id, guest_id, quantity")
          .maybeSingle();

        if (holdErr) {
          console.error("[webhook] ❌ booking_holds update error", holdErr);
        }

        if (hold && class_id && hold.class_id !== class_id) {
          console.warn(`[webhook] ⚠️ Hold class mismatch (hold=${hold.class_id}, metadata=${class_id})`);
        }

        if (hold && user_id && hold.guest_id !== user_id) {
          console.warn(`[webhook] ⚠️ Hold user mismatch (hold=${hold.guest_id}, metadata=${user_id})`);
        }

        const resolvedClassId = hold?.class_id ?? class_id;
        const resolvedUserId = hold?.guest_id ?? user_id;
        const resolvedQty =
          typeof hold?.quantity === "number" && Number.isFinite(hold.quantity) ? hold.quantity : qty;

        if (!resolvedClassId || !resolvedUserId) {
          console.warn("[webhook] ⚠️ Missing class_id or user_id — cannot create booking");
          break;
        }

        const holdValid = Boolean(hold);
        let refundId: string | null = null;
        let refundStatus: string | null = null;
        let refundError: string | null = null;
        let refundWasExisting = false;

        const attemptRefund = async (idempotencyKey: string) => {
          refundId = null;
          refundStatus = null;
          refundError = null;
          refundWasExisting = false;

          if (paymentIntentId) {
            try {
              const existingRefunds = await stripe.refunds.list({
                payment_intent: paymentIntentId,
                limit: 1,
              });

              if (existingRefunds.data.length > 0) {
                refundId = existingRefunds.data[0].id;
                refundStatus = existingRefunds.data[0].status ?? null;
                refundWasExisting = true;
              } else {
                const refund = await stripe.refunds.create(
                  {
                    payment_intent: paymentIntentId,
                    reason: "requested_by_customer",
                  },
                  { idempotencyKey },
                );
                refundId = refund.id;
                refundStatus = refund.status ?? null;
              }
            } catch (refundErr) {
              refundError = refundErr instanceof Error ? refundErr.message : String(refundErr);
              console.error(`[webhook] ❌ Refund failed for session ${s.id}`, refundErr);
            }
          } else {
            refundError = "Missing payment_intent for refund";
            console.warn(`[webhook] ⚠️ ${refundError} (session=${s.id})`);
          }
        };

        if (!liabilityValid) {
          await attemptRefund(`liability_invalid_${s.id}`);

          if (refundId) {
            const statusLabel = refundStatus ? `status=${refundStatus}` : "status=unknown";
            const prefix = refundWasExisting ? "Existing" : "Created";
            console.log(`[webhook] 💸 ${prefix} refund ${refundId} for session ${s.id} (${statusLabel})`);
          }

          if (refundId || refundError) {
            const { data: logRow, error: logReadErr } = await supabase
              .from("webhook_logs")
              .select("payload")
              .eq("stripe_id", event.id)
              .maybeSingle();

            if (logReadErr) {
              console.warn("[webhook] ⚠️ Failed to read webhook_logs payload", logReadErr);
            }

            const existingPayload =
              logRow && typeof logRow.payload === "object" && logRow.payload !== null ? logRow.payload : {};
            const merged = {
              ...existingPayload,
              herd: {
                liability_valid: false,
                refund: refundId ? { id: refundId, status: refundStatus } : null,
                refund_error: refundError,
              },
            };

            const { error: refundLogErr } = await supabase
              .from("webhook_logs")
              .update({ payload: merged })
              .eq("stripe_id", event.id);

            if (refundLogErr) {
              console.warn("[webhook] ⚠️ Failed to store refund info in webhook_logs", refundLogErr);
            }
          }

          if (hold?.id) {
            await supabase.from("booking_holds").update({ status: "CANCELLED" }).eq("id", hold.id);
          } else {
            await supabase
              .from("booking_holds")
              .update({ status: "CANCELLED" })
              .eq("stripe_checkout_session_id", s.id);
          }

          console.warn(`[webhook] ⚠️ Liability agreement not accepted for session ${s.id}`);
          break;
        }

        if (!holdValid) {
          await attemptRefund(`hold_invalid_${s.id}`);

          if (refundId) {
            const statusLabel = refundStatus ? `status=${refundStatus}` : "status=unknown";
            const prefix = refundWasExisting ? "Existing" : "Created";
            console.log(`[webhook] 💸 ${prefix} refund ${refundId} for session ${s.id} (${statusLabel})`);
          }

          if (refundId || refundError) {
            const { data: logRow, error: logReadErr } = await supabase
              .from("webhook_logs")
              .select("payload")
              .eq("stripe_id", event.id)
              .maybeSingle();

            if (logReadErr) {
              console.warn("[webhook] ⚠️ Failed to read webhook_logs payload", logReadErr);
            }

            const existingPayload =
              logRow && typeof logRow.payload === "object" && logRow.payload !== null ? logRow.payload : {};
            const merged = {
              ...existingPayload,
              herd: {
                hold_valid: false,
                refund: refundId ? { id: refundId, status: refundStatus } : null,
                refund_error: refundError,
              },
            };

            const { error: refundLogErr } = await supabase
              .from("webhook_logs")
              .update({ payload: merged })
              .eq("stripe_id", event.id);

            if (refundLogErr) {
              console.warn("[webhook] ⚠️ Failed to store refund info in webhook_logs", refundLogErr);
            }
          }
        }
        if (!holdValid) {
          console.warn(`[webhook] ⚠️ No valid booking hold for session ${s.id}`);
          const { data: spotsNoHolds, error: spotsErr } = await supabase.rpc("available_spots", {
            class_uuid: resolvedClassId,
          });
          if (spotsErr) {
            console.warn("[webhook] ⚠️ available_spots lookup failed", spotsErr);
          } else if (typeof spotsNoHolds === "number" && spotsNoHolds < resolvedQty) {
            console.warn(
              `[webhook] ⚠️ Insufficient availability for session ${s.id} (needed=${resolvedQty}, available=${spotsNoHolds})`,
            );
          }
        }

        // Fetch class info
        const { data: cls, error: clsErr } = await supabase
          .from("classes")
          .select("id, host_id, auto_approve")
          .eq("id", resolvedClassId)
          .single();

        if (clsErr || !cls) {
          console.error("[webhook] ❌ Class not found for checkout metadata", clsErr);
          break;
        }

        // Split total: user paid includes HERD fee
        const hostPortion = total_cents / (1 + HERD_FEE_RATE);
        const platform_fee_cents = roundCents(hostPortion * HERD_FEE_RATE);
        const host_payout_cents = roundCents(hostPortion);

        const status = holdValid ? (cls.auto_approve ? "APPROVED" : "PENDING") : "DENIED";
        const payment_status = holdValid
          ? cls.auto_approve
            ? "HELD"
            : "PENDING"
          : refundId
            ? "REFUNDED"
            : "FAILED";

        // Insert booking
        const { data: inserted, error: insErr } = await supabase
          .from("bookings")
          .insert([
            {
              class_id: resolvedClassId,
              user_id: resolvedUserId,
              qty: resolvedQty,
              student_names: studentNames,
              total_cents,
              status,
              payment_status,
              stripe_checkout_session_id: s.id,
              stripe_payment_intent_id: paymentIntentId,
              platform_fee_cents,
              host_payout_cents,
              liability_accepted: true,
              liability_accepted_at: new Date().toISOString(),
              liability_version: LIABILITY_VERSION,
              created_at: new Date().toISOString(),
            },
          ])
          .select("id")
          .single();

        if (insErr || !inserted) {
          // If unique index exists, duplicates will land here too — treat as ok.
          if (isUniqueViolation(insErr)) {
            console.log(`[webhook] 🔁 Duplicate booking insert ignored for session ${s.id}`);
            break;
          }
          console.error("[webhook] ❌ Failed to insert booking record", insErr);
          if (holdValid) {
            await supabase.from("booking_holds").update({ status: "CANCELLED" }).eq("id", hold.id);
          }
          break;
        }

        const bookingId = inserted.id;
        console.log(`[webhook] ✅ Created booking ${bookingId} (${status}/${payment_status})`);

        // Store charge + fee details (best-effort)
        try {
          const estimatedStripeFeeCents = computeStripeFeeCents(total_cents);
          let stripeFeeCents = estimatedStripeFeeCents;
          if (paymentIntentId) {
            const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
              expand: ["latest_charge", "charges.data.balance_transaction"],
            });

            if (!pi.transfer_group) {
              console.warn(`[webhook] ⚠️ PaymentIntent ${paymentIntentId} missing transfer_group`);
            }

            const latestCharge = pi.latest_charge;
            const chargeId = typeof latestCharge === "string" ? latestCharge : latestCharge?.id || null;

            if (chargeId && chargeId.startsWith("ch_")) {
              await supabase.from("bookings").update({ stripe_charge_id: chargeId }).eq("id", bookingId);
            }

            const charge = pi.charges?.data?.[0];
            const bt = charge?.balance_transaction as Stripe.BalanceTransaction | undefined;
            const stripeFee = bt?.fee || 0;
            if (stripeFee > 0) stripeFeeCents = stripeFee;
          }
          if (stripeFeeCents > 0) {
            await supabase.from("bookings").update({ stripe_fee_cents: stripeFeeCents }).eq("id", bookingId);
            console.log(`[webhook] 💸 Stored Stripe fee ${stripeFeeCents}¢ for booking ${bookingId}`);
          }
        } catch (piDetailsErr) {
          console.warn("[webhook] ⚠️ Could not store Stripe charge/fee details", piDetailsErr);
        }

        // Queue emails (best-effort)
        try {
          if (cls.auto_approve && holdValid) {
            await supabase.rpc("enqueue_booking_email_job", {
              _booking_id: bookingId,
              _type: "booking_confirmed_host",
              _template: "BOOKING_CONFIRMED_HOST",
            });
            await supabase.rpc("enqueue_booking_email_job", {
              _booking_id: bookingId,
              _type: "booking_confirmed_guest",
              _template: "BOOKING_CONFIRMED_GUEST",
            });
            console.log(`[webhook] 📬 Queued confirmation emails for ${bookingId}`);
          } else {
            console.log(
              `[webhook] 📨 Pending booking ${bookingId} inserted — relying on DB trigger to queue host/guest request emails.`,
            );
          }
        } catch (emailErr) {
          console.error("[webhook] ⚠️ Failed to queue emails", emailErr);
        }

        break;
      }

      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const detailsSubmitted = Boolean(account.details_submitted);
        const chargesEnabled = Boolean(account.charges_enabled);
        const payoutsEnabled = Boolean(account.payouts_enabled);

        // Your original logic: "connected" == details_submitted
        const isFullyConnected = detailsSubmitted;

        const updatePayload = {
          stripe_connected: isFullyConnected,
          updated_at: new Date().toISOString(),
        };

        const { data: updatedByAccount, error: updateError } = await supabase
          .from("profiles")
          .update(updatePayload)
          .eq("stripe_account_id", account.id)
          .select("id");

        if (updateError) {
          console.error("[webhook] profiles update error", updateError);
        }

        if ((!updatedByAccount || updatedByAccount.length === 0) && account.metadata?.supabase_user_id) {
          const { error: metadataUpdateError } = await supabase
            .from("profiles")
            .update({ ...updatePayload, stripe_account_id: account.id })
            .eq("id", account.metadata.supabase_user_id);

          if (metadataUpdateError) {
            console.error("[webhook] metadata fallback update error", metadataUpdateError);
          } else {
            console.log(
              `[webhook] ✅ Updated via metadata user ${account.metadata.supabase_user_id} → connected=${isFullyConnected}`,
            );
          }
        } else if (!updateError) {
          console.log(
            `[webhook] ✅ Account ${account.id} connected=${isFullyConnected} (details_submitted=${detailsSubmitted}, charges_enabled=${chargesEnabled}, payouts_enabled=${payoutsEnabled})`,
          );
        }

        break;
      }

      default:
        console.log(`[webhook] Ignored event: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...cors },
    });
  } catch (err: any) {
    console.error("[webhook] ❌", err);
    return new Response(`Webhook Error: ${err?.message || "Unknown error"}`, {
      status: 400,
      headers: cors,
    });
  }
});
