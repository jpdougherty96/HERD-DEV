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

    const { class_id, host_id, guest_id } = await _req.json();
    if (!class_id) {
      return new Response(JSON.stringify({ error: "Missing class_id" }), {
        status: 400,
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

    const callerId = auth.user.id;
    const hostIdFromClass = cls.host_id as string | null;
    if (!hostIdFromClass) {
      return new Response(JSON.stringify({ error: "Class host missing" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (host_id && host_id !== hostIdFromClass) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let hostId = hostIdFromClass;
    let guestId: string | null = null;

    if (callerId === hostIdFromClass) {
      if (!guest_id || typeof guest_id !== "string") {
        return new Response(JSON.stringify({ error: "Missing guest_id" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      if (guest_id === callerId) {
        return new Response(JSON.stringify({ error: "Invalid guest_id" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      hostId = callerId;
      guestId = guest_id;
    } else {
      if (guest_id && guest_id !== callerId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      guestId = callerId;
    }

    if (!guestId) {
      return new Response(JSON.stringify({ error: "Missing guest_id" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // check for existing conversation
    const { data: existing, error: findErr } = await supabase
      .from("conversations")
      .select("id")
      .eq("class_id", class_id)
      .or(`and(host_id.eq.${hostId},guest_id.eq.${guestId}),and(host_id.eq.${guestId},guest_id.eq.${hostId})`)
      .limit(1)
      .maybeSingle();

    if (findErr) throw findErr;
    if (existing) {
      return new Response(JSON.stringify(existing), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // create new
    const { data: created, error: createErr } = await supabase
      .from("conversations")
      .insert({
        class_id,
        host_id: hostId,
        guest_id: guestId,
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (createErr) throw createErr;
    return new Response(JSON.stringify(created), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("❌ create_or_get_conversation failed:", err);

    const message = err instanceof Error ? err.message : String(err);

    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
