import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { User, Class, Page } from '../App';
import { Conversation } from './Dashboard';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { MessagingCenter } from './MessagingCenter';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Calendar, Users, DollarSign, MessageSquare, Plus, Eye, Check, X, Image as ImageIcon, Trash2, RotateCcw } from 'lucide-react';
import { supabase } from '../utils/supabase/client';
import { formatPrice } from '../utils/money';
import { projectId } from '../utils/supabase/info';
import { formatDateRangeShort } from '../utils/time';
import { toast } from 'sonner@2.0.3';

// New booking type for our system
interface HerdBooking {
  id: string;
  classId: string;
  userId: string;
  userEmail: string;
  userName: string;
  hostId: string;
  hostEmail: string;
  hostName: string;
  studentCount: number;
  studentNames: string[];
  totalAmount: number;
  subtotal: number; // host payout (cents)
  herdFee: number;  // platform fee (cents)
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'FAILED' | 'PAID' | 'CANCELLED' | 'REFUNDED';
  paymentStatus: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'HELD' | 'PAID';
  createdAt: string;
  autoApprove: boolean;
  approved_at?: string;
  denied_at?: string;
  host_message?: string;
  stripePaymentIntentId?: string;
}

interface HostDashboardProps {
  user: User;
  classes: Class[];
  conversations: Conversation[];
  onNavigate: (page: Page) => void;
  onDeleteClass: (classId: string) => Promise<void>;
  onManageClass: (classData: Class) => void;
  onRelaunchClass: (classData: Class) => Promise<void>;
  activeView?: 'overview' | 'classes' | 'bookings' | 'messages';
  onSendMessage?: (conversationId: string, content: string) => void;
  onConversationsUpdate?: (updater: (prev: Conversation[]) => Conversation[]) => void;
  initialConversationId?: string | null;
  initialMessageTarget?: {
    guestId?: string | null;
    guestName?: string | null;
    classId?: string | null;
    classTitle?: string | null;
    bookingId?: string | null;
  } | null;
  onConversationNavigate?: (conversationId: string) => void;
  onBookingsRefresh?: () => Promise<void>;
}

export function HostDashboard({ 
  user, 
  classes, 
  conversations, 
  onNavigate, 
  onDeleteClass,
  onManageClass,
  onRelaunchClass,
  activeView = 'overview',
  onSendMessage,
  onConversationsUpdate,
  initialConversationId = null,
  initialMessageTarget = null,
  onConversationNavigate,
  onBookingsRefresh,
}: HostDashboardProps) {
  const [bookings, setBookings] = useState<HerdBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBooking, setSelectedBooking] = useState<HerdBooking | null>(null);
  const [denialMessage, setDenialMessage] = useState('');
  const [actionInFlight, setActionInFlight] = useState(false);
  const enableDebugLogs = import.meta.env?.VITE_DEBUG_LOGS === 'true';
  const [forcedConversationId, setForcedConversationId] = useState<string | null>(initialConversationId ?? null);
  const processedMessageTargetKey = useRef<string | null>(null);
  
  const PENDINGBookings = bookings.filter(b => b.status === 'PENDING');
  const paid = bookings.filter(b => b.paymentStatus === 'PAID');
  const APPROVEDBookings = bookings.filter(b => b.status === 'APPROVED' || b.status === 'PAID');
  
  // Calculate total revenue for the current year from CONFIRMED bookings
  const currentYear = new Date().getFullYear();

  
  // Debug logging for revenue calculation
  if (enableDebugLogs) {
    console.log('📊 Revenue Debug Info:', {
      totalBookings: bookings.length,
      APPROVEDBookings: APPROVEDBookings,
      allBookings: bookings.map(b => ({
        id: b.id,
        status: b.status,
        subtotalCents: b.subtotal,
        subtotalDollars: Number((b.subtotal / 100).toFixed(2)),
        totalAmountCents: b.totalAmount,
        totalAmountDollars: Number((b.totalAmount / 100).toFixed(2)),
        createdAt: b.createdAt,
        approved_at: b.approved_at,
        year: b.approved_at ? new Date(b.approved_at).getFullYear() : new Date(b.createdAt).getFullYear()
      }))
    });
  }
  
  const eligiblePaymentStatuses = new Set(['HELD', 'PAID', 'COMPLETED']);
  const currentYearBookings = APPROVEDBookings.filter(booking => {
    if (!eligiblePaymentStatuses.has(booking.paymentStatus)) return false;
    if (!booking.subtotal || booking.subtotal <= 0) return false;
    // Filter bookings to current year based on when they were CONFIRMED (APPROVED)
    const bookingDate = booking.approved_at ? new Date(booking.approved_at) : new Date(booking.createdAt);
    const bookingYear = bookingDate.getFullYear();
    if (enableDebugLogs) {
      console.log(
        `📊 Booking ${booking.id}: year=${bookingYear}, subtotal=${
          booking.subtotal / 100
        }, status=${booking.status}, paymentStatus=${booking.paymentStatus}`
      );
    }
    return bookingYear === currentYear;
  });
  
  const totalRevenueCents = currentYearBookings.reduce(
    (sum, booking) => sum + (booking.subtotal || 0),
    0
  );
  const totalRevenueDisplay = formatPrice(totalRevenueCents, { withCurrency: true });

  const recentIncomingMessages = useMemo(() => {
    const getTime = (value?: string) => (value ? new Date(value).getTime() : 0);

    return conversations
      .filter((conversation) => {
        const last = conversation.lastMessage;
        if (!last) return false;
        return last.senderId !== user.id;
      })
      .sort((a, b) => {
        const aTime = getTime(a.lastMessage?.createdAt) || getTime(a.updatedAt) || getTime(a.createdAt);
        const bTime = getTime(b.lastMessage?.createdAt) || getTime(b.updatedAt) || getTime(b.createdAt);
        return bTime - aTime;
      })
      .slice(0, 3);
  }, [conversations, user.id]);
  
  if (enableDebugLogs) {
    console.log('📊 Revenue Calculation Result:', {
      currentYearBookings: currentYearBookings.length,
      totalRevenueCents,
      totalRevenueDollars: Number((totalRevenueCents / 100).toFixed(2)),
      bookingDetails: currentYearBookings.map(b => ({
        id: b.id,
        subtotalCents: b.subtotal,
        subtotalDollars: Number((b.subtotal / 100).toFixed(2)),
        totalAmountCents: b.totalAmount,
        totalAmountDollars: Number((b.totalAmount / 100).toFixed(2))
      }))
    });
  }
  
  const unreadMessages = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const orderedBookings = useMemo(() => {
    const toTimestamp = (value?: string | null) => {
      if (!value) return 0;
      const time = new Date(value).getTime();
      return Number.isFinite(time) ? time : 0;
    };

    const pending = bookings
      .filter((booking) => booking.status === 'PENDING')
      .sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));

    const confirmed = bookings
      .filter((booking) => booking.status === 'APPROVED' || booking.status === 'PAID')
      .sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));

    const denied = bookings
      .filter((booking) => booking.status === 'DENIED')
      .sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));

    const remaining = bookings
      .filter(
        (booking) =>
          booking.status !== 'PENDING' &&
          booking.status !== 'APPROVED' &&
          booking.status !== 'PAID' &&
          booking.status !== 'DENIED'
      )
      .sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));

    return [...pending, ...confirmed, ...denied, ...remaining];
  }, [bookings]);

  // Load bookings
  useEffect(() => {
    fetchBookings();
  }, [user.id]);

  // ✅ Fetch bookings via Edge Function to access full booking metadata (incl. student names)
  const fetchBookings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          *,
          classes!inner(host_id, title),
          profiles!inner(full_name, email)
        `)
        .eq('classes.host_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      const items = Array.isArray(data) ? data : [];

      const mapped = items.map((b: any) => {
        const toCents = (value: any) =>
          Math.max(0, Math.round(Number(value ?? 0)));
        const statusRaw = (b.status || 'PENDING').toString().toUpperCase();
        const normalizedStatus =
          statusRaw === 'CONFIRMED' ? 'APPROVED' : statusRaw;
        const paymentStatusRaw = (b.payment_status ?? b.paymentStatus ?? 'PENDING')
          .toString()
          .toUpperCase();

        const rawNames = Array.isArray(b.studentNames)
          ? b.studentNames
          : Array.isArray(b.student_names)
            ? b.student_names
            : Array.isArray(b.metadata?.student_names)
              ? b.metadata.student_names
              : [];

        const studentNamesArray = rawNames
          .map((name: any) => (typeof name === 'string' ? name.trim() : ''))
          .filter(Boolean);

        const studentCountRaw = Number(b.studentCount ?? b.qty ?? 0);
        const studentCount = Number.isFinite(studentCountRaw) && studentCountRaw > 0
          ? studentCountRaw
          : studentNamesArray.length || 1;

        return {
          id: b.id,
          classId: b.class_id,
          userId: b.user_id,
          userEmail: b.profiles?.email || '',
          userName: b.profiles?.full_name || '',
          hostId: b.classes?.host_id || user.id,
          hostEmail: '',
          hostName: user.name,
          studentCount,
          studentNames: studentNamesArray,
          totalAmount: toCents(b.total_cents),
          subtotal: toCents(b.host_payout_cents),
          herdFee: toCents(b.platform_fee_cents),
          status: normalizedStatus,
          paymentStatus: paymentStatusRaw,
          createdAt: b.created_at || '',
          approved_at: b.approved_at || null,
          denied_at: b.denied_at || null,
          host_message: b.host_message || null,
          autoApprove: false,
        } as HerdBooking;
      });

      setBookings(mapped);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        (error as { name: string }).name === 'AbortError'
      ) {
        console.warn('Bookings request timed out');
      } else {
        console.error('Error fetching bookings:', error);
      }
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setForcedConversationId(initialConversationId ?? null);
  }, [initialConversationId]);

  useEffect(() => {
    if (activeView !== 'messages') return;
    if (!initialMessageTarget?.guestId || !initialMessageTarget.classId) return;
    const key = `${initialMessageTarget.guestId}::${initialMessageTarget.classId}`;
    if (processedMessageTargetKey.current === key) return;

    const ensureConversation = async () => {
      try {
        const { guestId, classId, guestName, classTitle } = initialMessageTarget;
        if (!guestId || !classId) return;

        const { data: existing, error: findErr } = await supabase
          .from('conversations')
          .select('id, host_id, guest_id, class_id')
          .eq('class_id', classId)
          .eq('host_id', user.id)
          .eq('guest_id', guestId)
          .maybeSingle();

        if (findErr) throw findErr;

        let conversationId = existing?.id as string | undefined;

        if (!conversationId) {
          const { data: created, error: createErr } = await supabase
            .from('conversations')
            .insert({
              class_id: classId,
              host_id: user.id,
              guest_id: guestId,
              last_message_at: new Date().toISOString(),
            })
            .select('id')
            .single();

          if (createErr) throw createErr;
          conversationId = created.id;

          onConversationsUpdate?.((prev) => {
            if (prev.some((conv) => conv.id === conversationId)) return prev;
            const classData = classes.find((c) => c.id === classId);
            const newConv: Conversation = {
              id: conversationId,
              classId,
              hostId: user.id,
              guestId,
              updatedAt: new Date().toISOString(),
              lastMessage: undefined,
              hostName: user.name,
              guestName: guestName || 'Guest',
              className: classData?.title || classTitle || 'Class',
              unreadCount: 0,
            };
            return [newConv, ...prev];
          });
        } else {
          const existsInList = conversations.some((conv) => conv.id === conversationId);
          if (!existsInList) {
            onConversationsUpdate?.((prev) => {
              if (prev.some((conv) => conv.id === conversationId)) return prev;
              const classData = classes.find((c) => c.id === classId);
              const newConv: Conversation = {
                id: conversationId,
                classId,
                hostId: user.id,
                guestId,
                updatedAt: new Date().toISOString(),
                lastMessage: undefined,
                hostName: user.name,
                guestName: guestName || 'Guest',
                className: classData?.title || classTitle || 'Class',
                unreadCount: 0,
              };
              return [newConv, ...prev];
            });
          }
        }

        if (conversationId) {
          setForcedConversationId(conversationId);
        }
      } catch (err) {
        console.error('Failed to prepare conversation for messaging target:', err);
      } finally {
        processedMessageTargetKey.current = key;
      }
    };

    ensureConversation();
  }, [activeView, classes, conversations, initialMessageTarget, onConversationsUpdate, supabase, user.id, user.name]);

  const handleBookingResponse = async (bookingId: string, action: 'approve' | 'deny', message?: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Please sign in again to manage bookings.');
        return;
      }

      setActionInFlight(true);
      if (enableDebugLogs) {
        console.log(`🚀 ${action.toUpperCase()} booking triggered for`, bookingId);
      }

      // ✅ Always hit the correct Edge Function domain
      const functionName = action === 'approve' ? 'approve-booking' : 'deny-booking';
      const endpoint = `https://czdzjdujojcjluqcdchq.functions.supabase.co/${functionName}`;

      const payload =
        action === 'approve'
          ? { booking_id: bookingId }
          : { booking_id: bookingId, message: message ?? '' };

      // Call the live function directly with fetch (bypass supabase.functions.invoke)
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      if (enableDebugLogs) {
        console.log('📡 Response status:', response.status);
      }
      const data = await response.json().catch(() => ({}));
      if (enableDebugLogs) {
        console.log('📡 Response data:', data);
      }

      if (!response.ok || data.error) {
        throw new Error(data.error || `Failed to ${action} booking`);
      }

      if (action === 'approve') {
        toast.success('Booking approved — payment captured and emails queued!');
      } else {
        toast.success('Booking denied and guest notified.');
      }

      await fetchBookings();
      setSelectedBooking(null);
      setDenialMessage('');
      if (onBookingsRefresh) {
        await onBookingsRefresh().catch((err) => {
          console.warn('⚠️ Failed to refresh parent bookings:', err);
        });
      }
    } catch (error: any) {
      console.error('❌ Error responding to booking:', error);
      toast.error(error?.message || 'An error occurred while processing your response.');
    } finally {
      setActionInFlight(false);
    }
  };


  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatClassDateRange = (startDate?: string, endDate?: string) => {
    const range = formatDateRangeShort(startDate, endDate);
    if (range) return range;
    return startDate ? formatDate(startDate) : 'Date TBD';
  };

  const formatTime = (timeString: string) => {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'bg-yellow-100 text-yellow-800';
      case 'APPROVED': return 'bg-green-100 text-green-800';
      case 'DENIED': return 'bg-red-100 text-red-800';
      case 'FAILED': return 'bg-gray-100 text-gray-800';
      case 'PAID': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getClassStartTimestamp = (cls: Class) => {
    if (!cls.startDate) return Number.POSITIVE_INFINITY;
    const start = new Date(`${cls.startDate}T${cls.startTime || '00:00'}`).getTime();
    return Number.isFinite(start) ? start : Number.POSITIVE_INFINITY;
  };

  const getClassEndTimestamp = (cls: Class) => {
    const dateStr = cls.endDate || cls.startDate;
    if (!dateStr) return null;
    const end = new Date(`${dateStr}T${cls.startTime || '00:00'}`);
    if (Number.isNaN(end.getTime())) return null;
    end.setHours(23, 59, 59, 999);
    return end.getTime();
  };

  const hostClasses = useMemo(() => {
    return classes.filter((cls) => {
      const hostId = cls.hostId ?? cls.instructorId ?? (cls as any).host_id ?? null;
      return hostId === user.id;
    });
  }, [classes, user.id]);

  const upcomingClasses = useMemo(() => {
    const now = Date.now();
    return hostClasses
      .filter((cls) => {
        const end = getClassEndTimestamp(cls);
        return end === null || end >= now;
      })
      .slice()
      .sort((a, b) => getClassStartTimestamp(a) - getClassStartTimestamp(b));
  }, [hostClasses]);

  const pastClasses = useMemo(() => {
    const now = Date.now();
    return hostClasses
      .filter((cls) => {
        const end = getClassEndTimestamp(cls);
        return end !== null && end < now;
      })
      .slice()
      .sort((a, b) => getClassStartTimestamp(b) - getClassStartTimestamp(a));
  }, [hostClasses]);

  const renderClassCard = (cls: Class, isPast: boolean) => {
    const classBookings = bookings.filter((b) => b.classId === cls.id);
    const PENDINGCount = classBookings.filter((b) => b.status === 'PENDING').length;
    const APPROVEDCount = classBookings.filter((b) => b.status === 'APPROVED' || b.status === 'PAID').length;

    const hostIdentifier = cls.hostId ?? cls.instructorId ?? (cls as any).host_id ?? null;
    const isClassOwner = hostIdentifier === user.id;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const classEndMs = getClassEndTimestamp(cls);
    const nowMs = Date.now();
    const pastDeletionWindow = classEndMs !== null ? nowMs >= classEndMs + sevenDaysMs : false;

    const hostDeleteDisabled = !user.isAdmin && isClassOwner && APPROVEDCount > 0 && !pastDeletionWindow;

    return (
      <Card key={cls.id} className="overflow-hidden">
        <div className="relative w-full h-40 md:h-48 bg-gray-100">
          {cls.photos && cls.photos.length > 0 ? (
            <ImageWithFallback
              src={cls.photos[0]}
              alt={cls.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#f8f9f6] to-[#e8e9e6] flex items-center justify-center">
              <div className="text-center text-[#556B2F]">
                <ImageIcon className="w-8 h-8 mx-auto mb-1 opacity-50" />
                <p className="text-xs opacity-70">No photo</p>
              </div>
            </div>
          )}
          <div className="absolute top-2 right-2 flex items-center gap-2">
            <Badge className="bg-[#556B2F] text-[#f8f9f6] text-xs">
              {formatPrice(cls.pricePerPerson, { withCurrency: true })}
            </Badge>
            {isPast && (
              <Badge className="bg-gray-200 text-gray-600 text-xs">Past</Badge>
            )}
          </div>
        </div>

        <CardHeader className="pb-3">
          <CardTitle className="text-[#3c4f21] text-lg leading-tight">{cls.title}</CardTitle>
          <p className="text-sm text-[#556B2F] line-clamp-2">{cls.shortSummary}</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 mb-4">
            <p className="text-sm">
              <strong>Dates:</strong> {formatClassDateRange(cls.startDate, cls.endDate)}
              {cls.startTime && ` at ${formatTime(cls.startTime)}`}
            </p>
            <p className="text-sm"><strong>Max Students:</strong> {cls.maxStudents}</p>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {PENDINGCount > 0 && (
              <Badge className="bg-yellow-100 text-yellow-800">
                {PENDINGCount} PENDING
              </Badge>
            )}
            {APPROVEDCount > 0 && (
              <Badge className="bg-green-100 text-green-800">
                {APPROVEDCount} CONFIRMED
              </Badge>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white"
                onClick={() => onManageClass(cls)}
              >
                <Eye className="h-4 w-4 mr-2" />
                {isPast ? 'View Past Class' : 'Manage Class'}
              </Button>

              {isPast && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-[#3c4f21] text-[#3c4f21] hover:bg-[#3c4f21] hover:text-white"
                  onClick={() => onRelaunchClass(cls)}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Relaunch as New Class
                </Button>
              )}
            </div>

            {(user.isAdmin || cls.instructorId === user.id) && (
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className={`w-full disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none ${
                    hostDeleteDisabled
                      ? 'border border-gray-300 text-gray-400 bg-gray-100'
                      : 'border border-red-500 text-red-500 hover:bg-red-500 hover:text-white'
                  }`}
                  disabled={hostDeleteDisabled}
                  onClick={() => onDeleteClass(cls.id)}
                  title={
                    user.isAdmin
                      ? "Delete class (Admin privileges)"
                      : hostDeleteDisabled
                        ? "Classes with approved bookings cannot be deleted"
                        : "Delete class"
                  }
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Class
                  {user.isAdmin && (
                    <Badge className="ml-2 bg-orange-500 text-white text-xs px-1 py-0">
                      ADMIN
                    </Badge>
                  )}
                </Button>
                {hostDeleteDisabled && (
                  <p className="mt-1 text-xs text-[#556B2F]">
                    Approved bookings prevent deleting this class while it is active.
                  </p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  let denialModal: React.ReactNode = null;
  if (selectedBooking) {
    const classData = classes.find(c => c.id === selectedBooking.classId);
    denialModal = (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[9999]">
        <Card className="bg-[#ffffff] border-[#a8b892] max-w-md w-full">
          <CardHeader className="bg-[#c54a2c] text-[#f8f9f6]">
            <CardTitle className="text-lg">Deny Booking Request</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div>
              <p className="text-sm text-[#556B2F] mb-2">
                <strong>Guest:</strong> {selectedBooking.userName}
              </p>
              <p className="text-sm text-[#556B2F] mb-2">
                <strong>Class:</strong> {classData?.title || 'Unknown Class'}
              </p>
              <p className="text-sm text-[#556B2F] mb-4">
                <strong>Students:</strong> {selectedBooking.studentCount}{' '}
                {selectedBooking.studentNames.length > 0
                  ? `(${selectedBooking.studentNames.join(', ')})`
                  : '(Guest did not provide names)'}
              </p>
            </div>
            
            <div>
              <Label htmlFor="denialMessage">Reason for denial (optional)</Label>
              <Textarea
                id="denialMessage"
                placeholder="Let the guest know why you can't accommodate their booking..."
                value={denialMessage}
                onChange={(e) => setDenialMessage(e.target.value)}
                className="mt-1"
                rows={3}
                autoFocus
              />
            </div>
            
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedBooking(null);
                  setDenialMessage('');
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={actionInFlight}
                onClick={() => {
                  if (enableDebugLogs) {
                    console.log('🧨 Deny clicked for', selectedBooking.id);
                  }
                  handleBookingResponse(selectedBooking.id, 'deny', denialMessage);
                }}
                className="flex-1"
              >
                {actionInFlight ? 'Processing...' : 'Deny Booking'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  let mainContent: React.ReactNode = null;

  if (activeView === 'overview') {
    mainContent = (
      <div>
        <div className="grid grid-cols-1 gap-3 md:gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-[#556B2F]">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-[#556B2F]" />
            </CardHeader>
            <CardContent className="pt-2">
              <div className="text-xl md:text-2xl font-bold text-[#3c4f21]">{totalRevenueDisplay}</div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-row flex-wrap gap-3 my-6">
          <Button 
            onClick={() => {
              if (!user.stripeConnected) {
                toast.warning('You need to connect your Stripe account before creating classes. Please complete your profile setup.');
                onNavigate('profile');
              } else {
                onNavigate('create-class');
              }
            }}
            className="bg-[#556B2F] hover:bg-[#3c4f21] text-white flex-1 min-w-[140px] h-auto py-3 px-6"
          >
            <Plus className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Create New Class</span>
            <span className="sm:hidden">New Class</span>
          </Button>
          <Button 
            onClick={() => onNavigate('classes')}
            className="bg-[#556B2F] hover:bg-[#3c4f21] text-white flex-1 min-w-[140px] h-auto py-3 px-6"
          >
            <Eye className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">View All Classes</span>
            <span className="sm:hidden">View Classes</span>
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          {/* Pending Bookings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-[#3c4f21] text-lg">Pending Bookings</CardTitle>
            </CardHeader>
            <CardContent>
              {PENDINGBookings.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No PENDING bookings</p>
              ) : (
                <div className="space-y-3">
                  {PENDINGBookings.slice(0, 3).map((booking) => {
                    const classData = classes.find(c => c.id === booking.classId);
                    const classEndMs = classData ? getClassEndTimestamp(classData) : null;
                    const classIsPast = typeof classEndMs === 'number' && classEndMs < Date.now();
                    return (
                      <div key={booking.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-[#f8f9f6] rounded-lg gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-[#3c4f21] truncate">{booking.userName}</p>
                          <p className="text-sm text-[#556B2F] truncate">{classData?.title || 'Unknown Class'}</p>
                          <p className="text-xs text-gray-500">{booking.studentCount} student{booking.studentCount > 1 ? 's' : ''}</p>
                          <p className="text-xs text-gray-500">{formatDate(booking.createdAt)}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex gap-2 justify-end w-full">
                            <Button 
                              size="sm" 
                              className="bg-green-600 hover:bg-green-700 text-white h-8 px-3"
                              onClick={() => handleBookingResponse(booking.id, 'approve')}
                              disabled={classIsPast}
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="destructive" 
                              className="h-8 px-3"
                              onClick={() => setSelectedBooking(booking)}
                              disabled={classIsPast}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                          {classIsPast && (
                            <p className="text-xs text-[#c54a2c] text-right">
                              This class has ended. Pending bookings were automatically denied.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Messages */}
          <Card>
            <CardHeader>
              <CardTitle className="text-[#3c4f21] text-lg">Recent Messages</CardTitle>
            </CardHeader>
            <CardContent>
              {recentIncomingMessages.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No messages</p>
              ) : (
                <div className="space-y-3">
                  {recentIncomingMessages.map((conversation) => {
                    const otherName =
                      conversation.hostId === user.id
                        ? conversation.guestName || "Guest"
                        : conversation.hostName || "Host";

                    const classTitle =
                      classes.find((c) => c.id === conversation.classId)?.title ||
                      "Unknown Class";

                  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;
                  const openConversation = () => {
                    onConversationNavigate?.(conversation.id);
                    if (isMobile) {
                      onConversationsUpdate?.((prev) => prev);
                    }
                  };

                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={openConversation}
                      className="block w-full text-left p-3 bg-[#f8f9f6] rounded-lg transition-colors hover:bg-[#e7ede0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#556B2F]"
                    >
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-medium text-[#3c4f21] truncate">
                            {otherName}
                          </p>
                          {conversation.unreadCount > 0 && (
                            <span className="ml-2 inline-flex items-center">
                              <span
                                className="block h-2.5 w-2.5 rounded-full bg-[#c54a2c]"
                                aria-hidden="true"
                              />
                              <span className="sr-only">
                                {`${conversation.unreadCount} unread message${conversation.unreadCount === 1 ? '' : 's'}`}
                              </span>
                            </span>
                          )}
                        </div>

                          <p className="text-sm text-[#556B2F] mb-1 truncate">{classTitle}</p>

                          {conversation.lastMessage && (
                            <p className="text-xs text-gray-600 truncate">
                              {conversation.lastMessage.content}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  } else if (activeView === 'classes') {
    mainContent = (
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h2 className="text-xl md:text-2xl font-bold text-[#3c4f21]">My Classes</h2>
          <Button 
            onClick={() => {
              if (!user.stripeConnected) {
                toast.warning('You need to connect your Stripe account before creating classes. Please complete your profile setup.');
                onNavigate('profile');
              } else {
                onNavigate('create-class');
              }
            }}
            className="bg-[#556B2F] hover:bg-[#3c4f21] text-white w-full sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Create New Class</span>
            <span className="sm:hidden">New Class</span>
          </Button>
        </div>

        {loading ? (
          <Card>
            <CardContent className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#556B2F] mx-auto mb-4"></div>
              <p className="text-gray-500">Loading classes...</p>
            </CardContent>
          </Card>
        ) : hostClasses.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">You haven't created any classes yet</p>
              <Button 
                onClick={() => {
                  if (!user.stripeConnected) {
                    toast.warning('You need to connect your Stripe account before creating classes. Please complete your profile setup.');
                    onNavigate('profile');
                  } else {
                    onNavigate('create-class');
                  }
                }}
                className="bg-[#556B2F] hover:bg-[#3c4f21] text-white"
              >
                {!user.stripeConnected ? 'Setup Stripe to Create Classes' : 'Create Your First Class'}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-[#3c4f21] mb-3">Upcoming & Active Classes</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {upcomingClasses.length === 0 ? (
                  <Card className="md:col-span-2 lg:col-span-3">
                    <CardContent className="text-center py-10 text-[#556B2F]">
                      No upcoming classes. Relaunch a past class or create a new one.
                    </CardContent>
                  </Card>
                ) : (
                  upcomingClasses.map((cls) => renderClassCard(cls, false))
                )}
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-[#3c4f21] mb-3">Past Classes</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {pastClasses.length === 0 ? (
                  <Card className="md:col-span-2 lg:col-span-3">
                    <CardContent className="text-center py-10 text-[#556B2F]">
                      No past classes yet.
                    </CardContent>
                  </Card>
                ) : (
                  pastClasses.map((cls) => renderClassCard(cls, true))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  } else if (activeView === 'bookings') {
    mainContent = (
      <div className="space-y-4 md:space-y-6">
        <h2 className="text-xl md:text-2xl font-bold text-[#3c4f21]">Booking Management</h2>
        
        {loading ? (
          <Card>
            <CardContent className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#556B2F] mx-auto mb-4"></div>
              <p className="text-gray-500">Loading bookings...</p>
            </CardContent>
          </Card>
        ) : orderedBookings.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No bookings yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {orderedBookings.map((booking) => {
              const classData = classes.find(c => c.id === booking.classId);
              const displayedEarnings = booking.status === 'DENIED' ? 0 : booking.subtotal;
              return (
                <Card key={booking.id}>
                  <CardContent className="p-4 md:p-6">
                    <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-3">
                          <h3 className="font-bold text-[#3c4f21] truncate">{classData?.title || 'Unknown Class'}</h3>
                          <Badge className={getStatusColor(booking.status)}>
                            {booking.status}
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                          <div>
                            <p className="text-sm text-[#556B2F]"><strong>Guest:</strong> {booking.userName}</p>
                            <p className="text-sm text-[#556B2F] truncate"><strong>Email:</strong> {booking.userEmail}</p>
                          </div>
                          <div>
                            <p className="text-sm text-[#556B2F]"><strong>Students:</strong> {booking.studentCount}</p>
                            <p className="text-sm text-[#556B2F]">
                              <strong>Your earnings:</strong> {formatPrice(displayedEarnings, { withCurrency: true })}
                            </p>
                          </div>
                        </div>
                        
                        <div className="space-y-1 mb-3">
                          <p className="text-sm text-gray-500">
                            <strong>Student Names:</strong>{' '}
                            {booking.studentNames.length > 0
                              ? booking.studentNames.join(', ')
                              : 'Not provided'}
                          </p>
                          <p className="text-sm text-gray-500">
                            <strong>Class Dates:</strong> {classData ? formatClassDateRange(classData.startDate, classData.endDate) : 'Unknown'}
                          </p>
                          <p className="text-sm text-gray-500">
                            <strong>Booked:</strong> {formatDate(booking.createdAt)}
                          </p>
                        </div>

                        {booking.status === 'DENIED' && booking.host_message && (
                          <div className="bg-red-50 border border-red-200 rounded p-2 mt-2">
                            <p className="text-sm text-red-800"><strong>Denial reason:</strong> {booking.host_message}</p>
                          </div>
                        )}
                      </div>
                      
                      {booking.status === 'PENDING' && (
                        <div className="flex gap-2 justify-end lg:justify-start">
                          <Button 
                            size="sm" 
                            className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                            disabled={actionInFlight}
                            onClick={() => handleBookingResponse(booking.id, 'approve')}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            <span className="hidden sm:inline">Approve</span>
                          </Button>
                          <Button 
                            size="sm" 
                            variant="destructive"
                            disabled={actionInFlight}
                            onClick={() => setSelectedBooking(booking)}
                          >
                            <X className="h-4 w-4 mr-1" />
                            <span className="hidden sm:inline">Deny</span>
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  } else if (activeView === 'messages' && onSendMessage) {
    mainContent = (
      <MessagingCenter 
        conversations={conversations}
        currentUserId={user.id}
        currentUserName={user.name}
        onSendMessage={onSendMessage}
        onConversationsUpdate={onConversationsUpdate}
        initialConversationId={forcedConversationId}
      />
    );
  }

  return (
    <>
      {mainContent}
      {denialModal}
    </>
  );
}
