import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/utils/supabaseClient";

export function useExistingConversation(
  classId: string | null | undefined,
  userId: string | null | undefined,
) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!classId || !userId) {
      setConversationId(null);
      return;
    }

    setLoading(true);
    try {
      let foundId: string | null = null;

      const { data: guestConversation, error: guestErr, status } = await supabase
        .from("conversations")
        .select("id")
        .eq("class_id", classId)
        .eq("guest_id", userId)
        .limit(1)
        .maybeSingle();

      if (guestErr && status !== 406) {
        console.warn("useExistingConversation guest lookup error", guestErr);
      }

      if (guestConversation?.id) {
        foundId = guestConversation.id;
      }

      if (!foundId) {
        const { data: hostConversation, error: hostErr, status: hostStatus } = await supabase
          .from("conversations")
          .select("id")
          .eq("class_id", classId)
          .eq("host_id", userId)
          .limit(1)
          .maybeSingle();

        if (hostErr && hostStatus !== 406) {
          console.warn("useExistingConversation host lookup error", hostErr);
        }

        if (hostConversation?.id) {
          foundId = hostConversation.id;
        }
      }

      setConversationId(foundId);
    } catch (err) {
      console.error("useExistingConversation failed", err);
      setConversationId(null);
    } finally {
      setLoading(false);
    }
  }, [classId, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!classId) return;

    const onConversationReady = (event: Event) => {
      const custom = event as CustomEvent<{ conversationId?: string; classId?: string }>;
      if (custom.detail?.classId === classId && custom.detail?.conversationId) {
        setConversationId(custom.detail.conversationId);
      }
    };

    window.addEventListener('herd-conversation-ready', onConversationReady);
    return () => window.removeEventListener('herd-conversation-ready', onConversationReady);
  }, [classId]);

  return { conversationId, loading, refresh };
}
