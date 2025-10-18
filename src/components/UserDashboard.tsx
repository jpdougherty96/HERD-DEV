import React, { useMemo, useCallback } from 'react';
import type { User, Class, Page, Post } from '../App';
import { Booking, Conversation } from './Dashboard';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { MessagingCenter } from './MessagingCenter';
import { Calendar, Heart, MessageSquare, BookOpen, Star, Eye, HeartIcon, RefreshCw, Megaphone, Pencil, Trash2, Tag } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { supabase } from '../utils/supabase/client';
import { toast } from 'sonner@2.0.3';
import { formatPrice } from '../utils/money';
import { formatDateRangeShort } from '../utils/time';

interface UserDashboardProps {
  user: User;
  classes: Class[];
  bookings: Booking[];
  conversations: Conversation[];
  favorites: string[];
  posts: Post[];
  onNavigate: (page: Page) => void;
  activeView?: 'overview' | 'bookings' | 'favorites' | 'messages' | 'bulletins';
  onToggleFavorite?: (classId: string) => void;
  onSendMessage?: (conversationId: string, content: string) => void;
  onRefreshBookings?: () => void;
  loadingBookings?: boolean;
  onManageClass?: (classData: Class) => void;
  onSelectClass?: (classData: Class) => void;
  onConversationsUpdate?: (updater: (prev: Conversation[]) => Conversation[]) => void;
  onDeletePost?: (postId: string) => Promise<void> | void;
  onSelectPost?: (post: Post) => void;
}

export function UserDashboard({ 
  user, 
  classes,
  bookings, 
  conversations, 
  favorites,
  posts,
  onNavigate, 
  activeView = 'overview',
  onToggleFavorite,
  onSendMessage,
  onRefreshBookings,
  loadingBookings = false,
  onManageClass,
  onSelectClass,
  onConversationsUpdate,
  onDeletePost,
  onSelectPost
}: UserDashboardProps) {
  
  // ✅ Clean simplified logic for guest bookings
  const guestBookings = useMemo(() => {
    return bookings
      .filter(b => b.isGuestBooking)
      .sort((a, b) => {
        const aDate = new Date(`${a.startDate ?? a.createdAt}T${a.startTime ?? '00:00'}`).getTime();
        const bDate = new Date(`${b.startDate ?? b.createdAt}T${b.startTime ?? '00:00'}`).getTime();
        return aDate - bDate; // soonest first
      });
  }, [bookings]);

  const PENDINGBookings = guestBookings.filter(b => b.status === 'PENDING');
  const unreadMessages = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
  const favoriteClasses = useMemo(() => {
    const now = Date.now();

    const getSortTimestamp = (cls: Class) => {
      if (!cls.startDate) return Number.POSITIVE_INFINITY;
      const start = new Date(`${cls.startDate}T${cls.startTime || '00:00'}`).getTime();
      if (!Number.isFinite(start)) return Number.POSITIVE_INFINITY;
      return start;
    };

    return classes
      .filter((cls) => {
        if (!favorites.includes(cls.id)) return false;
        const timestamp = getSortTimestamp(cls);
        return timestamp > now;
      })
      .slice()
      .sort((a, b) => getSortTimestamp(a) - getSortTimestamp(b));
  }, [classes, favorites]);
  const myBookings = guestBookings;
  const reviewedCount = myBookings.filter(b => b.reviewed).length;

  // ✅ orderedBookings now just references sorted guestBookings
  const orderedBookings = guestBookings;
  const myBulletins = useMemo(() => {
    return (posts ?? [])
      .filter((post) => post.authorId === user.id)
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [posts, user.id]);

  const handleBulletinDelete = useCallback(
    async (post: Post) => {
      if (!onDeletePost) return;
      const confirmed = window.confirm(`Delete "${post.title}"? This action cannot be undone.`);
      if (!confirmed) return;
      await onDeletePost(post.id);
    },
    [onDeletePost],
  );

  const previewContent = (content: string, limit = 160) => {
    if (!content) return '';
    const trimmed = content.trim();
    return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
  };

  const formatDateShort = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleReviewClick = async (booking: Booking) => {
    try {
      let token = booking.reviewToken || null;
      if (!token) {
        const { data, error } = await supabase
          .from('review_tokens')
          .select('token')
          .eq('booking_id', booking.id)
          .eq('user_id', user.id)
          .is('used_at', null)
          .maybeSingle();

        if (error) throw error;
        token = data?.token ?? null;
      }

      if (!token) {
        toast.info('Your review link is not ready yet. Please check back soon.');
        return;
      }

      window.location.href = `/review?token=${encodeURIComponent(token)}`;
    } catch (error) {
      console.error('Error opening review link', error);
      toast.error('Unable to open the review form right now. Please try again later.');
    }
  };

  const getClassEndTimestamp = (booking: Booking): number | null => {
    const datePart =
      booking.startDate ??
      (booking.createdAt && booking.createdAt.includes('T')
        ? booking.createdAt.split('T')[0]
        : null);
    if (!datePart) {
      if (booking.reviewReadyAt) {
        const readyDate = new Date(booking.reviewReadyAt);
        if (!isNaN(readyDate.getTime())) {
          return readyDate.getTime() - 24 * 3600 * 1000;
        }
      }
      return null;
    }

    const timePart =
      booking.startTime ??
      (booking.createdAt && booking.createdAt.includes('T')
        ? booking.createdAt.split('T')[1]?.slice(0, 5)
        : '00:00');

    const start = new Date(`${datePart}T${timePart}`);
    if (isNaN(start.getTime())) return null;

    const rawDays = Number(booking.numberOfDays ?? 1);
    const numberOfDays = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 1;
    const rawHoursPerDay = Number(booking.hoursPerDay ?? 0);
    const hoursPerDay = Number.isFinite(rawHoursPerDay) && rawHoursPerDay > 0 ? rawHoursPerDay : 0;
    const totalHours = Math.max(0, hoursPerDay) * Math.max(1, numberOfDays);

    return start.getTime() + totalHours * 3600 * 1000;
  };

  const getReviewStatusMessage = (booking: Booking) => {
    if (booking.reviewed) return null;

    const classEndMs = getClassEndTimestamp(booking);
    const nowMs = Date.now();
    const status = (booking.status || '').toUpperCase();
    const eligibleStatus = status === 'APPROVED' || status === 'PAID';

    if (!booking.reviewToken && eligibleStatus && classEndMs !== null) {
      if (classEndMs <= nowMs) {
        const hoursSinceEnd = (nowMs - classEndMs) / (3600 * 1000);
        if (hoursSinceEnd < 24) {
          return 'Review invite will be emailed soon.';
        }
      }
      return null;
    }

    if (!booking.reviewEligible) {
      if (booking.reviewToken && booking.reviewReadyAt) {
        const readyDate = new Date(booking.reviewReadyAt);
        if (!isNaN(readyDate.getTime())) {
          return `Review available on ${readyDate.toLocaleString()}`;
        }
      }
      if (booking.reviewToken) {
        return 'Review available soon.';
      }
      return null;
    }

    return null;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '—';
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'bg-yellow-100 text-yellow-800';
      case 'APPROVED': return 'bg-green-100 text-green-800';
      case 'DENIED': 
      case 'FAILED': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusDisplayName = (status: string) => {
    switch (status) {
      case 'PENDING': return 'Pending';
      case 'APPROVED': return 'Approved';
      case 'DENIED': return 'Denied';
      case 'FAILED': return 'Failed';
      default: return status || 'Unknown';
    }
  };

  const handleClassTitleClick = (classId: string) => {
    if (!onManageClass) return;
    const classData = classes.find(cls => cls.id === classId);
    if (classData) onManageClass(classData);
  };

  const getBookingHostName = (booking: Booking) => {
    const classData = classes.find(cls => cls.id === booking.classId);
    const candidates = [
      booking.hostName,
      classData?.hostName,
      classData?.instructorName,
    ];
    const match = candidates.find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    );
    return match ? match.trim() : null;
  };

  const renderBookingSummary = (booking: Booking) => {
    const hostName = getBookingHostName(booking);
    const classData = classes.find(cls => cls.id === booking.classId);
    const dateLabel = formatDateRangeShort(
      booking.startDate ?? classData?.startDate,
      classData?.endDate
    ) || formatDate(booking.startDate ?? booking.createdAt);
    return (
      <div className="p-3 bg-[#f8f9f6] rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => handleClassTitleClick(booking.classId)}
            className="font-medium text-[#3c4f21] hover:text-[#556B2F] underline text-left"
          >
            {booking.className || 'Unknown Class'}
          </button>
          <Badge className={getStatusColor(booking.status)}>{getStatusDisplayName(booking.status)}</Badge>
        </div>
        <p className="text-sm text-[#556B2F] italic">
          {hostName ? `Host: ${hostName}` : 'Host info unavailable'}
        </p>
        <p className="text-xs text-gray-500">{dateLabel}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {booking.reviewed ? (
            <Badge className="bg-green-100 text-green-800">Reviewed</Badge>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white"
                disabled={!booking.reviewEligible}
                onClick={() => handleReviewClick(booking)}
              >
                Leave Review
              </Button>
              {getReviewStatusMessage(booking) && (
                <span className="text-xs text-gray-500">{getReviewStatusMessage(booking)}</span>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  // ===========================
  // OVERVIEW
  // ===========================
  if (activeView === 'overview') {
    return (
      <div className="space-y-6">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { title: 'My Bookings', icon: Calendar, count: myBookings.length },
            { title: 'Pending', icon: Calendar, count: PENDINGBookings.length, iconColor: '#c54a2c' },
            { title: 'Favorites', icon: Heart, count: favorites.length, iconColor: '#c54a2c' },
            { title: 'Reviews Left', icon: Star, count: reviewedCount, iconColor: '#c54a2c' },
          ].map((stat, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-[#556B2F]">{stat.title}</CardTitle>
                <stat.icon className="h-4 w-4" style={{ color: stat.iconColor || '#556B2F' }} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-[#3c4f21]">{stat.count}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="flex gap-4">
          <Button onClick={() => onNavigate('classes')} className="bg-[#556B2F] hover:bg-[#3c4f21] text-white">
            <BookOpen className="h-4 w-4 mr-2" />
            Browse Classes
          </Button>
          <Button 
            variant="outline" 
            onClick={() => onNavigate('bulletin')}
            className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white"
          >
            <Eye className="h-4 w-4 mr-2" />
            View Bulletin Board
          </Button>
        </div>

        {/* Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Bookings */}
          <Card>
            <CardHeader><CardTitle className="text-[#3c4f21]">Recent Bookings</CardTitle></CardHeader>
            <CardContent>
              {myBookings.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500 mb-4">No bookings yet</p>
                  <Button onClick={() => onNavigate('classes')} className="bg-[#556B2F] hover:bg-[#3c4f21] text-white">
                    Browse Classes
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {orderedBookings.slice(0, 3).map((b) => (
                    <div key={b.id}>{renderBookingSummary(b)}</div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Favorite Classes */}
          <Card>
            <CardHeader><CardTitle className="text-[#3c4f21]">Favorite Classes</CardTitle></CardHeader>
            <CardContent>
              {favoriteClasses.length === 0 ? (
                <div className="text-center py-8">
                  <Heart className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500 mb-4">No favorites yet</p>
                  <Button onClick={() => onNavigate('classes')} className="bg-[#556B2F] hover:bg-[#3c4f21] text-white">
                    Discover Classes
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {favoriteClasses.slice(0, 3).map((cls) => (
                    <div key={cls.id} className="p-3 bg-[#f8f9f6] rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-medium text-[#3c4f21]">{cls.title}</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-[#c54a2c] hover:text-[#c54a2c]"
                          onClick={() => onToggleFavorite?.(cls.id)}
                        >
                          <HeartIcon className="h-4 w-4 fill-current" />
                        </Button>
                      </div>
                      <p className="text-sm text-[#556B2F]">{cls.instructorName || '—'}</p>
                      <p className="text-sm text-[#556B2F]">
                        {formatPrice(cls.pricePerPerson, { withCurrency: true })}/person
                      </p>
                      <p className="text-xs text-gray-500">{formatDateRangeShort(cls.startDate, cls.endDate)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ===========================
  // BOOKINGS
  // ===========================
  if (activeView === 'bookings') {
    console.log("📘 Rendering MY BOOKINGS tab");
    console.log("bookings prop:", bookings);
    console.log("orderedBookings:", orderedBookings);
    console.log("guestBookings:", bookings.filter(b => b.isGuestBooking));
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-[#3c4f21]">My Bookings</h2>
          {onRefreshBookings && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRefreshBookings}
              disabled={loadingBookings}
              className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loadingBookings ? 'animate-spin' : ''}`} />
              {loadingBookings ? 'Loading...' : 'Refresh'}
            </Button>
          )}
        </div>

        {loadingBookings ? (
          <Card><CardContent className="text-center py-12">Loading...</CardContent></Card>
        ) : orderedBookings.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">You haven't booked any classes yet</p>
              <Button onClick={() => onNavigate('classes')} className="bg-[#556B2F] hover:bg-[#3c4f21] text-white">
                Browse Classes
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {orderedBookings.map((b) => (
              <Card key={b.id}>
                <CardContent className="space-y-4">
                  {renderBookingSummary(b)}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-[#556B2F]">
                    <p>
                      <strong>Total Paid:</strong> ${((b.totalAmount ?? 0) / 100).toFixed(2)}
                    </p>
                    <p>
                      <strong>Booked:</strong> {formatDate(b.createdAt)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ===========================
  // FAVORITES
  // ===========================
  if (activeView === 'favorites') {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-[#3c4f21]">Favorite Classes</h2>
        {favoriteClasses.length === 0 ? (
          <Card><CardContent className="text-center py-12">No favorites yet</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {favoriteClasses.map((cls) => (
              <Card
                key={cls.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (onSelectClass) {
                    onSelectClass(cls);
                  } else {
                    onNavigate('class-detail');
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (onSelectClass) {
                      onSelectClass(cls);
                    } else {
                      onNavigate('class-detail');
                    }
                  }
                }}
                className="group cursor-pointer border-[#a8b892] hover:shadow-xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#556B2F]"
              >
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-[#3c4f21] flex-1 truncate">
                      <span className="underline-offset-2 group-hover:underline">{cls.title}</span>
                    </CardTitle>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-[#c54a2c] hover:text-[#c54a2c] ml-2"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleFavorite?.(cls.id);
                      }}
                    >
                      <HeartIcon className="h-4 w-4 fill-current" />
                    </Button>
                  </div>
                  <p className="text-sm text-[#556B2F]">{cls.shortSummary}</p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-[#556B2F]">
                  <p><strong>Instructor:</strong> {cls.instructorName || '—'}</p>
                  <p><strong>Dates:</strong> {formatDateRangeShort(cls.startDate, cls.endDate)}</p>
                  <p>
                    <strong>Price:</strong> {formatPrice(cls.pricePerPerson, { withCurrency: true })}/person
                  </p>
                  <p>
                    <strong>Duration:</strong> {(cls.numberOfDays ?? 0)} day{(cls.numberOfDays ?? 0) > 1 ? 's' : ''}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ===========================
  // BULLETINS
  // ===========================
  if (activeView === 'bulletins') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-[#3c4f21]">My Bulletins</h2>
            <p className="text-sm text-[#556B2F]">Manage posts you&apos;ve published to the community.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="bg-[#556B2F] hover:bg-[#3c4f21] text-white"
              onClick={() => onNavigate('bulletin')}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Create Bulletin
            </Button>
            <Button
              variant="outline"
              className="border-[#556B2F] text-[#556B2F] hover:bg-[#556B2F] hover:text-white"
              onClick={() => onNavigate('bulletin')}
            >
              <Eye className="h-4 w-4 mr-2" />
              View Board
            </Button>
          </div>
        </div>

        {myBulletins.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-[#556B2F] space-y-3">
              <Megaphone className="h-10 w-10 mx-auto text-gray-400" />
              <p>You haven&apos;t posted any bulletins yet.</p>
              <Button
                className="bg-[#556B2F] hover:bg-[#3c4f21] text-white"
                onClick={() => onNavigate('bulletin')}
              >
                Write Your First Bulletin
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {myBulletins.map((post) => {
              const preview = previewContent(post.content || '', 180);
              const cover = post.photos?.[0] ?? null;
              return (
                <Card key={post.id} className="border-[#a8b892]">
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <CardTitle className="text-[#3c4f21] text-lg sm:text-xl">{post.title}</CardTitle>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-[#556B2F]">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" /> {formatDateShort(post.createdAt)}
                        </span>
                        <Badge className="bg-[#a8b892] text-[#2d3d1f] flex items-center gap-1">
                          <Tag className="h-3 w-3" /> {post.category || 'General'}
                        </Badge>
                        {post.photos?.length ? (
                          <span className="text-xs text-gray-500">{post.photos.length} photo{post.photos.length === 1 ? '' : 's'}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="bg-[#556B2F] hover:bg-[#3c4f21] text-white"
                        onClick={() => {
                          onSelectPost?.(post);
                          onNavigate('bulletin-detail');
                        }}
                      >
                        <Pencil className="h-4 w-4 mr-1" /> View / Edit
                      </Button>
                      {onDeletePost && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-500 text-red-600 hover:bg-red-50"
                          onClick={() => void handleBulletinDelete(post)}
                        >
                          <Trash2 className="h-4 w-4 mr-1" /> Delete
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-[#3c4f21]">
                    {cover && (
                      <div className="relative h-40 w-full overflow-hidden rounded-lg border border-[#a8b892]">
                        <ImageWithFallback src={cover} alt={`${post.title} cover`} className="h-full w-full object-cover" />
                      </div>
                    )}
                    {preview && <p className="leading-relaxed text-[#3c4f21]">{preview}</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ===========================
  // MESSAGES
  // ===========================
  if (activeView === 'messages' && onSendMessage) {
    return (
      <MessagingCenter 
        conversations={conversations}
        currentUserId={user.id}
        currentUserName={user.name}
        onSendMessage={onSendMessage}
        onConversationsUpdate={onConversationsUpdate}
      />
    );
  }

  return null;
}
