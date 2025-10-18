import React, { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Textarea } from "./ui/textarea";
import { X, MessageSquare, Send } from "lucide-react";
import { supabase } from "../utils/supabase/client";
import type { Class, User } from "../App";
import { toast } from "sonner";


interface MessageModalProps {
  classData: Class;
  user: User;
  onClose: () => void;
  onMessageSent: () => void;
}

export function MessageModal({
  classData,
  user,
  onClose,
  onMessageSent,
}: MessageModalProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSendMessage = async () => {
    if (!message.trim()) return;
    setSending(true);

    try {
      // 1️⃣ Auth check
      const {
        data: { user: currentUser },
        error: authErr,
      } = await supabase.auth.getUser();
      if (authErr || !currentUser) {
        toast.warning("Please log in to send messages.");
        return;
      }

      const classId = classData.id;
      let hostId = classData.hostId || classData.host_id;
      const guestId = currentUser.id;

      // 2️⃣ Fetch host_id if missing
      if (!hostId) {
        console.log("🔍 host_id missing, fetching from classes table...");
        const { data: classRecord, error: classErr } = await supabase
          .from("classes")
          .select("host_id")
          .eq("id", classId)
          .single();

        if (classErr || !classRecord?.host_id) {
          console.error("❌ Could not fetch host_id:", classErr);
          toast.error("Could not determine the host for this class.");
          setSending(false);
          return;
        }

        hostId = classRecord.host_id;
        console.log("✅ host_id fetched:", hostId);
      }

      // Abort if still invalid
      if (!hostId || !guestId) {
        console.error("❌ hostId or guestId still undefined", {
          hostId,
          guestId,
        });
        toast.error("Internal error: missing user or host ID.");
        setSending(false);
        return;
      }

      // 3️⃣ Find existing conversation between these two
      const orFilter = `and(host_id.eq.${hostId},guest_id.eq.${guestId}),and(host_id.eq.${guestId},guest_id.eq.${hostId})`;

      console.log("🧭 Querying conversations with filter:", orFilter);

      const { data: existingConv, error: findErr } = await supabase
        .from("conversations")
        .select("id")
        .eq("class_id", classId)
        .or(orFilter)
        .limit(1)
        .maybeSingle();

      if (findErr) throw findErr;

      let conversationId = existingConv?.id as string | undefined;

      // 4️⃣ Create new conversation if missing
      if (!conversationId) {
        console.log("🆕 Creating new conversation...");
        const { data: created, error: createErr } = await supabase
          .from("conversations")
          .insert({
            class_id: classId,
            host_id: hostId,
            guest_id: guestId,
            last_message_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (createErr) throw createErr;
        conversationId = created.id;
        console.log("✅ Conversation created:", conversationId);
      }

      if (conversationId) {
        window.dispatchEvent(
          new CustomEvent("herd-conversation-ready", {
            detail: { conversationId, classId },
          }),
        );
      }

      // 5️⃣ Send message
      const { error: msgErr } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: currentUser.id,
        content: message.trim(),
      });

      if (msgErr) throw msgErr;
      console.log("📨 Message sent successfully");

      // 6️⃣ Notify UI
      window.dispatchEvent(new CustomEvent("herd-message-sent"));
      onMessageSent();
      onClose();
    } catch (err) {
      console.error("❌ Error sending message:", err);
      toast.error("Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg bg-white">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[#3c4f21] flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Message {classData.hostName || classData.instructorName || "Host"}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-sm text-[#556B2F]">Re: {classData.title}</p>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#3c4f21] mb-2">
                Your message:
              </label>
              <Textarea
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className="w-full resize-none"
                disabled={sending}
              />
            </div>

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={onClose} disabled={sending}>
                Cancel
              </Button>
              <Button
                onClick={handleSendMessage}
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
                    <Send className="h-4 w-4 mr-2" />
                    Send Message
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
