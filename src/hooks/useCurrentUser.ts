import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/utils/supabaseClient";
import type { User } from "@/types/domain";

const mapProfileRowToUser = (row: any): User => ({
  id: row.id,
  email: row.email ?? "",
  name: row.full_name || (row.email ? row.email.split("@")[0] : "User"),
  farmName: row.farm_name ?? "",
  bio: row.bio ?? "",
  profilePicture: row.avatar_url ?? "",
  location: row.location ?? "",
  stripeConnected: !!row.stripe_connected,
  isAdmin: !!row.is_admin,
  createdAt: row.created_at ?? new Date().toISOString(),
});

export function useCurrentUser() {
  const [user, setUser] = useState<User | null>(null);
  const [authSession, setAuthSession] = useState<any | undefined>(undefined);
  const [emailVerified, setEmailVerified] = useState(true);
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadUserProfile = useCallback(async (userId: string, retryCount = 0) => {
    const maxRetries = 1;

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, email, full_name, farm_name, bio, location, avatar_url, stripe_connected, is_admin, created_at",
        )
        .eq("id", userId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setLoading(false);
        return null;
      }

      const uiUser = mapProfileRowToUser(data);
      setUser(uiUser);
      setLoading(false);
      return uiUser;
    } catch (error: any) {
      const msg = error?.message || "Unknown error";
      if (retryCount < maxRetries && !/timeout|abort/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 1000));
        return loadUserProfile(userId, retryCount + 1);
      }

      if (authSession?.user) {
        const fallbackUser: User = {
          id: authSession.user.id,
          email: authSession.user.email || "",
          name:
            authSession.user.user_metadata?.name ||
            authSession.user.email?.split("@")[0] ||
            "User",
          stripeConnected: false,
          createdAt: new Date().toISOString(),
        };
        setUser(fallbackUser);
      }

      setLoading(false);
      return null;
    }
  }, [authSession?.user]);

  useEffect(() => {
    let mounted = true;

    const globalSafetyTimeout = setTimeout(() => {
      if (mounted && loading) {
        setLoading(false);
      }
    }, 15000);

    const initializeAuth = async () => {
      try {
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error("Session check timeout")), 2000),
        );

        const {
          data: { session },
        } = (await Promise.race([sessionPromise, timeoutPromise])) as any;
        if (!mounted) return;

        setAuthSession(session);

        if (session?.user) {
          const actuallyVerified = !!session.user.email_confirmed_at;
          setEmailVerified(actuallyVerified);

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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      setAuthSession(session);

      if (event === "PASSWORD_RECOVERY" && session?.user) {
        setEmailVerified(!!session.user.email_confirmed_at);
        setShowResetPasswordModal(true);
        setRecoveryEmail(
          session.user.email ?? (session.user.user_metadata as any)?.email ?? null,
        );
        setLoading(false);
        return;
      }

      if (event === "SIGNED_IN" && session?.user) {
        const actuallyVerified = !!session.user.email_confirmed_at;
        setEmailVerified(actuallyVerified);
        setShowResetPasswordModal(false);
        setRecoveryEmail(null);
        loadUserProfile(session.user.id, 0);
      } else if (event === "TOKEN_REFRESHED" && session?.user) {
        const actuallyVerified = !!session.user.email_confirmed_at;
        setEmailVerified(actuallyVerified);
        if (!user) loadUserProfile(session.user.id, 0);
      } else if (event === "USER_UPDATED" && session?.user) {
        const actuallyVerified = !!session.user.email_confirmed_at;
        setEmailVerified(actuallyVerified);
        setShowResetPasswordModal(false);
        setRecoveryEmail(null);
        loadUserProfile(session.user.id, 0);
      } else if (event === "SIGNED_OUT") {
        setUser(null);
        setEmailVerified(true);
        setLoading(false);
        setShowResetPasswordModal(false);
        setRecoveryEmail(null);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(globalSafetyTimeout);
      subscription.unsubscribe();
    };
  }, [loadUserProfile, loading]);

  return {
    user,
    setUser,
    authSession,
    setAuthSession,
    emailVerified,
    setEmailVerified,
    recoveryEmail,
    setRecoveryEmail,
    showResetPasswordModal,
    setShowResetPasswordModal,
    loading,
    setLoading,
    loadUserProfile,
  };
}
