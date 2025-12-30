import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function requireEnv(name: string, value: string): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function createAdminClient() {
  const url = requireEnv("SUPABASE_URL", SUPABASE_URL);
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
  return createClient(url, key, { auth: { persistSession: false } });
}

export function createAuthClient() {
  const url = requireEnv("SUPABASE_URL", SUPABASE_URL);
  const key = requireEnv("SUPABASE_ANON_KEY", SUPABASE_ANON_KEY);
  return createClient(url, key, { auth: { persistSession: false } });
}

export function createUserClient(accessToken: string) {
  const url = requireEnv("SUPABASE_URL", SUPABASE_URL);
  const key = requireEnv("SUPABASE_ANON_KEY", SUPABASE_ANON_KEY);
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
