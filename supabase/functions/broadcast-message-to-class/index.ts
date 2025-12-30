import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase.ts";

serve(async (_req: Request) => {
  const cors = corsHeaders(_req, "POST, OPTIONS");
  const preflight = handleCors(_req, "POST, OPTIONS");
  if (preflight) return preflight;
  if (_req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  try {

    const auth = await requireAuth(_req);
    if ("error" in auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { class_id, host_id, message_content } = await _req.json();
    if (!class_id || !message_content) {
      return new Response(
        JSON.stringify({ error: "Missing required fields." }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    if (host_id && host_id !== auth.user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabase = createAdminClient();
    const { data: cls, error: clsErr } = await supabase
      .from("classes")
      .select("id, host_id")
      .eq("id", class_id)
      .single();

    if (clsErr || !cls) {
      return new Response(JSON.stringify({ error: "Class not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (cls.host_id !== auth.user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const hostId = auth.user.id;

    // 1️⃣ Get all participants (bookings) for this class
    const { data: bookings, error: bookingsErr } = await supabase
      .from("bookings")
      .select("user_id")
      .eq("class_id", class_id)
      .in("status", ["APPROVED", "PAID"]);

    if (bookingsErr) throw bookingsErr;

    if (!bookings || bookings.length === 0) {
      return new Response(
        JSON.stringify({ message: "No participants found." }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // 2️⃣ Iterate through participants and send messages
    const results: any[] = [];

    for (const b of bookings) {
      const guest_id = b.user_id;

      // skip sending to self
      if (guest_id === hostId) continue;

      // check for existing conversation
      const orFilter = `and(host_id.eq.${hostId},guest_id.eq.${guest_id}),and(host_id.eq.${guest_id},guest_id.eq.${hostId})`;
      const { data: existingConv, error: findErr } = await supabase
        .from("conversations")
        .select("id")
        .eq("class_id", class_id)
        .or(orFilter)
        .limit(1)
        .maybeSingle();

      if (findErr) {
        console.error("Find conv error:", findErr);
        continue;
      }

      let conversation_id = existingConv?.id;

      // create one if missing
      if (!conversation_id) {
        const { data: createdConv, error: createErr } = await supabase
          .from("conversations")
          .insert({
            class_id,
            host_id: hostId,
            guest_id,
            last_message_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (createErr) {
          console.error("Create conv error:", createErr);
          continue;
        }
        conversation_id = createdConv.id;
      }

      // insert message
      const { error: msgErr } = await supabase.from("messages").insert({
        conversation_id,
        sender_id: hostId,
        content: message_content,
      });

      if (msgErr) {
        console.error("Message insert error:", msgErr);
        continue;
      }

      // update last_message_at
      await supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversation_id);

      results.push({ guest_id, conversation_id });
    }

    return new Response(JSON.stringify({ sent: results.length, results }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

});
