import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../utils/supabaseClient";
import { toast } from "sonner";


interface MessageHostButtonProps {
  classId: string;
  hostId: string;
  currentUserId: string;
  // optional: disable if user is not signed in
  disabled?: boolean;
}

const MessageHostButton: React.FC<MessageHostButtonProps> = ({
  classId,
  hostId,
  currentUserId,
  disabled = false,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!currentUserId) {
      toast.warning("Please sign in to message the host.");
      return;
    }
    setLoading(true);
    try {
      // Find existing conversation for this class between these two users (either direction)
      const orFilter = `and(host_id.eq.${hostId},guest_id.eq.${currentUserId}),and(host_id.eq.${currentUserId},guest_id.eq.${hostId})`;

      const { data: existing, error: findErr } = await supabase
        .from("conversations")
        .select("id")
        .eq("class_id", classId)
        .or(orFilter)
        .limit(1)
        .maybeSingle();

      if (findErr) throw findErr;

      let conversationId = existing?.id as string | undefined;

      if (!conversationId) {
        // Decide roles: by design this button is for guests, but support either side
        const isCurrentUserHost = currentUserId === hostId;
        const finalHostId = hostId;
        const finalGuestId = isCurrentUserHost ? hostId /* fallback */ : currentUserId;

        const { data: created, error: insertErr } = await supabase
          .from("conversations")
          .insert({
            class_id: classId,
            host_id: finalHostId,
            guest_id: finalGuestId,
            last_message_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (insertErr) throw insertErr;
        conversationId = created.id;
      }

      navigate(`/dashboard/messages/${conversationId}`);
    } catch (err) {
      console.error("Error starting or opening conversation:", err);
      toast.error("Sorry, we couldn’t open your conversation. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading || disabled}
      className="px-4 py-2 bg-green-700 text-white rounded-xl hover:bg-green-800 transition disabled:opacity-50"
    >
      {loading ? "Opening..." : "Message Host"}
    </button>
  );
};

export default MessageHostButton;
