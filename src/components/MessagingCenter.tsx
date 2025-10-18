import React, { useState, useEffect, useRef } from 'react';
import { Conversation, Message } from './Dashboard';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { supabase } from '../utils/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ArrowLeft, MessageSquare, Search, Send, Settings, Trash2, User } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';

interface MessagingCenterProps {
  conversations: Conversation[];
  currentUserId: string;
  currentUserName: string;
  onSendMessage: (conversationId: string, content: string) => void;
  onConversationsUpdate?: (updater: (prev: Conversation[]) => Conversation[]) => void;
  initialConversationId?: string | null;
}

export function MessagingCenter({
  conversations,
  currentUserId,
  currentUserName,
  onSendMessage,
  onConversationsUpdate,
  initialConversationId = null
}: MessagingCenterProps) {
  const { conversationId } = useParams();
const initialSelection = initialConversationId || conversationId || null;
const appliedInitialConversationId = useRef<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(initialSelection);
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState<{ [conversationId: string]: Message[] }>({});
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread'>('all');
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false,
  );
  const messageListRef = React.useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const selectedConv = conversations.find((c) => c.id === selectedConversation);
  const conversationMessages = selectedConversation ? messages[selectedConversation] || [] : [];

  useEffect(() => {
    if (!isMobile) return;
    if (typeof document === 'undefined') return;
    const originalOverflow = document.body.style.overflow;
    if (selectedConversation) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
    document.body.style.overflow = originalOverflow;
  }, [isMobile, selectedConversation]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const query = window.matchMedia('(max-width: 1023px)');
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(event.matches);
    };

    setIsMobile(query.matches);

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', handleChange);
      return () => query.removeEventListener('change', handleChange);
    }

    query.addListener(handleChange);
    return () => query.removeListener(handleChange);
  }, []);

  const scrollToBottom = React.useCallback(() => {
    const el = messageListRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (!selectedConversation) return;
    if (autoScrollRef.current && conversationMessages.length > 0) {
      scrollToBottom();
    }
  }, [conversationMessages.length, selectedConversation, scrollToBottom]);

  useEffect(() => {
    if (!selectedConversation) return;
    autoScrollRef.current = true;
    const handle = setTimeout(() => {
      if (autoScrollRef.current) scrollToBottom();
    }, 100);
    return () => clearTimeout(handle);
  }, [selectedConversation, scrollToBottom]);

  useEffect(() => {
    if (selectedConversation && !messages[selectedConversation]) {
      loadMessagesForConversation(selectedConversation);
    }
  }, [selectedConversation]);

  useEffect(() => {
    if (conversations.length === 0 && currentUserId) {
      console.log('💬 MessagingCenter mounted with no conversations, requesting refresh...');
      onConversationsUpdate?.(() => []);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (conversations.length === 0) {
      if (!initialConversationId) {
        setSelectedConversation(null);
      }
      return;
    }

    if (initialConversationId && appliedInitialConversationId.current !== initialConversationId) {
      setSelectedConversation(initialConversationId);
      appliedInitialConversationId.current = initialConversationId;
      return;
    }

    if (selectedConversation) return;

    if (!isMobile) {
      setSelectedConversation(conversations[0].id);
    }
  }, [conversations, initialConversationId, isMobile, selectedConversation]);

  useEffect(() => {
    if (!isMobile && !selectedConversation && conversations.length > 0) {
      setSelectedConversation(conversations[0].id);
    }
  }, [isMobile, conversations, selectedConversation]);

  useEffect(() => {
    if (conversationId && conversationId !== selectedConversation) {
      setSelectedConversation(conversationId);
      loadMessagesForConversation(conversationId);
    }
  }, [conversationId]);

useEffect(() => {
  if (!initialConversationId) {
    appliedInitialConversationId.current = null;
    return;
  }
  if (appliedInitialConversationId.current === initialConversationId) return;
  appliedInitialConversationId.current = initialConversationId;
  if (initialConversationId !== selectedConversation) {
    autoScrollRef.current = true;
    setSelectedConversation(initialConversationId);
    loadMessagesForConversation(initialConversationId);
  }
}, [initialConversationId, selectedConversation]);

  useEffect(() => {
    if (!selectedConversation) return;
    const conversation = conversations.find((c) => c.id === selectedConversation);
    if (!conversation) return;
    if (conversation.unreadCount > 0) {
      markConversationAsRead(selectedConversation);
    }
  }, [selectedConversation, conversations]);

  const sortedConversations = [...conversations].sort((a, b) => {
    const aTime = a.lastMessage?.createdAt || a.updatedAt || a.createdAt || '0';
    const bTime = b.lastMessage?.createdAt || b.updatedAt || b.createdAt || '0';
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  const filteredConversations =
    activeFilter === 'unread'
      ? sortedConversations.filter((conv) => conv.unreadCount > 0)
      : sortedConversations;

  // ✅ Load messages securely with token
  const handleMessageListScroll = React.useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distanceFromBottom < 48;
  }, []);

  const loadMessagesForConversation = async (conversationId: string) => {
    if (loadingMessages) return;

    setLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const normalized = (data || []).map((m: any) => ({
        id: m.id,
        conversationId: m.conversation_id,
        senderId: m.sender_id,
        content: m.content,
        createdAt: m.created_at,
      }));

      setMessages(prev => ({
        ...prev,
        [conversationId]: normalized,
      }));

      console.log(`💬 Loaded ${normalized.length} messages for conversation ${conversationId}`);
      if (conversationId === selectedConversation && autoScrollRef.current) {
        requestAnimationFrame(() => scrollToBottom());
      }
    } catch (err) {
      console.error('❌ Failed to load messages:', err);
      setMessages(prev => ({ ...prev, [conversationId]: [] }));
    } finally {
      setLoadingMessages(false);
    }
  };


  // ✅ Mark conversation as read directly in Supabase (no Edge Function)
  const markConversationAsRead = async (conversationId: string) => {
    if (!currentUserId) return;
    const nowIso = new Date().toISOString();
    try {
      const { data, error } = await supabase
        .from('conversation_participants')
        .update({ last_read_at: nowIso })
        .eq('conversation_id', conversationId)
        .eq('user_id', currentUserId)
        .select('id');

      if (error) throw error;

      if (!data || data.length === 0) {
        const { error: insertError } = await supabase
          .from('conversation_participants')
          .insert({
            conversation_id: conversationId,
            user_id: currentUserId,
            last_read_at: nowIso,
          });

        if (insertError) throw insertError;
      }

      console.log('💬 Marked conversation as read:', conversationId);
      onConversationsUpdate?.((prev) =>
        prev.map((conv) =>
          conv.id === conversationId
            ? { ...conv, unreadCount: 0, lastReadAt: nowIso }
            : conv
        )
      );
    } catch (error) {
      console.error('❌ Error marking conversation as read:', error);
    }
  };

  const handleConversationSelect = async (conversationId: string) => {
    autoScrollRef.current = true;
    setSelectedConversation(conversationId);
    if (!messages[conversationId]) loadMessagesForConversation(conversationId);
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedConversation) return;
    const content = messageInput.trim();
    setMessageInput('');
    autoScrollRef.current = true;

    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      conversationId: selectedConversation,
      senderId: currentUserId,
      senderName: currentUserName,
      content,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => ({
      ...prev,
      [selectedConversation]: [...(prev[selectedConversation] || []), optimistic],
    }));

    try {
      await onSendMessage(selectedConversation, content);
      setTimeout(() => loadMessagesForConversation(selectedConversation), 500);
    } catch (error) {
      console.error('❌ Failed to send message:', error);
      setMessages((prev) => ({
        ...prev,
        [selectedConversation]: prev[selectedConversation]?.filter((m) => m.id !== optimistic.id) || [],
      }));
      setMessageInput(content);
    }
  };

  const handleDeleteConversation = async () => {
    if (!selectedConv || deletingConversation) return;

    const otherName = getOtherParticipantName(selectedConv);
    const confirmMessage = otherName
      ? `Remove your conversation with ${otherName}? You can still be messaged again later.`
      : 'Remove this conversation? You can still be messaged again later.';

    if (!window.confirm(confirmMessage)) return;

    setDeletingConversation(true);
    try {
      const { error } = await supabase.rpc('delete_conversation_for_user', {
        _conversation_id: selectedConv.id,
      });

      if (error) throw error;

      const updatedList = conversations.filter((conv) => conv.id !== selectedConv.id);

      onConversationsUpdate?.((prev) =>
        prev.filter((conv) => conv.id !== selectedConv.id)
      );

      setMessages((prev) => {
        const next = { ...prev };
        delete next[selectedConv.id];
        return next;
      });
      setMessageInput('');
      appliedInitialConversationId.current = null;

      if (!isMobile && updatedList.length > 0) {
        setSelectedConversation(updatedList[0].id);
      } else {
        setSelectedConversation(null);
      }

      toast.success('Conversation deleted.');
    } catch (error) {
      console.error('❌ Failed to delete conversation:', error);
      toast.error('Unable to delete this conversation right now.');
    } finally {
      setDeletingConversation(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffHrs = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    if (diffHrs < 1) return `${Math.floor(diffHrs * 60)}m ago`;
    if (diffHrs < 24) return `${Math.floor(diffHrs)}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getOtherParticipantName = (conv: Conversation) => {
    // If current user is the host, show guest's name; otherwise show host's.
    return conv.hostId === currentUserId
      ? conv.guestName || "Guest"
      : conv.hostName || "Host";
  };


  const formatPreviewTimestamp = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();

    if (now.toDateString() === date.toDateString()) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    }

    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  };

  const renderConversationItem = (conversation: Conversation) => {
    const isActive = selectedConversation === conversation.id;
    const otherName = getOtherParticipantName(conversation);
    const previewText =
      conversation.lastMessage?.content || 'Tap to start this conversation';
    const lastActivity =
      conversation.lastMessage?.createdAt ||
      conversation.updatedAt ||
      conversation.createdAt;
    const timestamp = formatPreviewTimestamp(lastActivity);
    const initial = otherName?.trim().charAt(0)?.toUpperCase() || '?';
    const unread = conversation.unreadCount > 0;

    return (
      <button
        key={conversation.id}
        type="button"
        onClick={() => handleConversationSelect(conversation.id)}
        className={`flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#556B2F] ${
          isActive ? 'bg-[#556B2F]/10' : 'hover:bg-[#f0f4ea]'
        }`}
      >
        <div className="flex-shrink-0">
          {conversation.otherAvatarUrl ? (
            <ImageWithFallback
              src={conversation.otherAvatarUrl}
              alt={otherName}
              className="h-10 w-10 rounded-full object-cover border border-[#a8b892]"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#dfe6d5] text-sm font-semibold text-[#2d3d1f]">
              {initial}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="truncate text-sm font-semibold text-[#1f2b15]">{otherName}</p>
            {timestamp && <span className="ml-2 text-xs text-gray-400">{timestamp}</span>}
          </div>
          <p className={`mt-1 truncate text-sm ${isActive ? 'text-[#2d3d1f]/80' : 'text-gray-600'}`}>
            {previewText}
          </p>
          {conversation.className && (
            <p className="mt-1 truncate text-xs text-gray-400">Re: {conversation.className}</p>
          )}
        </div>
        {unread && (
          <span
            className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-[#c54a2c]"
            aria-hidden="true"
          />
        )}
      </button>
    );
  };

  const renderConversationList = () => {
    if (isMobile) {
      return (
        <div className="flex h-full flex-col rounded-3xl bg-white shadow-sm">
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-semibold text-[#1f2b15]">Messages</h2>
                <p className="text-sm text-gray-500">
                  {activeFilter === 'unread' ? 'Unread conversations' : 'All conversations'}
                </p>
              </div>
              <div className="flex items-center gap-2 text-gray-500">
                <button
                  type="button"
                  className="rounded-full p-2 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#556B2F]"
                >
                  <Search className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="rounded-full p-2 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#556B2F]"
                >
                  <Settings className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setActiveFilter('all')}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeFilter === 'all'
                    ? 'bg-black text-white shadow-md'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('unread')}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeFilter === 'unread'
                    ? 'bg-black text-white shadow-md'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Unread
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-gray-100">
            {filteredConversations.length === 0 ? (
              <div className="px-5 py-10 text-center text-gray-500">
                {activeFilter === 'unread'
                  ? 'No unread conversations yet'
                  : 'No conversations yet'}
              </div>
            ) : (
              filteredConversations.map((conversation) => renderConversationItem(conversation))
            )}
          </div>
        </div>
      );
    }

    return (
      <Card className="lg:col-span-1 h-full flex flex-col overflow-hidden">
        <CardHeader className="shrink-0">
          <CardTitle className="text-[#3c4f21] flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> Conversations
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-y-auto overscroll-contain">
          {filteredConversations.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">
              {activeFilter === 'unread'
                ? 'No unread conversations'
                : 'No conversations yet'}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredConversations.map((conversation) => renderConversationItem(conversation))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderMessageThread = () => {
    if (!selectedConv) {
      if (isMobile) {
        return null;
      }

      return (
        <Card className="lg:col-span-1 lg:col-start-2 h-full">
          <CardContent className="flex h-full items-center justify-center">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">Select a conversation to start messaging</p>
            </div>
          </CardContent>
        </Card>
      );
    }

    const otherName = getOtherParticipantName(selectedConv);
    const subtitle = selectedConv.className ? `Re: ${selectedConv.className}` : null;

    const messagePane = (
      <div className="flex flex-1 flex-col min-h-0 bg-white">
        <div
          ref={messageListRef}
          onScroll={handleMessageListScroll}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 px-4 pt-4 pb-6"
        >
          {loadingMessages && conversationMessages.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-[#556B2F]" />
              Loading messages...
            </div>
          ) : conversationMessages.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <MessageSquare className="mx-auto mb-2 h-8 w-8 opacity-50" />
              No messages yet. Start the conversation!
            </div>
          ) : (
            conversationMessages.map((m) => (
              <div
                key={m.id}
                className={`flex ${
                  m.senderId === currentUserId ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                    m.senderId === currentUserId
                      ? 'bg-[#556B2F] text-white'
                      : 'bg-[#f8f9f6] text-[#3c4f21]'
                  }`}
                >
                  <p className="text-sm leading-relaxed">{m.content}</p>
                  <p
                    className={`mt-1 text-xs ${
                      m.senderId === currentUserId ? 'text-white/70' : 'text-gray-500'
                    }`}
                  >
                    {formatTime(m.createdAt)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
        <div
          className="border-t border-gray-200 bg-white px-4 py-4"
          style={{
            paddingBottom: isMobile
              ? 'calc(env(safe-area-inset-bottom, 0px) + 16px)'
              : undefined,
          }}
        >
          <div className="flex gap-2">
            <Input
              placeholder="Write a message..."
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              className="flex-1"
            />
            <Button
              onClick={handleSendMessage}
              disabled={!messageInput.trim()}
              className="bg-[#556B2F] text-white hover:bg-[#3c4f21]"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );

    if (isMobile) {
      return (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div
            className="flex items-center border-b border-gray-200 px-4 py-3"
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
          >
            <button
              type="button"
              onClick={() => setSelectedConversation(null)}
              className="rounded-full p-2 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#556B2F]"
            >
              <ArrowLeft className="h-5 w-5 text-[#2d3d1f]" />
            </button>
            <div className="ml-3 flex-1">
              <p className="truncate text-base font-semibold text-[#1f2b15]">{otherName}</p>
              {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={handleDeleteConversation}
              disabled={deletingConversation}
              className="rounded-full p-2 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
              aria-label="Delete conversation"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        <div className="flex-1 min-h-0 flex flex-col pb-6">{messagePane}</div>
        </div>
      );
    }

    return (
      <Card className="lg:col-span-1 lg:col-start-2 h-full min-h-0 flex flex-col overflow-hidden">
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-[#3c4f21] flex items-center gap-2">
                <User className="h-5 w-5" />
                {otherName}
              </CardTitle>
              {subtitle && <p className="text-sm text-[#556B2F]">{subtitle}</p>}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteConversation}
              disabled={deletingConversation}
              className="border-red-500 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 min-h-0 flex-col p-0">{messagePane}</CardContent>
      </Card>
    );
  };

  if (conversations.length === 0) {
    return (
      <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
        <MessageSquare className="mx-auto mb-4 h-12 w-12 text-gray-300" />
        <p className="text-gray-500">No conversations yet</p>
        <p className="mt-2 text-sm text-gray-400">
          Messages will appear here when you book classes or connect with hosts.
        </p>
      </div>
    );
  }

  const layoutClass = isMobile
    ? 'flex h-[calc(100vh-140px)] min-h-[320px] flex-col gap-4 overflow-hidden'
    : 'grid grid-cols-1 gap-6 min-h-0 lg:grid-cols-[280px_minmax(0,1fr)] lg:h-[calc(100vh-140px)] lg:min-h-[320px] lg:overflow-hidden';

  return (
    <div className={layoutClass}>
      {(!isMobile || !selectedConversation) && renderConversationList()}
      {(!isMobile || selectedConversation) && renderMessageThread()}
    </div>
  );
}
