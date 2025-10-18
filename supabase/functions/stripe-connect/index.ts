// Creates (or reuses) an Express account, stores it on profile, returns onboarding link URL
import Stripe from "https://esm.sh/stripe@16.11.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  try {
    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing userId" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Load profile to see if account already exists
    const { data: prof, error: pErr } = await supabase.from("profiles").select("id, stripe_account_id").eq("id", userId).single();
    if (pErr || !prof) throw pErr || new Error("Profile not found");

    let accountId = prof.stripe_account_id as string | null;

    if (!accountId) {
      const acct = await stripe.accounts.create({
        type: "express",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { supabase_user_id: userId },
      });
      accountId = acct.id;

      const { error: uErr } = await supabase
        .from("profiles")
        .update({ stripe_account_id: accountId, updated_at: new Date().toISOString() })
        .eq("id", userId);
      if (uErr) throw uErr;
    } else {
      // Make sure metadata is present for fallback
      await stripe.accounts.update(accountId, {
        metadata: { supabase_user_id: userId },
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
        .eq("id", userId);

      console.log(
        `[stripe-connect] Synced account ${accountId} (details=${detailsSubmitted}, charges=${chargesEnabled}, payouts=${payoutsEnabled})`,
      );
    } catch (syncError) {
      console.warn("[stripe-connect] ⚠️ Unable to sync account status immediately", syncError);
    }

    return new Response(JSON.stringify({ url: link.url, accountId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[stripe-connect] error:", e);
    return new Response(JSON.stringify({ error: "server_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
