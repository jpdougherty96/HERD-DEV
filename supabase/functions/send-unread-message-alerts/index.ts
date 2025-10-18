import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HERD_BASE_URL = (Deno.env.get("HERD_BASE_URL") || "https://herd.co").replace(/\/$/, "");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (_req: Request) => {
  if (_req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

    const { data: conversations, error: conversationsErr } = await admin
      .from("conversations")
      .select(
        `
          id,
          host_id,
          guest_id,
          last_message_at,
          host_profile:profiles!conversations_host_id_fkey(
            id,
            email,
            full_name,
            last_unread_email_at
          ),
          guest_profile:profiles!conversations_guest_id_fkey(
            id,
            email,
            full_name,
            last_unread_email_at
          )
        `
      )
      .not("last_message_at", "is", null);

    if (conversationsErr) throw conversationsErr;

    if (!conversations?.length) {
      return new Response("No alerts queued", { status: 200, headers: corsHeaders });
    }

    const { data: participants, error: participantsErr } = await admin
      .from("conversation_participants")
      .select("conversation_id,user_id,last_read_at");

    if (participantsErr) throw participantsErr;

    const lastReadMap = new Map<string, string | null>();
    (participants || []).forEach((row: any) => {
      if (!row?.conversation_id || !row?.user_id) return;
      const key = `${row.conversation_id}:${row.user_id}`;
      const lastRead =
        typeof row.last_read_at === "string" && row.last_read_at.length
          ? row.last_read_at
          : null;
      lastReadMap.set(key, lastRead);
    });

    const unreadByUser = new Map<
      string,
      { profile: any; userId: string; unreadCount: number }
    >();

    for (const conv of conversations) {
      const roles = [
        { userId: conv.host_id as string | null, profile: conv.host_profile },
        { userId: conv.guest_id as string | null, profile: conv.guest_profile },
      ];

      for (const role of roles) {
        if (!role.userId || !role.profile?.email) continue;

        const lastReadIso =
          lastReadMap.get(`${conv.id}:${role.userId}`) || "1970-01-01T00:00:00Z";

        const { count, error: countErr } = await admin
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", conv.id)
          .neq("sender_id", role.userId)
          .gt("created_at", lastReadIso);

        if (countErr) {
          console.error("[send-unread-message-alerts] count error", countErr);
          continue;
        }

        if ((count ?? 0) <= 0) continue;

        const existing = unreadByUser.get(role.userId);
        if (existing) {
          existing.unreadCount += count ?? 0;
        } else {
          unreadByUser.set(role.userId, {
            profile: role.profile,
            userId: role.userId,
            unreadCount: count ?? 0,
          });
        }
      }
    }

    const recipients = Array.from(unreadByUser.values()).filter(({ profile }) => {
      if (!profile?.email) return false;
      const lastSent = typeof profile.last_unread_email_at === "string" && profile.last_unread_email_at.length
        ? new Date(profile.last_unread_email_at)
        : null;
      if (!lastSent) return true;
      return lastSent.getTime() < sixHoursAgo.getTime();
    });

    if (!recipients.length) {
      return new Response("No alerts queued", { status: 200, headers: corsHeaders });
    }

    let queued = 0;
    const nowIso = new Date().toISOString();

    for (const recipient of recipients) {
      const { profile } = recipient;
      const vars = {
        NAME: profile.full_name || "there",
        LINK: `${HERD_BASE_URL}/messages`,
      } as Record<string, string>;

      const { error: queueErr } = await admin.rpc("enqueue_email_job", {
        p_type: "unread_message_alert",
        p_to_email: profile.email,
        p_subject: "You have unread messages on HERD",
        p_template: "UNREAD_MESSAGE_ALERT",
        p_vars: vars as any,
      });

      if (queueErr) {
        console.error("[send-unread-message-alerts] enqueue error", queueErr);
        continue;
      }

      const { error: updateErr } = await admin
        .from("profiles")
        .update({ last_unread_email_at: nowIso })
        .eq("id", profile.id);

      if (updateErr) {
        console.error("[send-unread-message-alerts] profile update error", updateErr);
        continue;
      }

      queued++;
    }

    return new Response(`Alerts queued: ${queued}`, { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("[send-unread-message-alerts]", err);
    return new Response("Error", { status: 500, headers: corsHeaders });
  }
});
