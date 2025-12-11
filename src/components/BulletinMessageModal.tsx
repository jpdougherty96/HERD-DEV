import React, { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Textarea } from "./ui/textarea";
import { MessageSquare, Send, X } from "lucide-react";
import { supabase } from "@/utils/supabaseClient";
import type { Post, User } from "../types/domain";
import { toast } from "sonner";

interface BulletinMessageModalProps {
  post: Post;
  user: User;
  onClose: () => void;
  onMessageSent: () => void;
}

export function BulletinMessageModal({
  post,
  user,
  onClose,
  onMessageSent,
}: BulletinMessageModalProps) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSendMessage = async () => {
    if (!message.trim()) return;

    setSending(true);
    try {
      const {
        data: { user: currentUser },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !currentUser) {
        toast.warning("Please log in to send messages.");
        setSending(false);
        return;
      }

      const authorId = post.authorId;
      if (!authorId) {
        toast.error("Unable to find the author for this post.");
        setSending(false);
        return;
      }

      if (authorId === currentUser.id) {
        toast.info("You cannot send a message to yourself.");
        setSending(false);
        return;
      }

      const nowIso = new Date().toISOString();

      const orFilter = `and(host_id.eq.${authorId},guest_id.eq.${currentUser.id},class_id.is.null),and(host_id.eq.${currentUser.id},guest_id.eq.${authorId},class_id.is.null)`;

      const { data: existingConv, error: findError } = await supabase
        .from("conversations")
        .select("id, class_id")
        .or(orFilter)
        .limit(1)
        .maybeSingle();

      if (findError) throw findError;

      let conversationId = existingConv?.id as string | undefined;

      if (!conversationId) {
        const { data: created, error: createError } = await supabase
          .from("conversations")
          .insert({
            class_id: null,
            host_id: authorId,
            guest_id: currentUser.id,
            last_message_at: nowIso,
            updated_at: nowIso,
          })
          .select("id")
          .single();

        if (createError) throw createError;
        conversationId = created.id;
      } else {
        await supabase
          .from("conversations")
          .update({
            last_message_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", conversationId);
      }

      const content = `[Bulletin] ${post.title}\n\n${message.trim()}`;

      const { error: messageError } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: currentUser.id,
        content,
      });

      if (messageError) throw messageError;

      window.dispatchEvent(new CustomEvent("herd-message-sent"));
      toast.success("Message sent!");
      onMessageSent();
      onClose();
    } catch (error: any) {
      console.error("Error sending bulletin message:", error);
      toast.error("Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg bg-white">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[#3c4f21] flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Message {post.author || "Community Member"}
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
          <p className="text-sm text-[#556B2F]">Re: {post.title}</p>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#3c4f21] mb-2">
              Your message:
            </label>
            <Textarea
              placeholder="Type your message here..."
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              className="w-full resize-none"
              disabled={sending}
            />
          </div>
          <div className="flex justify-end gap-3">
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
        </CardContent>
      </Card>
    </div>
  );
}
