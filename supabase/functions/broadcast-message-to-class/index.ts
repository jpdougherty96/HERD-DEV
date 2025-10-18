import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (_req: Request) => {
  try {
    const { class_id, host_id, message_content } = await _req.json();
    if (!class_id || !host_id || !message_content) {
      return new Response(
        JSON.stringify({ error: "Missing required fields." }),
        { status: 400 }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
        { status: 200 }
      );
    }

    // 2️⃣ Iterate through participants and send messages
    const results: any[] = [];

    for (const b of bookings) {
      const guest_id = b.user_id;

      // skip sending to self
      if (guest_id === host_id) continue;

      // check for existing conversation
      const orFilter = `and(host_id.eq.${host_id},guest_id.eq.${guest_id}),and(host_id.eq.${guest_id},guest_id.eq.${host_id})`;
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
            host_id,
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
        sender_id: host_id,
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
    });
  } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), { status: 500 });
    }

});
