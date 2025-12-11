import React, { useState, useEffect, useMemo, useCallback } from "react";
import type { Class, Page, Post, User } from "../types/domain";
import { HostDashboard } from "./HostDashboard";
import { UserDashboard } from "./UserDashboard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Calendar, MessageSquare, Star, BookOpen, Megaphone } from "lucide-react";
import { supabase } from "../utils/supabaseClient";
import { Toaster, toast } from "sonner";
import { Switch } from "./ui/switch";

const GUEST_TAB_PATH_MAP = {
  overview: "",
  bookings: "mybookings",
  favorites: "favorites",
  bulletins: "mybulletins",
  messages: "messages",
} as const;

const normalizePathname = (pathname: string) => {
  if (typeof pathname !== "string") return "/";
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.replace(/\/+$/, "") || "/";
};

export type Booking = {
  id: string;
  classId: string;
  userId: string;
  qty?: number;
  totalAmount: number;
  status: string;
  createdAt: string;
  className?: string;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  numberOfDays?: number;
  hoursPerDay?: number;
  classEndTimestamp?: number | null;
  reviewed?: boolean;
  reviewToken?: string | null;
  reviewTokenExpiresAt?: string | null;
  reviewEligible?: boolean;
  reviewReadyAt?: string | null;
  hostId?: string | null;
  hostName?: string | null;
  studentCount?: number;
  isGuestBooking: boolean;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
};

export type Conversation = {
  id: string;
  classId: string;
  hostId: string;
  guestId: string;
  createdAt?: string;
  updatedAt: string;
  lastReadAt?: string;
  lastMessage?: Message;
  hostName?: string;
  guestName?: string;
  className?: string;  // 👈 add this
  otherAvatarUrl?: string | null;
  unreadCount: number;
};

interface DashboardProps {
  user: User;
  classes: Class[];
  posts: Post[];
  onNavigate: (page: Page) => void;
  onDeleteClass: (classId: string) => Promise<void>;
  onManageClass: (classData: Class) => void;
  onSelectClass: (classData: Class) => void;
  initialTab?: string | null;
  initialConversationId?: string | null;
  favorites: string[];
  onToggleFavorite: (classId: string) => void;
  onRelaunchClass: (classData: Class) => Promise<void>;
  onDeletePost: (postId: string) => Promise<void> | void;
  onSelectPost: (post: Post) => void;
  hostMessageTarget?: {
    conversationId?: string | null;
    guestId?: string | null;
    guestName?: string | null;
    classId?: string | null;
    classTitle?: string | null;
    bookingId?: string | null;
  } | null;
  initialMode?: "host" | "guest" | null;
}

const getConversationOtherProfile = (conv: any, currentUserId: string) => {
  const hostProfile = conv.host_profile ?? conv.host ?? null;
  const guestProfile = conv.guest_profile ?? conv.guest ?? null;

  if (conv.host_id && conv.host_id !== currentUserId && hostProfile) return hostProfile;
  if (conv.guest_id && conv.guest_id !== currentUserId && guestProfile) return guestProfile;
  if (conv.host_id === currentUserId) return guestProfile;
  if (conv.guest_id === currentUserId) return hostProfile;
  return hostProfile || guestProfile || null;
};

export function Dashboard({
  user,
  classes,
  posts,
  onNavigate,
  onDeleteClass,
  onManageClass,
  onSelectClass,
  initialTab = null,
  initialConversationId = null,
  favorites,
  onToggleFavorite,
  onRelaunchClass,
  onDeletePost,
  onSelectPost,
  hostMessageTarget = null,
  initialMode = null,
}: DashboardProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [activeTab, setActiveTab] = useState(initialTab ?? "overview");
  const [dashboardMode, setDashboardMode] = useState<"host" | "guest">(
    initialMode ?? (user.stripeConnected ? "host" : "guest")
  );
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [focusedConversationId, setFocusedConversationId] = useState<string | null>(
    hostMessageTarget?.conversationId ?? initialConversationId ?? null
  );
  const [supportsConversationSoftDelete, setSupportsConversationSoftDelete] = useState(true);
  const enableDebugLogs = import.meta.env?.VITE_DEBUG_LOGS === 'true';
  const lastInitialTabRef = React.useRef<string | null>(initialTab);
  const prevStripeConnectedRef = React.useRef(user.stripeConnected);
  const unreadConversationCount = useMemo(
    () => conversations.reduce((total, conv) => total + (conv.unreadCount > 0 ? 1 : 0), 0),
    [conversations]
  );
  const hasUnreadMessages = unreadConversationCount > 0;
  const unreadBadgeLabel = hasUnreadMessages
    ? (unreadConversationCount > 99 ? "99+" : String(unreadConversationCount))
    : null;
  const unreadAriaLabel = hasUnreadMessages
    ? `${unreadConversationCount} unread conversation${unreadConversationCount === 1 ? "" : "s"}`
    : null;
  const hostBookingsNeedingAction = useMemo(
    () =>
      bookings.filter(
        (booking) => booking.hostId === user.id && booking.status === 'PENDING'
      ).length,
    [bookings, user.id]
  );
  const hasBookingsNeedingAction = hostBookingsNeedingAction > 0;
  const bookingsBadgeLabel = hasBookingsNeedingAction
    ? hostBookingsNeedingAction > 99
      ? "99+"
      : String(hostBookingsNeedingAction)
    : null;
  const bookingsBadgeAriaLabel = hasBookingsNeedingAction
    ? `${hostBookingsNeedingAction} booking${hostBookingsNeedingAction === 1 ? "" : "s"} needing attention`
    : null;
  const HOST_TABS = ["overview", "classes", "bookings", "messages"];
  const GUEST_TABS = ["overview", "bookings", "favorites", "bulletins", "messages"];

  useEffect(() => {
    if (!initialTab) return;
    if (lastInitialTabRef.current === initialTab) return;
    setActiveTab(initialTab);
    lastInitialTabRef.current = initialTab;
  }, [initialTab]);

  useEffect(() => {
    if (!initialMode) return;
    setDashboardMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (initialConversationId) {
      setFocusedConversationId(initialConversationId);
    }
  }, [initialConversationId]);

  useEffect(() => {
    if (hostMessageTarget?.conversationId) {
      setFocusedConversationId(hostMessageTarget.conversationId);
    }
  }, [hostMessageTarget?.conversationId]);

  useEffect(() => {
    const previouslyConnected = prevStripeConnectedRef.current;
    if (!user.stripeConnected) {
      setDashboardMode("guest");
    } else if (!previouslyConnected && user.stripeConnected) {
      setDashboardMode("host");
    }
    prevStripeConnectedRef.current = user.stripeConnected;
  }, [user.stripeConnected]);

  useEffect(() => {
    const allowedTabs = dashboardMode === "host" ? HOST_TABS : GUEST_TABS;
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab("overview");
    }
  }, [dashboardMode, activeTab]);

  const handleModeChange = (mode: "host" | "guest") => {
    if (!user.stripeConnected) {
      setDashboardMode("guest");
      return;
    }
    setDashboardMode(mode);
  };

  const handleConversationNavigate = useCallback(
    (conversationId: string) => {
      setFocusedConversationId(conversationId);
      setActiveTab("messages");
    },
    [setFocusedConversationId, setActiveTab],
  );

  const renderModeToggle = () => {
    if (!user.stripeConnected) return null;
    const isHost = dashboardMode === "host";

    return (
      <div className="mb-4 flex justify-end">
        <div
          className={[
            "inline-flex items-center gap-3 rounded-full border px-4 py-2 shadow-sm transition-colors",
            // Tint the whole pill subtly based on mode so it's unmistakable
            isHost
              ? "bg-transparent border-transparent"
              : "bg-transparent border-transparent", // same subtle base for both
          ].join(" ")}
        >
          {/* Guest View */}
          <button
            type="button"
            aria-pressed={!isHost}
            onClick={() => handleModeChange("guest")}
            className={[
              "text-xs font-medium px-3 py-1.5 rounded-full border transition-all duration-150",
              !isHost
                ? "bg-green-100 text-black-900 border-black-200 shadow"
                : "bg-transparent text-gray-500 hover:text-gray-800 border-transparent"
            ].join(" ")}
          >
            Guest View
          </button>

          <Switch
            checked={isHost}
            onCheckedChange={(checked: boolean) => handleModeChange(checked ? "host" : "guest")}
            aria-label="Toggle host dashboard"
            className="data-[state=checked]:bg-green-700 data-[state=unchecked]:bg-gray-300 border border-black/70 shadow-[0_0_0_1px_rgba(0,0,0,0.15)]"
          />

          {/* Host View */}
          <button
            type="button"
            aria-pressed={isHost}
            onClick={() => handleModeChange("host")}
            className={[
              "text-xs font-medium px-3 py-1.5 rounded-full border transition-all duration-150",
              isHost
                ? "bg-green-100 text-black-900 border-black-200 shadow"
                : "bg-transparent text-gray-500 hover:text-gray-800 border-transparent"
            ].join(" ")}
          >
            Host View
          </button>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (user?.id) {
      loadDashboardData();
    }
  }, [user.id]);

  useEffect(() => {
    const handleNewMessage = () => {
      if (user?.id) {
        loadConversationsFromServer();
      }
    };
    window.addEventListener("herd-message-sent", handleNewMessage);
    return () =>
      window.removeEventListener("herd-message-sent", handleNewMessage);
  }, [user?.id]);

  const loadDashboardData = async () => {
    if (!user?.id) return;
    if (enableDebugLogs) {
      console.log("📊 Loading dashboard data for user:", user.id);
    }

    await loadConversationsFromServer();
    await loadBookingsFromServer();

  };

  // ✅ Updated conversation loader — hydrates names AND class title
  const loadConversationsFromServer = async (
    options: { includeDeletedAt?: boolean } = {}
  ) => {
    try {
      if (enableDebugLogs) {
        console.log("💬 Loading conversations for user:", user.id);
      }

      const includeDeletedAt =
        options.includeDeletedAt ?? supportsConversationSoftDelete;

      const selectColumns = `
        id,
        class_id,
        host_id,
        guest_id,
        created_at,
        updated_at,
        last_message_at,
        messages (
          id,
          sender_id,
          content,
          created_at
        ),
        participants:conversation_participants (
          user_id,
          last_read_at${includeDeletedAt ? ', deleted_at' : ''}
        ),
        classes!conversations_class_id_fkey (
          id,
          title
        ),
        host:profiles!conversations_host_id_fkey (
          id,
          full_name,
          avatar_url
        ),
        guest:profiles!conversations_guest_id_fkey (
          id,
          full_name,
          avatar_url
        )
      `;

      const { data, error } = await supabase
        .from("conversations")
        .select(selectColumns)
        .order("last_message_at", { ascending: false });

      if (error) {
        if (
          includeDeletedAt &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: string }).code === "42703"
        ) {
          console.warn(
            "💬 Conversations backend has no deleted_at column yet; retrying without soft-delete support."
          );
          setSupportsConversationSoftDelete(false);
          return await loadConversationsFromServer({ includeDeletedAt: false });
        }
        throw error;
      }

      const filtered = (data || []).filter(
        (conv: any) => conv.host_id === user.id || conv.guest_id === user.id
      );

      const avatarUrlCache = new Map<string, string | null>();
      const resolveAvatarUrl = async (raw?: string | null) => {
        if (!raw) return null;
        if (/^https?:\/\//i.test(raw)) return raw;
        if (avatarUrlCache.has(raw)) return avatarUrlCache.get(raw) ?? null;
        try {
          const { data: signed, error: signedError } = await supabase.storage
            .from("avatars")
            .createSignedUrl(raw, 60 * 60 * 24 * 7);
          if (signedError) {
            console.warn("Failed to create signed avatar URL:", signedError.message ?? signedError);
            avatarUrlCache.set(raw, null);
            return null;
          }
          avatarUrlCache.set(raw, signed?.signedUrl ?? null);
          return signed?.signedUrl ?? null;
        } catch (err) {
          console.warn("Unexpected error signing avatar URL:", err);
          avatarUrlCache.set(raw, null);
          return null;
        }
      };

      const normalized = await Promise.all(
        filtered.map(async (conv: any) => {
        const messagesArray = Array.isArray(conv.messages) ? [...conv.messages] : [];
        const lastMessage =
          messagesArray.length > 0
            ? messagesArray
                .slice()
                .sort(
                  (a: any, b: any) =>
                    new Date(b.created_at).getTime() -
                    new Date(a.created_at).getTime()
                )[0]
            : undefined;
        const participantRecord = Array.isArray(conv.participants)
          ? conv.participants.find((participant: any) => participant.user_id === user.id)
          : undefined;
        if (includeDeletedAt && participantRecord?.deleted_at) {
          return null;
        }
        const lastReadAt = participantRecord?.last_read_at ?? null;

        const bulletinSubject = (() => {
          if (!messagesArray.length) return null;
          const earliestBulletin = messagesArray
            .slice()
            .sort(
              (a: any, b: any) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
            .find((msg: any) => typeof msg?.content === "string" && msg.content.startsWith("[Bulletin] "));
          if (!earliestBulletin) return null;
          const firstLine = earliestBulletin.content.split("\n")[0] ?? "";
          return firstLine.replace(/^\[Bulletin\]\s*/, "").trim();
        })();

        const conversationSubject = conv.classes?.title
          ? conv.classes.title
          : bulletinSubject
            ? `Bulletin: ${bulletinSubject}`
            : null;

        const otherProfile = getConversationOtherProfile(conv, user.id);
        const otherAvatarUrl = await resolveAvatarUrl(otherProfile?.avatar_url ?? null);

        return {
          id: conv.id,
          classId: conv.class_id,
          hostId: conv.host_id,
          guestId: conv.guest_id,
          createdAt: conv.created_at,
          updatedAt: conv.updated_at,
          lastReadAt: lastReadAt ?? undefined,
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                conversationId: conv.id,
                senderId: lastMessage.sender_id,
                content: lastMessage.content,
                createdAt: lastMessage.created_at,
              }
            : undefined,
          hostName: conv.host?.full_name || "Host",
          guestName: conv.guest?.full_name || "Guest",
          otherAvatarUrl,
          className: conversationSubject || "Conversation",
          unreadCount: (() => {
            if (!lastMessage || lastMessage.sender_id === user.id) return 0;
            const lastMessageTime = lastMessage.created_at
              ? new Date(lastMessage.created_at).getTime()
              : conv.last_message_at
                ? new Date(conv.last_message_at).getTime()
                : 0;
            const lastViewedTime = lastReadAt
              ? new Date(lastReadAt).getTime()
              : conv.updated_at
                ? new Date(conv.updated_at).getTime()
                : 0;
            return lastMessageTime > lastViewedTime ? 1 : 0;
          })(),
        };
      })
      );

      const visibleConversations = normalized.filter(
        (conv): conv is Conversation => conv !== null
      );

      if (enableDebugLogs) {
        console.log(`✅ Loaded ${visibleConversations.length} conversations`);
      }
      setConversations(visibleConversations);
    } catch (error) {
      console.error("❌ Failed to load conversations:", error);
      setConversations([]);
    }
  };



  // ✅ Bookings loader (unchanged)
  const loadBookingsFromServer = async () => {
    try {
      setLoadingBookings(true);
      if (enableDebugLogs) {
        console.log(`📋 Loading bookings for user: ${user.id}`);
      }

      // ✅ Add missing booking fields
      const baseSelect = `
        id,
        class_id,
        user_id,
        qty,
        total_cents,
        status,
        payment_status,
        stripe_fee_cents,
        platform_fee_cents,
        host_payout_cents,
        reviewed,
        student_names,
        created_at,
        updated_at,
        approved_at,
        denied_at,
        host_message,
        classes:classes!bookings_class_id_fkey(
          title,
          start_date,
          end_date,
          start_time,
          number_of_days,
          hours_per_day,
          host_id
        )
      `;

      const [guestResult, hostResult] = await Promise.all([
        supabase
          .from("bookings")
          .select(baseSelect)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("bookings")
          .select(baseSelect)
          .eq("classes.host_id", user.id)
          .order("created_at", { ascending: false })
      ]);

      if (guestResult.error) throw guestResult.error;
      if (hostResult.error) throw hostResult.error;

      const guestItems = Array.isArray(guestResult.data) ? guestResult.data : [];
      const hostItems = Array.isArray(hostResult.data) ? hostResult.data : [];

      const bookingIds = guestItems.map((b: any) => b.id).filter(Boolean);
      const tokenMap: Record<string, { token: string; expires_at: string | null }> = {};

      if (bookingIds.length > 0) {
        const { data: tokenRows, error: tokenError } = await supabase
          .from('review_tokens')
          .select('booking_id, token, expires_at, used_at')
          .in('booking_id', bookingIds)
          .eq('user_id', user.id)
          .is('used_at', null);

        if (!tokenError && Array.isArray(tokenRows)) {
          tokenRows.forEach((row: any) => {
            if (row?.booking_id && row?.token) {
              tokenMap[row.booking_id] = {
                token: row.token,
                expires_at: row.expires_at ?? null,
              };
            }
          });
        }
      }

      const nowMs = Date.now();
      const allItems = [...guestItems, ...hostItems];
      const dedupedMap = new Map<string, any>();
      allItems.forEach((item: any) => {
        if (item?.id && !dedupedMap.has(item.id)) {
          dedupedMap.set(item.id, item);
        }
      });

      const hostIds = Array.from(
        new Set(
          allItems
            .map((item: any) => item?.classes?.host_id)
            .filter((value: any): value is string => typeof value === "string" && value.trim().length > 0)
        )
      );
      const hostNameMap: Record<string, string> = {};

      if (hostIds.length > 0) {
        const { data: hostRows, error: hostError } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", hostIds);

        if (hostError) {
          console.error("❌ Error loading host profiles:", hostError);
        } else if (Array.isArray(hostRows)) {
          hostRows.forEach((row: any) => {
            const id = typeof row?.id === "string" ? row.id : null;
            const name = typeof row?.full_name === "string" ? row.full_name.trim() : "";
            if (id && name) {
              hostNameMap[id] = name;
            }
          });
        }
      }

      const enhanced = Array.from(dedupedMap.values()).map((b: any) => {
        const classInfo = b.classes || {};
        const startDate = classInfo?.start_date || null;
        const startTime = classInfo?.start_time || null;
        const endDate = classInfo?.end_date || startDate;
        const numberOfDays = Number(classInfo?.number_of_days ?? 1) || 1;
        const hoursPerDay = Number(classInfo?.hours_per_day ?? 0) || 0;
        const hostId = typeof classInfo?.host_id === "string" ? classInfo.host_id : null;
        const hostName = (() => {
          if (!hostId) return null;
          const mapped = hostNameMap[hostId];
          if (mapped && mapped.trim().length > 0) {
            return mapped.trim();
          }
          if (hostId === user.id && typeof user.name === "string" && user.name.trim().length > 0) {
            return user.name.trim();
          }
          return null;
        })();

        const classEndMs = (() => {
          const dateStr = classInfo?.end_date ?? classInfo?.start_date ?? null;
          if (!dateStr) return null;
          const end = new Date(`${dateStr}T${classInfo?.start_time || "00:00:00"}`);
          if (Number.isNaN(end.getTime())) return null;
          end.setHours(23, 59, 59, 999);
          return end.getTime();
        })();

        let bookingStatus = b.status;

        let reviewReadyAt: string | null = null;
        if (startDate) {
          const baselineTime = startTime || '00:00';
          const start = new Date(`${startDate}T${baselineTime}Z`);
          if (!isNaN(start.getTime())) {
            const spansMultipleDays = Boolean(endDate && endDate !== startDate && numberOfDays > 1);
            if (spansMultipleDays) {
              const end = new Date(`${endDate}T${baselineTime}Z`);
              if (!isNaN(end.getTime())) {
                const ready = new Date(end.getTime() + 24 * 3600 * 1000);
                reviewReadyAt = ready.toISOString();
              }
            } else {
              const durationMs = hoursPerDay * numberOfDays > 0 ? hoursPerDay * numberOfDays * 3600 * 1000 : 0;
              const ready = new Date(start.getTime() + durationMs + 24 * 3600 * 1000);
              reviewReadyAt = ready.toISOString();
            }
          }
        }

        const tokenRecord = tokenMap[b.id];
        const reviewed = Boolean(b.reviewed);
        const statusUpper = (b.status || '').toString().toUpperCase();
        const readyTimestamp = reviewReadyAt ? new Date(reviewReadyAt).getTime() : null;
        const reviewEligible =
          !reviewed &&
          !!tokenRecord?.token &&
          ['APPROVED', 'PAID'].includes(statusUpper) &&
          (!readyTimestamp || nowMs >= readyTimestamp);

        return {
          id: b.id,
          classId: b.class_id,
          userId: b.user_id,
          qty: b.qty,
          totalAmount: b.total_cents,
          status: bookingStatus,
          createdAt: b.created_at,
          className: classInfo?.title,
          startDate,
          endDate,
          startTime,
          numberOfDays,
          hoursPerDay,
          reviewed,
          reviewToken: tokenRecord?.token ?? null,
          reviewTokenExpiresAt: tokenRecord?.expires_at ?? null,
          reviewEligible,
          reviewReadyAt,
          hostId: classInfo?.host_id ?? null,
          hostName,
          studentCount: b.qty ?? null,
          isGuestBooking: b.user_id === user.id,
          classEndTimestamp: classEndMs,
        } as Booking;
      });

      setBookings(enhanced);
    } catch (error) {
      console.error("❌ Error loading bookings:", error);
      setBookings([]);
    } finally {
      setLoadingBookings(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const current = normalizePathname(window.location.pathname);

    if (dashboardMode === "guest") {
      if (!Object.prototype.hasOwnProperty.call(GUEST_TAB_PATH_MAP, activeTab)) return;
      const slug = GUEST_TAB_PATH_MAP[activeTab as keyof typeof GUEST_TAB_PATH_MAP];
      const nextPath = `/dashboard/guestview${slug ? `/${slug}` : ""}`;
      if (current !== nextPath) {
        window.history.replaceState({}, document.title, nextPath);
      }
    } else if (dashboardMode === "host") {
      const nextPath = `/dashboard/hostview${activeTab ? `/${activeTab}` : ""}`;
      if (current !== nextPath) {
        window.history.replaceState({}, document.title, nextPath);
      }
    }
  }, [dashboardMode, activeTab]);

  // ✅ Send messages directly to Supabase
  const handleSendMessage = async (conversationId: string, content: string) => {
    try {
      if (enableDebugLogs) {
        console.log("💬 Sending message to conversation:", conversationId);
      }

      const { error } = await supabase.from("messages").insert([
        {
          conversation_id: conversationId,
          sender_id: user.id,
          content,
        },
      ]);

      if (error) throw error;

      if (enableDebugLogs) {
        console.log("💬 Message sent successfully");
      }
      await loadConversationsFromServer();
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error(
        "Error sending message. Please check your connection and try again."
      );
    }
  };

  // ==============================================
  // HOST VIEW
  // ==============================================
  if (user.stripeConnected && dashboardMode === "host") {
    return (
      <div className="max-w-6xl mx-auto p-3 md:p-6">
        {renderModeToggle()}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl text-[#3c4f21] mb-2">
            Host Dashboard
          </h1>
          <p className="text-sm md:text-base text-[#556B2F]">
            Manage your classes, bookings, and connect with students
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 mb-4 md:mb-6 h-auto p-1">
            <TabsTrigger value="overview">
              <BookOpen size={14} /> Overview
            </TabsTrigger>
            <TabsTrigger value="classes">
              <Calendar size={14} /> My Classes
            </TabsTrigger>
            <TabsTrigger value="bookings">
              <Calendar size={14} /> Bookings
              {hasBookingsNeedingAction && bookingsBadgeLabel && (
                <span
                  className="ml-2 inline-flex min-w-[1.5rem] h-5 items-center justify-center rounded-full bg-[#c54a2c] px-2 text-[10px] font-semibold uppercase tracking-wide text-white"
                  aria-label={bookingsBadgeAriaLabel ?? undefined}
                  title={bookingsBadgeAriaLabel ?? undefined}
                >
                  {bookingsBadgeLabel}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="messages">
              <MessageSquare size={14} /> Messages
              {hasUnreadMessages && unreadBadgeLabel && (
                <span
                  className="ml-2 inline-flex min-w-[1.5rem] h-5 items-center justify-center rounded-full bg-[#c54a2c] px-2 text-[10px] font-semibold uppercase tracking-wide text-white"
                  aria-label={unreadAriaLabel ?? undefined}
                  title={unreadAriaLabel ?? undefined}
                >
                  {unreadBadgeLabel}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <HostDashboard
              user={user}
              classes={classes}
              conversations={conversations}
              onNavigate={onNavigate}
              onDeleteClass={onDeleteClass}
              onManageClass={onManageClass}
              onRelaunchClass={onRelaunchClass}
              activeView="overview"
              onSendMessage={handleSendMessage}
              onConversationsUpdate={setConversations}
              initialConversationId={focusedConversationId}
              initialMessageTarget={hostMessageTarget}
              onConversationNavigate={handleConversationNavigate}
              onBookingsRefresh={loadBookingsFromServer}
            />
          </TabsContent>

          <TabsContent value="classes">
            <HostDashboard
              user={user}
              classes={classes}
              conversations={conversations}
              onNavigate={onNavigate}
              onDeleteClass={onDeleteClass}
              onManageClass={onManageClass}
              onRelaunchClass={onRelaunchClass}
              activeView="classes"
              onSendMessage={handleSendMessage}
              onConversationsUpdate={setConversations}
              initialConversationId={focusedConversationId}
              initialMessageTarget={hostMessageTarget}
              onConversationNavigate={handleConversationNavigate}
              onBookingsRefresh={loadBookingsFromServer}
            />
          </TabsContent>

          <TabsContent value="bookings">
            <HostDashboard
              user={user}
              classes={classes}
              conversations={conversations}
              onNavigate={onNavigate}
              onDeleteClass={onDeleteClass}
              onManageClass={onManageClass}
              onRelaunchClass={onRelaunchClass}
              activeView="bookings"
              onSendMessage={handleSendMessage}
              onConversationsUpdate={setConversations}
              initialConversationId={focusedConversationId}
              initialMessageTarget={hostMessageTarget}
              onConversationNavigate={handleConversationNavigate}
              onBookingsRefresh={loadBookingsFromServer}
            />
          </TabsContent>

          <TabsContent value="messages">
            <HostDashboard
              user={user}
              classes={classes}
              conversations={conversations}
              onNavigate={onNavigate}
              onDeleteClass={onDeleteClass}
              onManageClass={onManageClass}
              onRelaunchClass={onRelaunchClass}
              activeView="messages"
              onSendMessage={handleSendMessage}
              onConversationsUpdate={setConversations}
              initialConversationId={focusedConversationId}
              initialMessageTarget={hostMessageTarget}
              onConversationNavigate={handleConversationNavigate}
              onBookingsRefresh={loadBookingsFromServer}
            />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // ==============================================
  // USER VIEW
  // ==============================================
  return (
    <div className="max-w-6xl mx-auto p-3 md:p-6">
      {renderModeToggle()}
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl text-[#3c4f21] mb-2">
          My Dashboard
        </h1>
        <p className="text-sm md:text-base text-[#556B2F]">
          Track your bookings, favorites, and messages
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 mb-4 md:mb-6 h-auto p-1">
          <TabsTrigger value="overview">
            <BookOpen size={14} /> Overview
          </TabsTrigger>
          <TabsTrigger value="bookings">
            <Calendar size={14} /> My Bookings
          </TabsTrigger>
          <TabsTrigger value="favorites">
            <Star size={14} /> Favorites
          </TabsTrigger>
          <TabsTrigger value="bulletins">
            <Megaphone size={14} /> My Bulletins
          </TabsTrigger>
          <TabsTrigger value="messages">
            <MessageSquare size={14} /> Messages
            {hasUnreadMessages && unreadBadgeLabel && (
              <span
                className="ml-2 inline-flex min-w-[1.5rem] h-5 items-center justify-center rounded-full bg-[#c54a2c] px-2 text-[10px] font-semibold uppercase tracking-wide text-white"
                aria-label={unreadAriaLabel ?? undefined}
                title={unreadAriaLabel ?? undefined}
              >
                {unreadBadgeLabel}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {console.log("📘 Dashboard rendering GUEST bookings tab")}
          <UserDashboard
            user={user}
            classes={classes}
            bookings={bookings}
            conversations={conversations}
            favorites={favorites}
            posts={posts}
            onNavigate={onNavigate}
            onRefreshBookings={loadBookingsFromServer}
            loadingBookings={loadingBookings}
            onConversationsUpdate={setConversations}
            onToggleFavorite={onToggleFavorite}
            onSelectClass={onSelectClass}
            onDeletePost={onDeletePost}
            onSelectPost={onSelectPost}
          />
        </TabsContent>

        <TabsContent value="bookings">
          <UserDashboard
            user={user}
            classes={classes}
            bookings={bookings}
            conversations={conversations}
            favorites={favorites}
            posts={posts}
            onNavigate={onNavigate}
            onRefreshBookings={loadBookingsFromServer}
            loadingBookings={loadingBookings}
            onConversationsUpdate={setConversations}
            activeView="bookings"
            onToggleFavorite={onToggleFavorite}
            onSelectClass={onSelectClass}
            onDeletePost={onDeletePost}
            onSelectPost={onSelectPost}
          />
        </TabsContent>

        <TabsContent value="favorites">
          <UserDashboard
            user={user}
            classes={classes}
            bookings={bookings}
            conversations={conversations}
            favorites={favorites}
            posts={posts}
            onNavigate={onNavigate}
            onRefreshBookings={loadBookingsFromServer}
            loadingBookings={loadingBookings}
            onConversationsUpdate={setConversations}
            activeView="favorites"
            onToggleFavorite={onToggleFavorite}
            onSelectClass={onSelectClass}
            onDeletePost={onDeletePost}
            onSelectPost={onSelectPost}
          />
        </TabsContent>

        <TabsContent value="bulletins">
          <UserDashboard
            user={user}
            classes={classes}
            bookings={bookings}
            conversations={conversations}
            favorites={favorites}
            posts={posts}
            onNavigate={onNavigate}
            onRefreshBookings={loadBookingsFromServer}
            loadingBookings={loadingBookings}
            onConversationsUpdate={setConversations}
            activeView="bulletins"
            onToggleFavorite={onToggleFavorite}
            onSelectClass={onSelectClass}
            onDeletePost={onDeletePost}
            onSelectPost={onSelectPost}
          />
        </TabsContent>

        <TabsContent value="messages">
          <UserDashboard
            user={user}
            classes={classes}
            bookings={bookings}
            conversations={conversations}
            favorites={favorites}
            posts={posts}
            onNavigate={onNavigate}
            onRefreshBookings={loadBookingsFromServer}
            loadingBookings={loadingBookings}
            onSendMessage={handleSendMessage}
            onConversationsUpdate={setConversations}
            activeView="messages"
            onToggleFavorite={onToggleFavorite}
            onSelectClass={onSelectClass}
            onDeletePost={onDeletePost}
            onSelectPost={onSelectPost}
          />
        </TabsContent>

      </Tabs>
    </div>
  );
}
