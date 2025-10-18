import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (_req: Request) => {

  try {
    const { class_id, host_id, guest_id } = await _req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // check for existing conversation
    const { data: existing, error: findErr } = await supabase
      .from("conversations")
      .select("id")
      .eq("class_id", class_id)
      .or(`and(host_id.eq.${host_id},guest_id.eq.${guest_id}),and(host_id.eq.${guest_id},guest_id.eq.${host_id})`)
      .limit(1)
      .maybeSingle();

    if (findErr) throw findErr;
    if (existing) return new Response(JSON.stringify(existing), { status: 200 });

    // create new
    const { data: created, error: createErr } = await supabase
      .from("conversations")
      .insert({
        class_id,
        host_id,
        guest_id,
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (createErr) throw createErr;
    return new Response(JSON.stringify(created), { status: 200 });
  } catch (err) {
    console.error("❌ create_or_get_conversation failed:", err);

    const message = err instanceof Error ? err.message : String(err);

    return new Response(JSON.stringify({ error: message }), { status: 400 });
  }
});
