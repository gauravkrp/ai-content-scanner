// ============================================================
// Vercel Edge Middleware — Rate Limiting for /api/* routes
// 30 requests per 60-second window per IP (in-memory)
// ============================================================

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

/** @type {Map<string, { count: number, resetAt: number }>} */
const hits = new Map();

export const config = {
  matcher: "/api/:path*",
};

export default function middleware(request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const now = Date.now();
  let entry = hits.get(ip);

  if (entry && now > entry.resetAt) {
    hits.delete(ip);
    entry = null;
  }

  if (!entry) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    hits.set(ip, entry);
  }

  entry.count++;

  // Prune expired entries when map grows large
  if (hits.size > 10_000) {
    for (const [key, val] of hits) {
      if (now > val.resetAt) hits.delete(key);
    }
  }

  if (entry.count > MAX_REQUESTS) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Try again in " + Math.ceil((entry.resetAt - now) / 1000) + " seconds.",
        },
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)),
          "X-RateLimit-Limit": String(MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  // Continue to the serverless function
  return undefined;
}
