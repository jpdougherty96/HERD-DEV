// Creates (or reuses) an Express account, stores it on profile, returns onboarding link URL
import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getStripe } from "../_shared/stripe.ts";
import { createAdminClient } from "../_shared/supabase.ts";

const stripe = getStripe(Deno.env.get("STRIPE_SECRET_KEY")!, Stripe);
const supabase = createAdminClient();

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req, "POST, OPTIONS");
  const preflight = handleCors(req, "POST, OPTIONS");
  if (preflight) return preflight;
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  try {
    const auth = await requireAuth(req);
    if ("error" in auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { userId } = await req.json();
    if (userId && userId !== auth.user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const authedUserId = auth.user.id;
    if (!authedUserId) {
      return new Response(JSON.stringify({ error: "Missing userId" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Load profile to see if account already exists
    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("id, stripe_account_id")
      .eq("id", authedUserId)
      .single();
    if (pErr || !prof) throw pErr || new Error("Profile not found");

    let accountId = prof.stripe_account_id as string | null;

    if (!accountId) {
      const acct = await stripe.accounts.create({
        type: "express",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { supabase_user_id: authedUserId },
      });
      accountId = acct.id;

      const { error: uErr } = await supabase
        .from("profiles")
        .update({ stripe_account_id: accountId, updated_at: new Date().toISOString() })
        .eq("id", authedUserId);
      if (uErr) throw uErr;
    } else {
      // Make sure metadata is present for fallback
      await stripe.accounts.update(accountId, {
        metadata: { supabase_user_id: authedUserId },
      });
    }

    const normalizedSite = (Deno.env.get("SITE_URL") || "http://localhost:5173").replace(/\/$/, "");
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${normalizedSite}/profile`,
      return_url: `${normalizedSite}/onboarding/complete`,
    });

    try {
      const latestAccount = await stripe.accounts.retrieve(accountId);
      const detailsSubmitted = Boolean(latestAccount.details_submitted);
      const chargesEnabled = Boolean(latestAccount.charges_enabled);
      const payoutsEnabled = Boolean(latestAccount.payouts_enabled);

      await supabase
        .from("profiles")
        .update({
          stripe_connected: detailsSubmitted,
          stripe_account_id: accountId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", authedUserId);

      console.log(
        `[stripe-connect] Synced account ${accountId} (details=${detailsSubmitted}, charges=${chargesEnabled}, payouts=${payoutsEnabled})`,
      );
    } catch (syncError) {
      console.warn("[stripe-connect] ⚠️ Unable to sync account status immediately", syncError);
    }

    return new Response(JSON.stringify({ url: link.url, accountId }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[stripe-connect] error:", e);
    return new Response(JSON.stringify({ error: "server_error" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
