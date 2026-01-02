import { serve } from "https://deno.land/std/http/server.ts";
import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getStripe } from "../_shared/stripe.ts";
import { createAdminClient } from "../_shared/supabase.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("HERD_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("HERD_SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error("Missing required environment variables for confirm-booking function");
}

const stripe = getStripe(STRIPE_SECRET_KEY, Stripe);
const supabase = createAdminClient();

serve(async (req: Request) => {
  const cors = corsHeaders(req, "POST, OPTIONS");
  const preflight = handleCors(req, "POST, OPTIONS");
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const auth = await requireAuth(req);
    if ("error" in auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json().catch(() => null);
    const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "";

    if (!sessionId) {
      return new Response(JSON.stringify({ error: "Missing sessionId" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "customer"],
    });

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, status, payment_status, created_at, user_id")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();

    if (bookingError) {
      console.warn("[confirm-booking] booking lookup error", bookingError);
    }

    if (booking?.user_id && booking.user_id !== auth.user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (!booking?.user_id) {
      const sessionUserId = (session.metadata?.user_id as string | undefined) ??
        (typeof session.payment_intent === "object" ? (session.payment_intent?.metadata?.user_id as string | undefined) : undefined);
      if (sessionUserId && sessionUserId !== auth.user.id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    const responseBody = {
      ok: true,
      session: {
        id: session.id,
        status: session.status,
        payment_status: session.payment_status,
        customer_email: session.customer_details?.email ?? null,
      },
      booking: booking ?? null,
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[confirm-booking] error", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
