import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (_req: Request) => {
  if (_req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (_req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  try {
    const { token, rating, comment } = await _req.json();

    if (!token || typeof rating !== "number" || rating < 1 || rating > 5) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: cors });
    }

    // Verify token
    const { data: rt, error: rtErr } = await admin
      .from("review_tokens")
      .select(`
        token, booking_id, user_id, host_id, expires_at, used_at,
        booking:bookings!review_tokens_booking_id_fkey(
          id, reviewed, status,
          class:classes!bookings_class_id_fkey(title),
          guest:profiles!bookings_user_id_fkey(full_name, email)
        ),
        host:profiles!review_tokens_host_id_fkey(email, full_name)
      `)
      .eq("token", token)
      .single();

    if (rtErr || !rt) {
      return new Response(JSON.stringify({ error: "Invalid or unknown token" }), { status: 400, headers: cors });
    }

    const now = new Date();
    if (rt.used_at) {
      return new Response(JSON.stringify({ error: "You have already reviewed this host for this class" }), {
        status: 409,
        headers: cors,
      });
    }
    if (new Date(rt.expires_at).getTime() < now.getTime()) {
      return new Response(JSON.stringify({ error: "Token expired" }), { status: 400, headers: cors });
    }
    if (!rt.booking) {
      return new Response(JSON.stringify({ error: "Booking not found for token" }), { status: 400, headers: cors });
    }
    if (rt.booking.reviewed) {
      return new Response(JSON.stringify({ error: "You have already reviewed this host for this class" }), {
        status: 409,
        headers: cors,
      });
    }

    // Store numeric rating only
    const { error: insErr } = await admin.from("reviews").insert({
      booking_id: rt.booking_id,
      host_id: rt.host_id,
      user_id: rt.user_id,
      rating
    });
    if (insErr) throw insErr;

    // Mark booking reviewed
    await admin.from("bookings").update({ reviewed: true }).eq("id", rt.booking_id);

    // Burn the token
    await admin.from("review_tokens").update({ used_at: now.toISOString() }).eq("token", token);

    // Email the host the comment (if provided) WITHOUT storing it
    if (typeof comment === "string" && comment.trim().length > 0) {
      const vars = {
        HOST_NAME: rt.host?.full_name || "",
        GUEST_NAME: rt.booking?.guest?.full_name || "",
        CLASS_TITLE: rt.booking?.class?.title || "",
        COMMENT: comment.trim()
      };

      // Use your email outbox
      await admin.rpc("enqueue_email_job", {
        p_type: "review_comment_host",
        p_to_email: rt.host?.email ?? null,
        p_subject: "New feedback from your guest",
        p_template: "REVIEW_COMMENT_HOST", // add template to your mailer
        p_vars: vars as any
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
  } catch (e: any) {
    console.error("[submit-review]", e);
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), { status: 500, headers: cors });
  }
});
