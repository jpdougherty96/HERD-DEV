export type Page =
  | "home"
  | "classes"
  | "class-detail"
  | "host-profile"
  | "create-class"
  | "bulletin"
  | "bulletin-detail"
  | "profile"
  | "dashboard"
  | "edit-class"
  | "manage-class";

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
  instructorName: string; // backed by classes.instructor_name, falls back to host profile name
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
  author: string; // we can hydrate from profiles later (now: local user.name or blank)
  authorId: string;
  authorEmail?: string | null;
  createdAt: string;
  category: string;
  photos?: string[];
};

export type GuestDashboardTab =
  | "overview"
  | "bookings"
  | "favorites"
  | "bulletins"
  | "messages";

export type GuestDashboardDeepLink = {
  tab: GuestDashboardTab;
  conversationId?: string | null;
};

export type HostDashboardDeepLink = {
  tab: "overview" | "classes" | "bookings" | "messages";
};
