export function requireInternal(req: Request, headers: HeadersInit = {}): Response | null {
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  const serviceRole = Deno.env.get("HERD_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "";
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const apiKey = req.headers.get("apikey") ?? "";

  const cronOk = expected && provided && provided === expected;
  const serviceOk = serviceRole && (bearerToken === serviceRole || apiKey === serviceRole);

  if (!cronOk && !serviceOk) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  return null;
}
