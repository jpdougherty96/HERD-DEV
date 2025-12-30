import type { User } from "https://esm.sh/@supabase/supabase-js@2";
import { createAuthClient } from "./supabase.ts";

export type AuthResult = { user: User; token: string } | { error: string };

export function getBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function requireAuth(req: Request): Promise<AuthResult> {
  const token = getBearerToken(req);
  if (!token) {
    return { error: "Missing Authorization token" };
  }

  const supabase = createAuthClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return { error: "Invalid or expired token" };
  }

  return { user: data.user, token };
}
