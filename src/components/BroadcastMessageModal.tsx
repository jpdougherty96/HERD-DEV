import React, { useState } from "react";
import { supabase } from "../utils/supabaseClient";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { X, Send } from "lucide-react";
import { toast } from "sonner";


interface BroadcastMessageModalProps {
  classId: string;
  hostId: string;
  classTitle?: string;
  onClose: () => void;
}

export function BroadcastMessageModal({
  classId,
  hostId,
  classTitle,
  onClose,
}: BroadcastMessageModalProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleBroadcast = async () => {
    if (!message.trim()) return;
    setSending(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "broadcast-message-to-class",
        {
          body: {
            class_id: classId,
            host_id: hostId,
            message_content: message.trim(),
          },
        }
      );

      if (error) throw error;
      toast.success(`Sent to ${data?.sent ?? 0} participants.`);
      onClose();
    } catch (err: any) {
      console.error("❌ Broadcast failed:", err);
      toast.error("Failed to send message to participants.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg bg-white shadow-lg">
        <CardHeader className="border-b flex justify-between items-center">
          <CardTitle className="text-[#3c4f21]">
            Message All Participants
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <p className="text-sm text-[#556B2F] mb-2">
            This message will be sent individually to every participant of{" "}
            <strong>{classTitle || "this class"}</strong>.
          </p>
          <Textarea
            placeholder="Type your message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            disabled={sending}
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button
              onClick={handleBroadcast}
              disabled={!message.trim() || sending}
              className="bg-[#556B2F] hover:bg-[#3c4f21] text-white"
            >
              {sending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" /> Send
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
