import React, { Suspense, useState, useEffect } from 'react';
import { HomePage } from './components/HomePage';
import { ClassForm } from './components/ClassForm';
import { ClassListing } from './components/ClassListing';
import { ClassDetail } from './components/ClassDetail';
import { HostProfilePage } from './components/HostProfilePage';
import { BulletinBoard } from './components/BulletinBoard';
import { BulletinDetail } from './components/BulletinDetail';
import { Navigation } from './components/Navigation';
import ReviewHost from './components/ReviewHost';
import { AuthModal } from './components/AuthModal';
import { OnboardingModal } from './components/OnboardingModal';
import { EmailVerificationBanner } from './components/EmailVerificationBanner';
import { ProfilePage } from './components/ProfilePage';
import { Dashboard } from './components/Dashboard';
import { ClassManagement } from './components/ClassManagement';
import { supabase } from './utils/supabase/client';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner@2.0.3';
import { normalizeToCents, resolvePriceCentsFromRow } from './utils/money';
import { ResetPasswordModal } from './components/ResetPasswordModal';

export type Page =
  | 'home'
  | 'classes'
  | 'class-detail'
  | 'host-profile'
  | 'create-class'
  | 'bulletin'
  | 'bulletin-detail'
  | 'profile'
  | 'dashboard'
  | 'edit-class'
  | 'manage-class';

// ===== UI Types (keep as-is) =====
export type User = {
  id: string;
  email: string;
  name: string;
  farmName?: string;
  bio?: string;
  profilePicture?: string;
  location?: string;
  stripeConnected: boolean;
  isAdmin?: boolean;
  createdAt: string;
};

export type Class = {
  id: string;
  title: string;
  shortSummary: string;
  startDate: string;
  startTime: string;
  endDate: string;
  numberOfDays: number;
  hoursPerDay?: number | null;
  pricePerPerson: number; // ← we will store cents here to match DB, just like before
  maxStudents: number;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country?: string;
  };
  instructorName: string;   // backed by classes.instructor_name, falls back to host profile name
  instructorId: string;
  hostId: string;
  host_id?: string; // legacy snake_case consumer support
  hostName?: string;
  minimumAge: number;
  instructorBio: string;
  instructorAvatar?: string | null;
  advisories: string;
  houseRules: string;
  photos?: string[];
  auto_approve: boolean;
  createdAt: string;
  hostRatingAverage?: number | null;
  hostRatingCount?: number;
  hostProfile?: {
    fullName?: string;
    farmName?: string;
    bio?: string;
    avatarUrl?: string | null;
    ratingAverage?: number | null;
    ratingCount?: number;
  } | null;
};

export type Post = {
  id: string;
  title: string;
  content: string;
  author: string;   // we can hydrate from profiles later (now: local user.name or blank)
  authorId: string;
  authorEmail?: string | null;
  createdAt: string;
  category: string;
  photos?: string[];
};

const GUEST_DASHBOARD_TAB_PATHS = {
  overview: '',
  bookings: 'mybookings',
  favorites: 'favorites',
  bulletins: 'mybulletins',
  messages: 'messages',
} as const;

const HOST_DASHBOARD_TAB_PATHS = {
  overview: 'overview',
  classes: 'classes',
  bookings: 'bookings',
  messages: 'messages',
} as const;

type GuestDashboardTab = keyof typeof GUEST_DASHBOARD_TAB_PATHS;

type GuestDashboardDeepLink = {
  tab: GuestDashboardTab;
  conversationId?: string | null;
};

type HostDashboardDeepLink = {
  tab: keyof typeof HOST_DASHBOARD_TAB_PATHS;
};

const CheckoutSuccessPage = React.lazy(() => import("./pages/checkout/CheckoutSuccessPage"));
const CheckoutCancelPage = React.lazy(() => import("./pages/checkout/CheckoutCancelPage"));

const normalizePathname = (pathname: string) => {
  if (typeof pathname !== 'string') return '/';
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === '/') return '/';
  return trimmed.replace(/\/+$/, '') || '/';
};

const parseGuestDashboardPath = (pathname: string): GuestDashboardDeepLink | null => {
  if (typeof window === 'undefined') return null;
  if (typeof pathname !== 'string') return null;

  const normalizedPath = normalizePathname(pathname);
  if (!normalizedPath.startsWith('/dashboard')) return null;

  const rawSegments = normalizedPath.split('/').filter(Boolean);
  if (rawSegments.length === 0) return null;

  const segments = rawSegments.map((segment) => segment.toLowerCase());
  if (segments[0] !== 'dashboard') return null;

  const modeSegment = segments[1] ?? 'guestview';
  if (modeSegment !== 'guestview') return null;

  const tabSegment = segments[2] ?? '';
  const rawTabSegment = rawSegments[2] ?? '';

  let tab: GuestDashboardTab | null = null;

  if (!tabSegment) {
    tab = 'overview';
  } else {
    const directMatch = (Object.entries(GUEST_DASHBOARD_TAB_PATHS) as Array<[GuestDashboardTab, string]>)
      .find(([, slug]) => slug === tabSegment || slug === rawTabSegment);

    if (directMatch) {
      tab = directMatch[0];
    } else {
      switch (tabSegment) {
        case 'overview':
          tab = 'overview';
          break;
        case 'bookings':
        case 'mybookings':
          tab = 'bookings';
          break;
        case 'favorites':
          tab = 'favorites';
          break;
        case 'bulletins':
        case 'mybulletins':
          tab = 'bulletins';
          break;
        case 'messages':
          tab = 'messages';
          break;
        default:
          tab = null;
      }
    }
  }

  if (!tab) return null;

  const rawConversationId = rawSegments[3] ?? null;
  const conversationId =
    tab === 'messages' && typeof rawConversationId === 'string' && rawConversationId.length > 0
      ? rawConversationId
      : null;

  return { tab, conversationId };
};

const parseHostDashboardPath = (pathname: string): HostDashboardDeepLink | null => {
  if (typeof window === 'undefined') return null;
  if (typeof pathname !== 'string') return null;

  const normalizedPath = normalizePathname(pathname);
  if (!normalizedPath.startsWith('/dashboard')) return null;

  const rawSegments = normalizedPath.split('/').filter(Boolean);
  if (rawSegments.length === 0) return null;

  const segments = rawSegments.map((segment) => segment.toLowerCase());
  if (segments[0] !== 'dashboard') return null;

  const modeSegment = segments[1] ?? 'guestview';
  if (modeSegment !== 'hostview') return null;

  const tabSegment = segments[2] ?? 'overview';
  if (tabSegment in HOST_DASHBOARD_TAB_PATHS) {
    return { tab: tabSegment as keyof typeof HOST_DASHBOARD_TAB_PATHS };
  }

  return { tab: 'overview' };
};

function CheckoutRouteFallback({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f9f6] px-6">
      <div className="rounded-lg border border-neutral-200 bg-white px-6 py-10 text-center shadow-sm">
        <p className="text-neutral-600">{message}</p>
      </div>
    </div>
  );
}

// ===== Mapping helpers: DB → UI =====
function mapProfileRowToUser(row: any): User {
  return {
    id: row.id,
    email: row.email ?? '',
    name: row.full_name || (row.email ? row.email.split('@')[0] : 'User'),
    farmName: row.farm_name ?? '',
    bio: row.bio ?? '',
    profilePicture: row.avatar_url ?? '',
    location: row.location ?? '',
    stripeConnected: !!row.stripe_connected,
    isAdmin: !!row.is_admin,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

function resolveHostName(row: any): string {
  const hostProfile =
    row?.host_profile ??
    row?.profiles ??
    row?.profile ??
    row?.hostProfile ??
    null;

  const candidates = [
    row?.instructor_name,
    row?.host_name,
    row?.hostName,
    hostProfile?.full_name,
    hostProfile?.name,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return '';
}

function resolveHoursPerDay(value: any): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric >= 24) return null;
  return numeric;
}

function mapClassRowToUI(row: any): Class {
  const hostName = resolveHostName(row);
  const instructorNameRaw = typeof row?.instructor_name === 'string' ? row.instructor_name.trim() : '';
  const instructorName = instructorNameRaw || hostName || '';
  const hostProfile =
    row?.host_profile ??
    row?.profiles ??
    row?.profile ??
    row?.hostProfile ??
    null;
  const ratingAverageRaw =
    hostProfile?.rating_average ??
    hostProfile?.ratingAverage ??
    row?.rating_average ??
    null;
  const ratingCountRaw =
    hostProfile?.rating_count ??
    hostProfile?.ratingCount ??
    row?.rating_count ??
    null;
  const ratingAverage =
    ratingAverageRaw === null || ratingAverageRaw === undefined || ratingAverageRaw === ''
      ? null
      : Number(ratingAverageRaw);
  const ratingCount =
    ratingCountRaw === null || ratingCountRaw === undefined || ratingCountRaw === ''
      ? 0
      : Number(ratingCountRaw);
  return {
    id: row.id,
    title: row.title,
    shortSummary: row.short_summary ?? '',
    startDate: row.start_date ?? '',
    startTime: row.start_time ?? '',
    endDate: row.end_date ?? row.start_date ?? '',
    numberOfDays: row.number_of_days ?? 1,
    hoursPerDay: resolveHoursPerDay(row.hours_per_day),
    pricePerPerson: resolvePriceCentsFromRow(row),
    maxStudents: row.max_students ?? 0,
    address: {
      street: row.address_street ?? '',
      city: row.address_city ?? '',
      state: row.address_state ?? '',
      zipCode: row.address_zip ?? '',
      country: row.address_country ?? '',
    },
    instructorName,
    hostId: row.host_id,
    host_id: row.host_id,
    hostName: hostName || instructorName,
    instructorId: row.host_id,
    minimumAge: row.minimum_age ?? 0,
    instructorBio: row.instructor_bio ?? '',
    instructorAvatar: hostProfile?.avatar_url ?? null,
    advisories: row.advisories ?? '',
    houseRules: row.house_rules ?? '',
    photos: row.photos ?? [],
    auto_approve: !!row.auto_approve,
    createdAt: row.created_at ?? new Date().toISOString(),
    hostRatingAverage: Number.isFinite(ratingAverage) ? ratingAverage : null,
    hostRatingCount: Number.isFinite(ratingCount) ? ratingCount : 0,
    hostProfile: {
      fullName: hostProfile?.full_name ?? '',
      farmName: hostProfile?.farm_name ?? '',
      bio: hostProfile?.bio ?? '',
      avatarUrl: hostProfile?.avatar_url ?? null,
      ratingAverage: Number.isFinite(ratingAverage) ? ratingAverage : null,
      ratingCount: Number.isFinite(ratingCount) ? ratingCount : 0,
    },
  };
}

function applyInstructorFallback(cls: Class, currentUser?: User | null): Class {
  const trimmedInstructorName = (cls.instructorName ?? '').trim();
  const trimmedHostName = (cls.hostName ?? '').trim();

  if (trimmedInstructorName && trimmedHostName) {
    return cls;
  }

  const fallbackName = trimmedInstructorName
    || trimmedHostName
    || (currentUser && cls.instructorId === currentUser.id ? currentUser.name : '');

  if (!fallbackName) {
    return cls;
  }

  return {
    ...cls,
    instructorName: trimmedInstructorName || fallbackName,
    hostName: trimmedHostName || fallbackName,
  };
}

function mapPostRowToUI(row: any): Post {
  const profile =
    row?.author_profile ??
    row?.profile ??
    row?.profiles ??
    null;
  const authorNameRaw =
    typeof profile?.full_name === 'string'
      ? profile.full_name
      : typeof row?.author === 'string'
        ? row.author
        : '';
  const authorName = authorNameRaw?.trim?.() ? authorNameRaw.trim() : '';
  const categoryRaw =
    typeof row?.category === 'string' && row.category.trim().length > 0
      ? row.category.trim()
      : 'General Discussion';
  const photosArray = Array.isArray(row?.photos) ? row.photos : [];

  return {
    id: row.id,
    title: row.title,
    content: row.content ?? '',
    author: authorName,
    authorId: row.user_id,
    createdAt: row.created_at ?? new Date().toISOString(),
    category: categoryRaw,
    authorEmail: profile?.email ?? null,
    photos: photosArray,
  };
}
function getConversationOtherProfile(conv: any, currentUserId: string) {
  const hostProfile = conv.host_profile ?? conv.host ?? null;
  const guestProfile = conv.guest_profile ?? conv.guest ?? null;

  if (conv.host_id && conv.host_id !== currentUserId && hostProfile) return hostProfile;
  if (conv.guest_id && conv.guest_id !== currentUserId && guestProfile) return guestProfile;
  if (conv.host_id === currentUserId) return guestProfile;
  if (conv.guest_id === currentUserId) return hostProfile;
  return hostProfile || guestProfile || null;
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [selectedClass, setSelectedClass] = useState<Class | null>(null);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [classes, setClasses] = useState<Class[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [favoriteClassIds, setFavoriteClassIds] = useState<string[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [authSession, setAuthSession] = useState<any | undefined>(undefined);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Loading...');
  const [emailVerified, setEmailVerified] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [classFormInitialData, setClassFormInitialData] = useState<Class | null>(null);
  const [classFormMode, setClassFormMode] = useState<'create' | 'relaunch'>('create');
  const [pendingGuestDashboardRoute, setPendingGuestDashboardRoute] = useState<GuestDashboardDeepLink | null>(null);
  const [pendingHostDashboardRoute, setPendingHostDashboardRoute] = useState<HostDashboardDeepLink | null>(null);
  const [dashboardLink, setDashboardLink] = useState<{
    tab?: string | null;
    bookingId?: string | null;
    conversationId?: string | null;
    guestId?: string | null;
    guestName?: string | null;
    classId?: string | null;
    classTitle?: string | null;
    consumed?: boolean;
    role?: "host" | "guest";
  } | null>(null);

  useEffect(() => {
    if (!selectedPost) return;
    const fresh = posts.find((post) => post.id === selectedPost.id);
    if (!fresh) {
      setSelectedPost(null);
      if (currentPage === 'bulletin-detail') {
        setCurrentPage('bulletin');
      }
      return;
    }

    if (fresh !== selectedPost) {
      setSelectedPost(fresh);
    }
  }, [posts, currentPage, selectedPost]);

  useEffect(() => {
    if (!user?.id) {
      setFavoriteClassIds([]);
      return;
    }
    void loadFavoritesFromServer(user.id);
  }, [user?.id]);

  useEffect(() => {
    setClasses((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const normalized = prev.map((cls) => {
        const normalizedCls = applyInstructorFallback(cls, user);
        if (normalizedCls !== cls) {
          changed = true;
        }
        return normalizedCls;
      });
      return changed ? normalized : prev;
    });
  }, [user?.id]);

  // ===== Local cache helpers =====
  const cacheData = (key: string, data: any) => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error: any) {
      if (error?.name === 'QuotaExceededError') {
        try {
          localStorage.removeItem('herd-posts');
          localStorage.setItem(key, JSON.stringify(data));
        } catch {}
      }
    }
  };

  const handleSubmitEditedClass = async (
    updatedData: Omit<Class, 'createdAt' | 'instructorId'> & { id?: string }
  ) => {
    const classId = updatedData.id ?? selectedClass?.id;
    if (!classId) {
      toast.error('Unable to identify the class you are editing.');
      return;
    }

    const normalizedHoursPerDay =
      updatedData.hoursPerDay === null
        ? null
        : resolveHoursPerDay(updatedData.hoursPerDay);

    const updates: Partial<Class> = {
      title: updatedData.title,
      shortSummary: updatedData.shortSummary,
      startDate: updatedData.startDate,
      startTime: updatedData.startTime,
      endDate: updatedData.endDate,
      numberOfDays: updatedData.numberOfDays,
      hoursPerDay: normalizedHoursPerDay,
      pricePerPerson: updatedData.pricePerPerson,
      maxStudents: updatedData.maxStudents,
      address: updatedData.address,
      minimumAge: updatedData.minimumAge,
      instructorBio: updatedData.instructorBio,
      advisories: updatedData.advisories,
      houseRules: updatedData.houseRules,
      photos: updatedData.photos,
      auto_approve: updatedData.auto_approve,
      instructorName: updatedData.instructorName,
    };

    const success = await handleUpdateClass(classId, updates, {
      hasApprovedBookings: false,
      successMessage: 'Class details updated successfully.',
    });

    if (success) {
      setCurrentPage('manage-class');
    }
  };

  const getCachedData = (key: string) => {
    try {
      const cached = localStorage.getItem(key);
      return cached ? JSON.parse(cached) : null;
    } catch {
      try { localStorage.removeItem(key); } catch {}
      return null;
    }
  };

  // Load initial data regardless of auth state so guests can browse content
  useEffect(() => {
    if (!dataLoaded) {
      void loadInitialData();
    }
  }, [dataLoaded]);

  const loadInitialData = async () => {
    if (dataLoaded) return;

    setLoading(true);
    setLoadingMessage('Loading your data...');

    try {
      // use cached data
      const cachedClasses = getCachedData('herd-classes');
      const cachedPosts = getCachedData('herd-posts');
      if (cachedClasses?.length > 0) {
        const normalizedCached = cachedClasses.map((cls: Class) =>
          applyInstructorFallback(
            {
              ...cls,
              hostName: cls.hostName || cls.instructorName || '',
              instructorName: cls.instructorName || cls.hostName || '',
            },
            user
          )
        );
        setClasses(normalizedCached);
        cacheData('herd-classes', normalizedCached);
      }
      if (cachedPosts?.length > 0) setPosts(cachedPosts);

      // fetch fresh in parallel (with a soft timeout)
      const dataLoadingPromise = Promise.allSettled([
        loadClassesFromServer(),
        loadPostsFromServer()
      ]);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Data loading timeout')), 10000);
      });

      try {
        await Promise.race([dataLoadingPromise, timeoutPromise]);
      } catch {
        // fine: keep cached data
      }

      setDataLoaded(true);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load initial data:', err);
      setDataLoaded(true);
      setLoading(false);
    }
  };

  // ===== Supabase data fetchers (no more legacy endpoints) =====
  const loadClassesFromServer = async () => {
    try {
      const { data, error } = await supabase
        .from('classes')
        .select(`
          *,
          host_profile:profiles!classes_host_id_fkey(full_name, avatar_url, farm_name, bio, rating_average, rating_count)
        `)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      const normalized = (data ?? [])
        .map(mapClassRowToUI)
        .map((cls) => applyInstructorFallback(cls, user));
      setClasses(normalized);
      cacheData('herd-classes', normalized);
    } catch (error: any) {
      console.error('Error loading classes:', error?.message || error);
    }
  };

  const loadPostsFromServer = async () => {
    try {
      const { data, error } = await supabase
        .from('posts')
        .select(`
          *,
          author_profile:profiles!posts_user_id_fkey(
            id,
            full_name,
            email,
            avatar_url
          )
        `)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      const ui = (data ?? []).map(mapPostRowToUI);
      setPosts(ui);
      cacheData('herd-posts', ui);
    } catch (error: any) {
      console.error('Error loading posts:', error?.message || error);
    }
  };

  const loadFavoritesFromServer = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('favorites')
        .select('class_id')
        .eq('user_id', userId);

      if (error) throw error;
      const ids = Array.isArray(data) ? data.map((row: any) => row.class_id).filter(Boolean) : [];
      setFavoriteClassIds(ids);
    } catch (error: any) {
      console.error('Error loading favorites:', error?.message || error);
      setFavoriteClassIds([]);
    }
  };

  // ===== Auth boot + listeners =====
  useEffect(() => {
    let mounted = true;

    // global safety fallback
    const globalSafetyTimeout = setTimeout(() => {
      if (mounted && loading) {
        setLoading(false);
      }
    }, 15000);

    // strip ?verified=true if present
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('verified') === 'true') {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const initializeAuth = async () => {
      try {
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error('Session check timeout')), 2000)
        );

        const { data: { session } } = await Promise.race([sessionPromise, timeoutPromise]) as any;
        if (!mounted) return;

        setAuthSession(session);

        if (session?.user) {
          const actuallyVerified = !!session.user.email_confirmed_at;
          setEmailVerified(actuallyVerified);

          setLoadingMessage('Loading your profile...');
          try {
            await loadUserProfile(session.user.id, 0);
          } catch {
            if (mounted) {
              setLoading(false);
            }
          }
        } else {
          if (mounted) setLoading(false);
        }
      } catch {
        if (!mounted) return;
        setLoading(false);
      }
    };

    initializeAuth();

    // Auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      setAuthSession(session);

      if (event === 'PASSWORD_RECOVERY' && session?.user) {
        setEmailVerified(!!session.user.email_confirmed_at);
        setShowAuthModal(false);
        setShowResetPasswordModal(true);
        setRecoveryEmail(session.user.email ?? (session.user.user_metadata as any)?.email ?? null);
        setLoading(false);
        toast.info('Enter a new password to finish resetting your account.');
        return;
      }

      if (event === 'SIGNED_IN' && session?.user) {
        const actuallyVerified = !!session.user.email_confirmed_at;
        setEmailVerified(actuallyVerified);
        setShowResetPasswordModal(false);
        setRecoveryEmail(null);

        const currentUrlParams = new URLSearchParams(window.location.search);
        if (session.user.email_confirmed_at && currentUrlParams.get('verified') === 'true') {
          setTimeout(() => toast.success('Email verified successfully! Welcome to HERD.'), 500);
        }
        loadUserProfile(session.user.id, 0);
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        const actuallyVerified = !!session.user.email_confirmed_at;
        setEmailVerified(actuallyVerified);
        if (!user) loadUserProfile(session.user.id, 0);
      } else if (event === 'USER_UPDATED' && session?.user) {
        const actuallyVerified = !!session.user.email_confirmed_at;
        setEmailVerified(actuallyVerified);
        setShowResetPasswordModal(false);
        setRecoveryEmail(null);
        loadUserProfile(session.user.id, 0);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setEmailVerified(true);
        setLoading(false);
        setCurrentPage('home');
        setShowResetPasswordModal(false);
        setRecoveryEmail(null);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(globalSafetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  // Handle Stripe URL params (kept as-is; refreshes profile)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const stripeParam = urlParams.get('stripe');
    if (!stripeParam || !user) return;

    const processStripeParam = () => {
      window.history.replaceState({}, document.title, window.location.pathname);

      if (stripeParam === 'connected') {
        toast.success('Stripe account connected successfully! You can now create classes.');
        if (user) {
          loadUserProfile(user.id, 0);
          setCurrentPage('profile');
        }
      } else if (stripeParam === 'error') {
        toast.error('There was an error connecting your Stripe account. Please try again.');
      } else if (stripeParam === 'refresh') {
        toast.warning('Stripe onboarding needs to be completed. Please finish the setup process.');
      }
    };

    const timeoutId = setTimeout(processStripeParam, 500);
    return () => clearTimeout(timeoutId);
  }, [user?.id]);

  useEffect(() => {
    if (currentPage !== 'dashboard') return;
    if (!dashboardLink || dashboardLink.consumed) return;

    const timer = setTimeout(() => {
      setDashboardLink((prev) => (prev ? { ...prev, consumed: true } : prev));
    }, 500);

    return () => clearTimeout(timer);
  }, [currentPage, dashboardLink]);

  useEffect(() => {
    if (currentPage === 'dashboard') return;
    if (!dashboardLink) return;
    setDashboardLink(null);
  }, [currentPage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('page') === 'dashboard') return;

    const applyPath = (path: string) => {
      const guestRoute = parseGuestDashboardPath(path);
      if (guestRoute) {
        setPendingGuestDashboardRoute(guestRoute);
        setPendingHostDashboardRoute(null);
        return;
      }

      const hostRoute = parseHostDashboardPath(path);
      if (hostRoute) {
        setPendingHostDashboardRoute(hostRoute);
        setPendingGuestDashboardRoute(null);
        return;
      }

      setPendingGuestDashboardRoute(null);
      setPendingHostDashboardRoute(null);
    };

    applyPath(window.location.pathname);

    const handlePopState = () => {
      applyPath(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!pendingGuestDashboardRoute) return;
    if (!user) {
      if (authSession === undefined || loading) {
        return;
      }
      setShowAuthModal(true);
      return;
    }

    setDashboardLink({
      tab: pendingGuestDashboardRoute.tab,
      conversationId: pendingGuestDashboardRoute.conversationId ?? null,
      consumed: false,
      role: 'guest',
    });
    setCurrentPage('dashboard');
    setPendingGuestDashboardRoute(null);
  }, [pendingGuestDashboardRoute, user?.id, authSession, loading]);

  useEffect(() => {
    if (!pendingHostDashboardRoute) return;
    if (!user) {
      if (authSession === undefined || loading) {
        return;
      }
      setShowAuthModal(true);
      return;
    }

    setDashboardLink({
      tab: pendingHostDashboardRoute.tab,
      bookingId: null,
      conversationId: null,
      guestId: null,
      guestName: null,
      classId: null,
      classTitle: null,
      consumed: false,
      role: 'host',
    });
    setCurrentPage('dashboard');
    setPendingHostDashboardRoute(null);
  }, [pendingHostDashboardRoute, user?.id, authSession, loading]);

  // Handle dashboard deep-links (kept)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const pageParam = urlParams.get('page');
    if (!pageParam || pageParam !== 'dashboard' || !user) return;

    const bookingParam = urlParams.get('booking');
    const actionParam = urlParams.get('action');
    const tabParam = urlParams.get('tab');
    const conversationParam = urlParams.get('conversation');
    const guestParam = urlParams.get('guest') ?? urlParams.get('guest_id');
    const guestNameParam = urlParams.get('guest_name');
    const classParam = urlParams.get('class') ?? urlParams.get('class_id');
    const classTitleParam = urlParams.get('class_title');
    const roleParam = urlParams.get('role');
    const normalizedRole = roleParam === 'host' ? 'host' : 'guest';

    setCurrentPage('dashboard');
    setDashboardLink({
      tab: tabParam,
      bookingId: bookingParam,
      conversationId: conversationParam,
      guestId: guestParam,
      guestName: guestNameParam,
      classId: classParam,
      classTitle: classTitleParam,
      consumed: false,
      role: normalizedRole,
    });

    window.history.replaceState({}, document.title, window.location.pathname);

    if (!bookingParam && !actionParam) {
      setTimeout(() => {
        const showWelcome = window.innerWidth < 768 || !localStorage.getItem('herd-dashboard-visited');
        if (showWelcome) {
          toast.success('Welcome to your HERD dashboard! Here you can view and manage your classes and bookings.');
          localStorage.setItem('herd-dashboard-visited', 'true');
        }
      }, 1000);
    } else if (bookingParam && actionParam && (actionParam === 'approve' || actionParam === 'decline')) {
      setTimeout(() => {
        toast.info('Host booking actions will be enabled after we add a safe RLS policy for hosts to update bookings.'); // see handleBookingAction()
      }, 500);
    }
  }, [user?.id]);

  // ===== User/profile loader (DB → UI) =====
  const loadUserProfile = async (userId: string, retryCount = 0) => {
    const maxRetries = 1;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, farm_name, bio, location, avatar_url, stripe_connected, is_admin, created_at')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        // No profile row (should be rare now that trigger/backfill exist)
        setShowOnboarding(true);
        setLoading(false);
        return null;
      }

      const uiUser = mapProfileRowToUser(data);
      setUser(uiUser);
      setLoading(false);
      return uiUser;

    } catch (error: any) {
      const msg = error?.message || 'Unknown error';
      if (retryCount < maxRetries && !/timeout|abort/i.test(msg)) {
        await new Promise(r => setTimeout(r, 1000));
        return loadUserProfile(userId, retryCount + 1);
      }

      if (authSession?.user) {
        const fallbackUser: User = {
          id: authSession.user.id,
          email: authSession.user.email || '',
          name: authSession.user.user_metadata?.name || authSession.user.email?.split('@')[0] || 'User',
          stripeConnected: false,
          createdAt: new Date().toISOString(),
        };
        setUser(fallbackUser);
        setShowOnboarding(true);
      }

      setLoading(false);
      return null;
    }
  };

  // ===== Class/Post create/delete (direct to Supabase) =====
  const handleCreateClass = async (classData: Omit<Class, 'id' | 'createdAt' | 'instructorId' | 'instructorName'>) => {
    if (!user) return;

    try {
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser?.user) {
        toast.warning('Please log in to create a class.');
        return;
      }

      const startDate = (classData.startDate ?? '').trim();
      const rawStartTime = (classData.startTime ?? '').trim();

      if (!startDate) {
        toast.warning('Please select a start date.');
        return;
      }

      if (!rawStartTime) {
        toast.warning('Please select a start time.');
        return;
      }

      const startTime =
        /^\d{2}:\d{2}(:\d{2})?$/.test(rawStartTime)
          ? rawStartTime.length === 5
            ? `${rawStartTime}:00`
            : rawStartTime
          : rawStartTime;

      const numberOfDays = Number.isFinite(classData.numberOfDays) && classData.numberOfDays > 0
        ? classData.numberOfDays
        : 1;
      const maxStudents = Number.isFinite(classData.maxStudents) && classData.maxStudents > 0
        ? classData.maxStudents
        : 1;
      const minimumAge = Number.isFinite(classData.minimumAge) && classData.minimumAge >= 0
        ? classData.minimumAge
        : 0;
      const hoursPerDay =
        classData.hoursPerDay === null
          ? null
          : resolveHoursPerDay(classData.hoursPerDay);
      const endDate =
        classData.endDate && classData.endDate.trim().length > 0
          ? classData.endDate
          : startDate;

      const pricePerPersonCents = normalizeToCents(classData.pricePerPerson);
      if (pricePerPersonCents <= 0) {
        toast.warning('Please enter a valid price for your class.');
        return;
      }

      // Map UI → DB
      const insertRow: any = {
        host_id: currentUser.user.id,
        title: classData.title,
        short_summary: classData.shortSummary,
        description: classData.shortSummary ?? '', // adjust if you collect a separate description
        start_date: startDate,
        start_time: startTime,
        end_date: endDate,
        number_of_days: numberOfDays,
        hours_per_day: hoursPerDay,
        price_per_person_cents: pricePerPersonCents,
        max_students: maxStudents,
        minimum_age: minimumAge,
        instructor_bio: classData.instructorBio,
        instructor_name: classData.instructorName ? classData.instructorName.trim() : null,
        advisories: classData.advisories,
        house_rules: classData.houseRules,
        photos: classData.photos ?? [],
        auto_approve: !!classData.auto_approve,
        address_street: classData.address?.street ?? '',
        address_city: classData.address?.city ?? '',
        address_state: classData.address?.state ?? '',
        address_zip: classData.address?.zipCode ?? '',
        address_country: classData.address?.country ?? '',
      };

      const { data, error } = await supabase
        .from('classes')
        .insert([insertRow])
        .select('*')
        .single();

      if (error) throw error;

      const saved = applyInstructorFallback(mapClassRowToUI(data), user);
      setClasses(prev => {
        const updated = [...prev, saved];
        cacheData('herd-classes', updated);
        return updated;
      });

      toast.success('Class created and posted');
      setClassFormInitialData(null);
      setClassFormMode('create');
      setCurrentPage('dashboard');
    } catch (error: any) {
      console.error('Error creating class:', error);
      toast.error('Failed to create class. Please check your info and try again.');
    }
  };

  const handleDeleteClass = async (classId: string) => {
    if (!user) return;

    const classToDelete = classes.find(c => c.id === classId);
    if (!classToDelete) {
      toast.error('Class not found.');
      return;
    }

    const isAdmin = user.isAdmin === true;
    const isHost = classToDelete.instructorId === user.id;
    if (!isAdmin && !isHost) {
      toast.error('You do not have permission to delete this class.');
      return;
    }

    if (isHost) {
      try {
        const { data: blockingBookings, error: bookingsError } = await supabase
          .from('bookings')
          .select('id, status')
          .eq('class_id', classId)
          .in('status', ['APPROVED', 'PAID']);

        if (bookingsError) throw bookingsError;

        if (blockingBookings && blockingBookings.length > 0) {
          toast.warning('You cannot delete this class while it has approved bookings.');
          return;
        }
      } catch (error: any) {
        console.error('Error checking class bookings before deletion:', error?.message || error);
        toast.error('Unable to verify bookings for this class. Please try again.');
        return;
      }
    }

    const confirmMessage = isAdmin
      ? 'Are you sure you want to delete this class? This action cannot be undone and will affect any associated bookings.'
      : 'Are you sure you want to delete this class? This action cannot be undone.';
    if (!confirm(confirmMessage)) return;

    try {
      const { error } = await supabase
        .from('classes')
        .delete()
        .eq('id', classId);

      if (error) throw error;

      setClasses(prev => {
        const updated = prev.filter(c => c.id !== classId);
        cacheData('herd-classes', updated);
        return updated;
      });

      toast.success('Class deleted successfully.');
    } catch (error: any) {
      console.error('Error deleting class:', error?.message || error);
      toast.error('Failed to delete class. Please try again.');
    }
  };

  const handleUpdateClass = async (
    classId: string,
    updates: Partial<Class>,
    options: {
      minimumMaxStudents?: number;
      hasApprovedBookings?: boolean;
      successMessage?: string;
    } = {}
  ): Promise<boolean> => {
    if (!user) return false;

    const classToUpdate = classes.find((c) => c.id === classId);
    if (!classToUpdate) {
      toast.error('Class not found.');
      return false;
    }

    const isAdmin = user.isAdmin === true;
    const isHost = classToUpdate.instructorId === user.id;

    if (!isAdmin && !isHost) {
      toast.error('You do not have permission to edit this class.');
      return false;
    }

    const updateKeys = Object.keys(updates);
    if (updateKeys.length === 0) {
      toast.info('No changes to save.');
      return false;
    }

    if (updates.maxStudents !== undefined) {
      const minCapacity = options.minimumMaxStudents ?? 0;
      if (updates.maxStudents < minCapacity) {
        toast.warning(`Class capacity cannot be lower than ${minCapacity}.`);
        return false;
      }
    }

    if (!isAdmin && options.hasApprovedBookings) {
      const allowedKeys = new Set(['maxStudents']);
      const hasDisallowed =
        updateKeys.some((key) => !allowedKeys.has(key)) ||
        updates.address !== undefined ||
        updates.photos !== undefined ||
        updates.title !== undefined ||
        updates.shortSummary !== undefined ||
        updates.startDate !== undefined ||
        updates.startTime !== undefined ||
        updates.numberOfDays !== undefined ||
        updates.hoursPerDay !== undefined ||
        updates.pricePerPerson !== undefined ||
        updates.instructorName !== undefined ||
        updates.minimumAge !== undefined ||
        updates.instructorBio !== undefined ||
        updates.advisories !== undefined ||
        updates.houseRules !== undefined ||
        updates.auto_approve !== undefined;

      if (hasDisallowed) {
        toast.warning('Once a class has approved bookings, only the maximum number of students can be updated.');
        return false;
      }
    }

    const updateRow: Record<string, any> = {};

    if (updates.title !== undefined) updateRow.title = updates.title;
    if (updates.shortSummary !== undefined) {
      updateRow.short_summary = updates.shortSummary;
      updateRow.description = updates.shortSummary;
    }
    if (updates.startDate !== undefined) updateRow.start_date = updates.startDate;
    if (updates.startTime !== undefined) updateRow.start_time = updates.startTime;
    if (updates.numberOfDays !== undefined) updateRow.number_of_days = updates.numberOfDays;
    if (updates.endDate !== undefined) updateRow.end_date = updates.endDate;
    if (updates.hoursPerDay !== undefined) updateRow.hours_per_day = updates.hoursPerDay;
    if (updates.pricePerPerson !== undefined) updateRow.price_per_person_cents = updates.pricePerPerson;
    if (updates.maxStudents !== undefined) updateRow.max_students = updates.maxStudents;
    if (updates.minimumAge !== undefined) updateRow.minimum_age = updates.minimumAge;
    if (updates.instructorBio !== undefined) updateRow.instructor_bio = updates.instructorBio;
    if (updates.instructorName !== undefined) {
      updateRow.instructor_name =
        typeof updates.instructorName === 'string' ? updates.instructorName.trim() : updates.instructorName;
    }
    if (updates.advisories !== undefined) updateRow.advisories = updates.advisories;
    if (updates.houseRules !== undefined) updateRow.house_rules = updates.houseRules;
    if (updates.photos !== undefined) updateRow.photos = updates.photos;
    if (updates.auto_approve !== undefined) updateRow.auto_approve = updates.auto_approve;
    if (updates.address) {
      if (updates.address.street !== undefined) updateRow.address_street = updates.address.street;
      if (updates.address.city !== undefined) updateRow.address_city = updates.address.city;
      if (updates.address.state !== undefined) updateRow.address_state = updates.address.state;
      if (updates.address.zipCode !== undefined) updateRow.address_zip = updates.address.zipCode;
      if (updates.address.country !== undefined) updateRow.address_country = updates.address.country;
    }

    if (Object.keys(updateRow).length === 0) {
      toast.info('No changes detected.');
      return false;
    }

    try {
      const { data, error } = await supabase
        .from('classes')
        .update(updateRow)
        .eq('id', classId)
        .select(`
          *,
          host_profile:profiles!classes_host_id_fkey(full_name, avatar_url, farm_name, bio, rating_average, rating_count)
        `)
        .single();

      if (error) throw error;

      const updatedClass = applyInstructorFallback(mapClassRowToUI(data), user);

      setClasses((prev) => {
        const updatedList = prev.map((c) => (c.id === classId ? updatedClass : c));
        cacheData('herd-classes', updatedList);
        return updatedList;
      });

      setSelectedClass((prev) => (prev && prev.id === classId ? updatedClass : prev));

      toast.success(options.successMessage ?? 'Class updated successfully.');
      return true;
    } catch (error: any) {
      console.error('Error updating class:', error?.message || error);
      toast.error('Failed to update class. Please try again.');
      return false;
    }
  };

  const handleCreatePost = async (postData: Omit<Post, 'id' | 'createdAt' | 'authorId'>) => {
    if (!user) return;

    try {
      const insertRow: any = {
        user_id: user.id,
        title: postData.title,
        content: postData.content,
        photos: postData.photos ?? [],
        category: postData.category,
      };

      const { data, error } = await supabase
        .from('posts')
        .insert([insertRow])
        .select(`
          *,
          author_profile:profiles!posts_user_id_fkey(
            id,
            full_name,
            email,
            avatar_url
          )
        `)
        .single();

      if (error) throw error;

      const saved = mapPostRowToUI(data);
      // We know author locally:
      saved.author = user.name;
      saved.authorEmail = user.email;
      saved.category = postData.category;

      setPosts(prev => {
        const updated = [saved, ...prev];
        cacheData('herd-posts', updated);
        return updated;
      });
    } catch (error: any) {
      console.error('Error creating post:', error?.message || error);
      toast.error('Failed to create post. Please try again.');
    }
  };

const handleDeletePost = async (postId: string) => {
  if (!user) return;

  try {
    const { error } = await supabase
        .from('posts')
        .delete()
        .eq('id', postId);

      if (error) throw error;

      setPosts(prev => {
        const updated = prev.filter(post => post.id !== postId);
        cacheData('herd-posts', updated);
        return updated;
      });

      if (selectedPost?.id === postId) {
        setSelectedPost(null);
        setCurrentPage('bulletin');
      }
    } catch (error: any) {
      console.error('Error deleting post:', error?.message || error);
      toast.error('Failed to delete post. Please try again.');
    }
  };

const handleUpdatePost = async (
  postId: string,
  updates: { title: string; content: string; category: string }
): Promise<boolean> => {
    if (!user) {
      setShowAuthModal(true);
      return false;
    }

    try {
      const { data, error } = await supabase
        .from('posts')
        .update({
          title: updates.title,
          content: updates.content,
          category: updates.category,
        })
        .eq('id', postId)
        .select(`
          *,
          author_profile:profiles!posts_user_id_fkey(
            id,
            full_name,
            email,
            avatar_url
          )
        `)
        .single();

      if (error) throw error;

      const updated = mapPostRowToUI(data);
      if (!updated.author) {
        updated.author = user.name;
      }
      if (!updated.authorEmail) {
        updated.authorEmail = user.email;
      }

      setPosts((prev) => {
        const next = prev.map((post) => (post.id === postId ? updated : post));
        cacheData('herd-posts', next);
        return next;
      });

      setSelectedPost((prev) => (prev && prev.id === postId ? updated : prev));
      toast.success('Bulletin updated.');
      return true;
    } catch (error: any) {
      console.error('Error updating post:', error?.message || error);
      toast.error('Failed to update bulletin. Please try again.');
      return false;
    }
  };

  const handleRelaunchClass = async (classData: Class): Promise<void> => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    if (!emailVerified) {
      toast.warning('Please verify your email address before relaunching classes.');
      return;
    }

    if (!user.stripeConnected) {
      toast.warning('Connect your Stripe account to relaunch a class.');
      setCurrentPage('profile');
      return;
    }

    const normalizedNumberOfDays =
      Number.isFinite(classData.numberOfDays) && classData.numberOfDays > 0
        ? Math.trunc(classData.numberOfDays)
        : 1;

    const instructorNameRaw = (classData.instructorName ?? '').trim();
    const fallbackInstructor = instructorNameRaw || user.name || '';
    const fallbackHostName = (classData.hostName ?? '').trim() || fallbackInstructor;

    const template: Class = {
      ...classData,
      id: '',
      startDate: '',
      endDate: '',
      startTime: '',
      numberOfDays: normalizedNumberOfDays,
      hostId: user.id,
      host_id: user.id,
      instructorId: user.id,
      instructorName: fallbackInstructor,
      hostName: fallbackHostName,
      photos: Array.isArray(classData.photos) ? [...classData.photos] : [],
      auto_approve: !!classData.auto_approve,
      address: {
        street: classData.address?.street ?? '',
        city: classData.address?.city ?? '',
        state: classData.address?.state ?? '',
        zipCode: classData.address?.zipCode ?? '',
        country: classData.address?.country ?? '',
      },
      hostProfile: null,
      createdAt: new Date().toISOString(),
    };

    setClassFormInitialData(template);
    setClassFormMode('relaunch');
    setCurrentPage('create-class');
    toast.info('Copied your class details. Pick a new future date and time, then save to relaunch.');
  };

  const toggleFavoriteClass = async (classId: string) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    const isFavorite = favoriteClassIds.includes(classId);
    try {
      if (isFavorite) {
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('user_id', user.id)
          .eq('class_id', classId);
        if (error) throw error;
        setFavoriteClassIds((prev) => prev.filter((id) => id !== classId));
        toast.success('Removed from favorites.');
      } else {
        const { error } = await supabase
          .from('favorites')
          .insert({ user_id: user.id, class_id: classId });
        if (error) throw error;
        setFavoriteClassIds((prev) => [...prev, classId]);
        toast.success('Added to favorites.');
      }
    } catch (error: any) {
      console.error('Error toggling favorite:', error?.message || error);
      toast.error('Unable to update favorites right now.');
    }
  };

  // ===== Booking host actions (TODO) =====
  // You had approve/decline via an Edge Function. To move this client-side:
  // 1) Decide allowed statuses ('PENDING', 'PAID', 'APPROVED', 'DECLINED', ...).
  // 2) Add an RLS policy allowing class hosts to update bookings for their classes, e.g.:
  //    using (exists (select 1 from classes c where c.id = bookings.class_id and c.host_id = auth.uid()))
  // 3) Then you can safely do a direct supabase.from('bookings').update({ status: ... }).eq('id', bookingId).

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    // auth listener will call loadUserProfile
  };

  const handlePasswordResetSuccess = () => {
    setShowResetPasswordModal(false);
    setRecoveryEmail(null);
    setShowAuthModal(false);
  };

  const handlePasswordResetCancel = async () => {
    setShowResetPasswordModal(false);
    setRecoveryEmail(null);
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Error ending password recovery session:', error);
    }
  };

  const handleOnboardingComplete = (userData: User) => {
    setUser(userData);
    setShowOnboarding(false);
  };

  // normalize and merge updates so stripeConnected isn't lost
  const handleProfileUpdate = (updated: any) => {
    const base = user ?? ({} as User);

    const normalized: User = {
      ...base,
      ...updated,
      profilePicture:
        updated?.profilePicture ??
        updated?.avatar_url ??
        base.profilePicture ??
        "",
      stripeConnected:
        typeof updated?.stripeConnected === "boolean"
          ? updated.stripeConnected
          : typeof updated?.stripe_connected === "boolean"
            ? !!updated.stripe_connected
            : !!base.stripeConnected,
      name: updated?.name ?? base.name,
      email: updated?.email ?? base.email,
      farmName: updated?.farmName ?? base.farmName,
      bio: updated?.bio ?? base.bio,
      location: updated?.location ?? base.location,
      createdAt: base.createdAt || new Date().toISOString(),
      id: updated?.id ?? base.id,
      isAdmin:
        typeof updated?.isAdmin === "boolean"
          ? updated.isAdmin
          : base.isAdmin,
    };

    setUser(normalized);
    try {
      localStorage.setItem("herd-user", JSON.stringify(normalized));
    } catch {}
  };


  const handleSignOut = async () => {
    try {
      try {
        localStorage.removeItem('herd-classes');
        localStorage.removeItem('herd-posts');
        localStorage.removeItem('herd-user');
        localStorage.removeItem('herd-dashboard-visited');
        localStorage.removeItem('herd-conversations');
      } catch {}

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { error } = await supabase.auth.signOut();
        if (error && !/AuthSessionMissingError|session missing/i.test(error.message)) {
          console.error('Sign out error:', error);
        }
      }

      setUser(null);
      setAuthSession(null);
      setEmailVerified(true);
      setCurrentPage('home');
      setClasses([]);
      setPosts([]);
      setDataLoaded(false);
      setShowResetPasswordModal(false);
      setRecoveryEmail(null);
      setSelectedClass(null);
      setSelectedHostId(null);
    } catch (error) {
      console.error('Unexpected error during sign out:', error);
      setUser(null);
      setAuthSession(null);
      setEmailVerified(true);
      setCurrentPage('home');
      setClasses([]);
      setPosts([]);
      setDataLoaded(false);
      setShowResetPasswordModal(false);
      setRecoveryEmail(null);
      setSelectedClass(null);
      setSelectedHostId(null);
    }
  };

  const requireAuth = (action: () => void) => {
    if (!user) {
      setShowAuthModal(true);
    } else if (!emailVerified) {
      toast.warning('Please verify your email address before continuing. Check your inbox for a verification link.');
    } else {
      action();
    }
  };

  const requireStripe = (action: () => void) => {
    if (!user) {
      setShowAuthModal(true);
    } else if (!emailVerified) {
      toast.warning('Please verify your email address before creating classes. Check your inbox for a verification link.');
    } else if (!user.stripeConnected) {
      toast.warning('You need to connect your Stripe account before creating classes. Please complete your profile setup.');
      setCurrentPage('profile');
    } else {
      action();
    }
  };

  const renderPage = () => {
    if (loading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#f8f9f6]">
          <div className="text-center max-w-md mx-auto p-6">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#556B2F] mx-auto mb-4"></div>
            <h2 className="text-[#3c4f21] mb-2">Loading HERD</h2>
            <p className="text-[#556B2F] text-sm mb-4">{loadingMessage}</p>
          </div>
        </div>
      );
    }

    switch (currentPage) {
      case 'home':
        return <HomePage onNavigate={setCurrentPage} user={user} onRequireAuth={() => setShowAuthModal(true)} />;
      case 'classes':
        return (
          <ClassListing
            classes={classes}
            onNavigate={setCurrentPage}
            user={user}
            onRequireAuth={() => setShowAuthModal(true)}
            onSelectClass={(classData) => {
              setSelectedClass(classData);
              setSelectedHostId(classData.instructorId ?? null);
              setCurrentPage('class-detail');
            }}
            favorites={favoriteClassIds}
            onToggleFavorite={toggleFavoriteClass}
          />
        );
      case 'class-detail':
        return selectedClass ? (
          <ClassDetail
            classData={selectedClass}
            user={user}
            onNavigate={setCurrentPage}
            onRequireAuth={() => setShowAuthModal(true)}
            onViewHost={(hostId, classInfo) => {
              setSelectedHostId(hostId);
              setSelectedClass(classInfo);
              setCurrentPage('host-profile');
            }}
            favorites={favoriteClassIds}
            onToggleFavorite={toggleFavoriteClass}
            onOpenConversation={(conversationId, classInfo) => {
              setDashboardLink({
                tab: 'messages',
                conversationId,
                guestId: user?.id ?? null,
                guestName: user?.name ?? null,
                classId: classInfo.id,
                classTitle: classInfo.title,
                bookingId: null,
                consumed: false,
                role: 'guest',
              });
              setCurrentPage('dashboard');
            }}
          />
        ) : null;
      case 'host-profile':
        return selectedHostId ? (
          <HostProfilePage
            hostId={selectedHostId}
            currentUser={user}
            onNavigate={setCurrentPage}
            onSelectClass={(classData) => {
              setSelectedClass(classData);
              setSelectedHostId(classData.instructorId ?? null);
              setCurrentPage('class-detail');
            }}
          />
        ) : (
          <HomePage onNavigate={setCurrentPage} user={user} onRequireAuth={() => setShowAuthModal(true)} />
        );
      case 'create-class': {
        if (!user) {
          setShowAuthModal(true);
          setClassFormInitialData(null);
          setClassFormMode('create');
          setCurrentPage('home');
          return null;
        }

        if (!emailVerified) {
          toast.warning('Please verify your email address before creating classes. Check your inbox for a verification link.');
          setClassFormInitialData(null);
          setClassFormMode('create');
          setCurrentPage('home');
          return null;
        }

        if (!user.stripeConnected) {
          toast.warning('You need to connect your Stripe account before creating classes. Please complete your profile setup.');
          setClassFormInitialData(null);
          setClassFormMode('create');
          setCurrentPage('profile');
          return null;
        }

        const handleCreateCancel = () => {
          setClassFormInitialData(null);
          if (classFormMode === 'relaunch') {
            setClassFormMode('create');
            setCurrentPage('dashboard');
          } else {
            setCurrentPage('classes');
          }
        };

        return (
          <ClassForm
            onSubmit={handleCreateClass}
            onCancel={handleCreateCancel}
            user={user}
            initialData={classFormInitialData}
            mode={classFormMode === 'relaunch' ? 'relaunch' : 'create'}
          />
        );
      }
      case 'edit-class':
        return user && selectedClass ? (
          <ClassForm
            onSubmit={handleSubmitEditedClass}
            onCancel={() => setCurrentPage('manage-class')}
            user={user}
            initialData={{ ...selectedClass }}
            mode="edit"
          />
        ) : null;
      case 'bulletin':
        return (
          <BulletinBoard
            posts={posts}
            onCreatePost={handleCreatePost}
            onDeletePost={handleDeletePost}
            onSelectPost={(post) => {
              setSelectedPost(post);
              setCurrentPage('bulletin-detail');
            }}
            user={user}
            onRequireAuth={() => setShowAuthModal(true)}
          />
        );
      case 'bulletin-detail':
        return selectedPost ? (
          <BulletinDetail
            post={selectedPost}
            user={user}
            onBack={() => setCurrentPage('bulletin')}
            onDeletePost={(postId) => handleDeletePost(postId)}
            onRequireAuth={() => setShowAuthModal(true)}
            onUpdatePost={handleUpdatePost}
          />
        ) : (
          <BulletinBoard
            posts={posts}
            onCreatePost={handleCreatePost}
            onDeletePost={handleDeletePost}
            onSelectPost={(post) => {
              setSelectedPost(post);
              setCurrentPage('bulletin-detail');
            }}
            user={user}
            onRequireAuth={() => setShowAuthModal(true)}
          />
        );
      case 'profile':
        return user ? (
          // NOTE: simplified props to match your lean ProfilePage
          <ProfilePage user={user} onUpdate={handleProfileUpdate} />
        ) : null;
      case 'dashboard':
        return user ? (
          <Dashboard
            user={user}
            classes={classes}
            posts={posts}
            onNavigate={setCurrentPage}
            onDeleteClass={handleDeleteClass}
            onManageClass={(classData) => {
              setSelectedClass(classData);
              setSelectedHostId(classData.instructorId ?? null);
              setCurrentPage('manage-class');
            }}
            onSelectClass={(classData) => {
              setSelectedClass(classData);
              setSelectedHostId(classData.instructorId ?? null);
              setCurrentPage('class-detail');
            }}
            initialTab={!dashboardLink?.consumed ? dashboardLink?.tab ?? null : null}
            initialConversationId={!dashboardLink?.consumed ? dashboardLink?.conversationId ?? null : null}
            initialMode={!dashboardLink?.consumed ? (dashboardLink?.role === 'host' ? 'host' : dashboardLink?.role === 'guest' ? 'guest' : null) : null}
            favorites={favoriteClassIds}
            onToggleFavorite={toggleFavoriteClass}
            onRelaunchClass={handleRelaunchClass}
            onDeletePost={handleDeletePost}
            onSelectPost={(post) => {
              setSelectedPost(post);
              setCurrentPage('bulletin-detail');
            }}
            hostMessageTarget={
              user.stripeConnected && dashboardLink?.role === 'host'
                ? {
                    conversationId: dashboardLink?.conversationId ?? null,
                    guestId: dashboardLink?.guestId ?? null,
                    guestName: dashboardLink?.guestName ?? null,
                    classId: dashboardLink?.classId ?? null,
                    classTitle: dashboardLink?.classTitle ?? null,
                    bookingId: dashboardLink?.bookingId ?? null,
                  }
                : null
            }
          />
        ) : null;
      case 'manage-class':
        return user && selectedClass ? (
          <ClassManagement
            classData={selectedClass}
            user={user}
            onNavigate={setCurrentPage}
            onDeleteClass={handleDeleteClass}
            onEditClass={(classData) => {
              setSelectedClass(classData);
              setSelectedHostId(classData.instructorId ?? null);
              setCurrentPage('edit-class');
            }}
            onUpdateClass={handleUpdateClass}
          />
        ) : null;
      default:
        return <HomePage onNavigate={setCurrentPage} user={user} onRequireAuth={() => setShowAuthModal(true)} />;
    }
  };

  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (pathname.startsWith('/classes/checkout/success')) {
    return (
      <Suspense fallback={<CheckoutRouteFallback message="Preparing your confirmation..." />}>
        <CheckoutSuccessPage />
      </Suspense>
    );
  }

  if (pathname.startsWith('/classes/checkout/cancel')) {
    return (
      <Suspense fallback={<CheckoutRouteFallback message="Loading checkout status..." />}>
        <CheckoutCancelPage />
      </Suspense>
    );
  }

  if (pathname.startsWith('/review')) {
    return (
      <div className="min-h-screen bg-[#f8f9f6]">
        <ReviewHost />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9f6]">
      <Navigation
        currentPage={currentPage}
        onNavigate={(page) => {
          if (page === 'create-class') {
            requireStripe(() => {
              setClassFormInitialData(null);
              setClassFormMode('create');
              setCurrentPage(page);
            });
          } else if (page === 'profile' || page === 'dashboard') {
            requireAuth(() => setCurrentPage(page));
          } else {
            setCurrentPage(page);
          }
        }}
        user={user}
        onSignOut={handleSignOut}
        onShowAuth={() => setShowAuthModal(true)}
      />

      {/* Email Verification Banner */}
      {user && !emailVerified && <EmailVerificationBanner userEmail={authSession?.user?.email} />}

      {renderPage()}

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} onSuccess={handleAuthSuccess} />
      )}

      {showResetPasswordModal && (
        <ResetPasswordModal
          email={recoveryEmail}
          onClose={handlePasswordResetCancel}
          onSuccess={handlePasswordResetSuccess}
        />
      )}

      {showOnboarding && authSession && emailVerified && (
        <OnboardingModal onComplete={handleOnboardingComplete} authSession={authSession} />
      )}

      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
