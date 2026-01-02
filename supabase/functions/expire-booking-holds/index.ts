import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireInternal } from "../_shared/internal.ts";
import { createAdminClient } from "../_shared/supabase.ts";

const admin = createAdminClient();

serve(async (req: Request) => {
  const cors = corsHeaders(req, "GET, POST, OPTIONS");
  const preflight = handleCors(req, "GET, POST, OPTIONS");
  if (preflight) return preflight;

  const unauthorized = requireInternal(req, cors);
  if (unauthorized) return unauthorized;

  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, service: "expire-booking-holds" }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await admin
      .from("booking_holds")
      .update({ status: "EXPIRED" })
      .eq("status", "HELD")
      .lte("expires_at", nowIso)
      .select("id");

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, expired: data?.length ?? 0 }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[expire-booking-holds] unexpected error", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
