// supabase/functions/stripe-webhook/index.ts
import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { createClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const STRIPE_CONNECT_WEBHOOK_SECRET = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET");
const STRIPE_CLI_WEBHOOK_SECRET = Deno.env.get("STRIPE_CLI_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const HERD_FEE_RATE = Number(Deno.env.get("HERD_FEE_RATE") ?? 0.08);

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required environment variables");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, stripe-signature, stripe-account",
};

const roundCents = (n: number) => Math.round(n);

/* -------------------------------------------------------------------------- */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method !== "POST")
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  try {
    const sig = req.headers.get("stripe-signature");
    const isConnectEvent = !!req.headers.get("stripe-account");
    const rawBody = await req.text();

    const secretToUse =
      Deno.env.get("STRIPE_CLI_MODE") === "true"
        ? STRIPE_CLI_WEBHOOK_SECRET
        : isConnectEvent
        ? STRIPE_CONNECT_WEBHOOK_SECRET
        : STRIPE_WEBHOOK_SECRET;

    let event: Stripe.Event;
    if (!secretToUse) {
      console.warn("[webhook] ⚠️ No secret; skipping verification");
      event = JSON.parse(rawBody);
    } else if (Deno.env.get("STRIPE_CLI_MODE") === "true") {
      console.warn("[webhook] ⚠️ CLI mode; skipping verification");
      event = JSON.parse(rawBody);
    } else {
      event = await stripe.webhooks.constructEventAsync(rawBody, sig!, secretToUse, undefined, cryptoProvider);
      console.log(`[webhook] ✅ Signature verified (${isConnectEvent ? "Connect" : "Platform"})`);
    }

    console.log(`[webhook] Event received: ${event.type}`);

    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const metadata = s.metadata || {};
        const class_id = metadata.class_id as string | null;
        const user_id = metadata.user_id as string | null;
        const qty = Number(metadata.qty || 1);
        const total_cents = s.amount_total ?? 0;
        const paymentIntentId =
          typeof s.payment_intent === "string"
            ? s.payment_intent
            : s.payment_intent?.id || null;

        let studentNames: string[] = [];
        const rawNames = metadata.student_names ?? (typeof s.payment_intent === "object"
          ? (s.payment_intent?.metadata?.student_names as string | undefined)
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
              .split(',')
              .map((name) => name.trim())
              .filter((name) => name.length > 0);
          }
        }

        if (!class_id || !user_id) {
          console.warn("[webhook] ⚠️ Missing class_id or user_id in metadata — cannot create booking");
          break;
        }

        // 🧠 Fetch class info (for host + auto_approve flag)
        const { data: cls, error: clsErr } = await supabase
          .from("classes")
          .select("id, host_id, auto_approve")
          .eq("id", class_id)
          .single();

        if (clsErr || !cls) {
          console.error("[webhook] ❌ Class not found for checkout metadata", clsErr);
          break;
        }

        // 💰 Split total (user paid includes HERD fee)
        const hostPortion = total_cents / (1 + HERD_FEE_RATE);
        const platform_fee_cents = roundCents(hostPortion * HERD_FEE_RATE);
        const host_payout_cents = roundCents(hostPortion);

        const status = cls.auto_approve ? "APPROVED" : "PENDING";
        const payment_status = cls.auto_approve ? "HELD" : "PENDING";

        // 🧾 Insert booking
        const { data: inserted, error: insErr } = await supabase
          .from("bookings")
          .insert([
            {
              class_id,
              user_id,
              qty,
              student_names: studentNames,
              total_cents,
              status,
              payment_status,
              stripe_checkout_session_id: s.id,
              stripe_payment_intent_id: paymentIntentId,
              platform_fee_cents,
              host_payout_cents,
              created_at: new Date().toISOString(),
            },
          ])
          .select("id")
          .single();

        if (insErr || !inserted) {
          console.error("[webhook] ❌ Failed to insert booking record", insErr);
          break;
        }

        const bookingId = inserted.id;
        console.log(`[webhook] ✅ Created booking ${bookingId} (${status}/${payment_status})`);

        try {
          if (paymentIntentId) {
            const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
              expand: ["latest_charge", "charges.data.balance_transaction"],
            });

            if (!pi.transfer_group) {
              console.warn(`[webhook] ⚠️ PaymentIntent ${paymentIntentId} missing transfer_group`);
            }

            const latestCharge = pi.latest_charge;
            const chargeId =
              typeof latestCharge === "string" ? latestCharge : latestCharge?.id || null;
            if (chargeId && chargeId.startsWith("ch_")) {
              await supabase
                .from("bookings")
                .update({ stripe_charge_id: chargeId })
                .eq("id", bookingId);
            }

            // 🧾 Retrieve and store Stripe fee
            const charge = pi.charges?.data?.[0];
            const bt = charge?.balance_transaction as Stripe.BalanceTransaction | undefined;
            const stripeFee = bt?.fee || 0;
            if (stripeFee > 0) {
              await supabase
                .from("bookings")
                .update({ stripe_fee_cents: stripeFee })
                .eq("id", bookingId);
              console.log(`[webhook] 💸 Stored Stripe fee ${stripeFee}¢ for booking ${bookingId}`);
            }
          }
        } catch (piDetailsErr) {
          console.warn("[webhook] ⚠️ Could not store Stripe charge/fee details", piDetailsErr);
        }

        // 📬 Queue emails
        try {
          if (cls.auto_approve) {
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
              `[webhook] 📨 Pending booking ${bookingId} inserted — relying on DB trigger to queue host/guest request emails.`
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
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err: any) {
    console.error("[webhook] ❌", err);
    return new Response(`Webhook Error: ${err?.message || "Unknown error"}`, {
      status: 400,
      headers: corsHeaders,
    });
  }
});
