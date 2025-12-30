const ALLOWED_HEADERS = "Authorization, Content-Type, apikey, x-client-info";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function getAllowedOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

export function corsHeaders(req: Request, methods = "GET, POST, OPTIONS"): Record<string, string> {
  const allowOrigin = getAllowedOrigin(req);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Vary": "Origin",
  };

  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }

  return headers;
}

export function handleCors(req: Request, methods = "GET, POST, OPTIONS"): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response("ok", { status: 200, headers: corsHeaders(req, methods) });
}
