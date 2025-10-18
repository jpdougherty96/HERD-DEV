import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase/client";

// Match your DB schema
export type Profile = {
  id: string;
  full_name: string;
  email?: string;
  farm_name?: string;
  bio?: string;
  location?: string;
  avatar_url?: string;        // file path in DB
  avatar_signed_url?: string; // signed URL for display
  stripe_connected?: boolean;
};

export function useProfile(userId: string | null) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Helper to fetch profile from DB + signed URL
  const fetchProfile = async () => {
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error || !data) {
      console.error("Error fetching profile:", error);
      setProfile(null);
      setLoading(false);
      return;
    }

    let avatar_signed_url = "";
    if (data.avatar_url) {
      const { data: signed, error: signedError } = await supabase.storage
        .from("avatars")
        .createSignedUrl(data.avatar_url, 60 * 60 * 24 * 7); // valid for 7 days
      if (signedError) {
        console.error("Error creating signed URL:", signedError);
      }
      avatar_signed_url = signed?.signedUrl ?? "";
    }

    setProfile({ ...data, avatar_signed_url });
    setLoading(false);
  };

  // Fetch profile on mount or when userId changes
  useEffect(() => {
    fetchProfile();

    // Set up auto-refresh for signed URL (every 24h)
    const interval = setInterval(() => {
      fetchProfile();
    }, 24 * 60 * 60 * 1000); // 24 hours

    return () => clearInterval(interval);
  }, [userId]);

  return { profile, loading, refresh: fetchProfile };
}
