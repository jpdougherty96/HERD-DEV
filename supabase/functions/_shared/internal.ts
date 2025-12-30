export function requireInternal(req: Request, headers: HeadersInit = {}): Response | null {
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";

  if (!expected || !provided || provided !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  return null;
}
