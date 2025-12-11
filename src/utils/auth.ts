import { supabase } from "@/utils/supabaseClient";

/**
 * After a successful sign-in, ensure the user's profile row has
 * full_name/email populated. This is safe with your RLS because
 * users can update their own profile.
 */
export async function ensureProfilePatched(opts: {
  fullName?: string;
  email?: string;
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return;
  }

  const patch: Record<string, string> = {};
  if (opts.fullName && (!profile.full_name || profile.full_name.trim() === "")) {
    patch.full_name = opts.fullName;
  }
  if (opts.email && (!profile.email || profile.email.trim() === "")) {
    patch.email = opts.email;
  }

  if (Object.keys(patch).length > 0) {
    await supabase.from("profiles").update(patch).eq("id", user.id);
  }
}

export function formatAuthError(error: any) {
  const msg = String(error?.message ?? "");
  if (
    msg.includes("Invalid login credentials") ||
    msg.includes("Invalid email or password")
  ) {
    return "Email or password is incorrect. Please try again.";
  }
  if (msg.includes("Email not CONFIRMED")) {
    return "Please verify your email address before signing in. Check your inbox for a verification link.";
  }
  if (msg.includes("Too many requests")) {
    return "Too many sign-in attempts. Please wait a few minutes and try again.";
  }
  if (msg.includes("Invalid email")) {
    return "Please enter a valid email address.";
  }
  if (msg.includes("already registered")) {
    return "An account with this email already exists. Please sign in instead.";
  }
  return `${msg || "Unknown error"}. Please try again or contact support.`;
}
