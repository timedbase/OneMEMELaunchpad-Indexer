/**
 * Fixed-window rate limiter for the OneMEME Launchpad REST API.
 *
 * Each call to `rateLimit()` creates an ISOLATED store, so different route
 * groups (quotes, stats, lists) maintain completely separate counters.
 *
 * Within each store the key is the CLIENT IP ONLY — not IP+path.
 * This means all requests from the same IP to any endpoint covered by a
 * given middleware instance count against a shared bucket. A user cannot
 * bypass the quote limit by rotating through different token addresses.
 *
 * IP resolution order (first non-empty wins):
 *   1. X-Real-IP      — set by nginx `proxy_set_header X-Real-IP $remote_addr`
 *   2. X-Forwarded-For first entry — set by most CDNs / load balancers
 *   3. Raw socket remote address
 *   4. "unknown"      — fallback; still counted, not silently allowed
 *
 * Rate-limit headers on every response:
 *   X-RateLimit-Limit      Max requests allowed in the current window
 *   X-RateLimit-Remaining  Remaining requests in the current window
 *   X-RateLimit-Reset      Unix timestamp (seconds) when the window resets
 *   Retry-After            Only on 429 — seconds until the window resets
 *
 * Production note:
 *   This implementation is single-process. For horizontally scaled deployments
 *   replace the in-memory Map with a Redis-backed sliding-window counter so
 *   state is shared across all instances.
 */

import type { Context, MiddlewareHandler } from "hono";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WindowEntry {
  count:   number;
  resetAt: number; // Unix ms
}

// ─── IP extraction ────────────────────────────────────────────────────────────

/**
 * Extracts the real client IP from the request, honouring common
 * reverse-proxy headers. Returns "unknown" when no IP can be determined
 * (still counted so "unknown" clients cannot bypass limits).
 */
function clientIp(c: Context): string {
  const xRealIp       = c.req.header("x-real-ip");
  const xForwardedFor = c.req.header("x-forwarded-for");

  if (xRealIp)       return xRealIp.trim();
  if (xForwardedFor) return xForwardedFor.split(",")[0].trim();
  return "unknown";
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a fixed-window rate-limiter middleware with its own isolated store.
 *
 * Counter key = client IP address only.
 * All requests from the same IP to ANY endpoint guarded by this middleware
 * instance share a single counter — rotating through different URLs or token
 * addresses does not reset or bypass the limit.
 *
 * @param max       Maximum requests allowed within `windowMs`.
 * @param windowMs  Window length in ms (default 60 000 = 1 minute).
 *
 * @example
 *   // Quote endpoints: 20 total calls per IP per minute regardless of token
 *   v1.use("/tokens/*/quote/*", rateLimit(20));
 *
 *   // Stats: 10 calls per IP per minute
 *   v1.use("/stats", rateLimit(10));
 */
export function rateLimit(max: number, windowMs = 60_000): MiddlewareHandler {
  // Each invocation of rateLimit() owns its own isolated Map.
  // Buckets from different rate limiters never interfere with each other.
  const store = new Map<string, WindowEntry>();

  // Purge expired entries every 5 minutes to prevent unbounded memory growth.
  // .unref() ensures the timer does not keep the Node.js process alive.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store) {
      if (entry.resetAt < now) store.delete(ip);
    }
  }, 5 * 60_000).unref();

  return async (c, next) => {
    // Key = client IP only. Every request from this IP hits the same bucket,
    // regardless of which path within the guarded route group is called.
    const ip  = clientIp(c);
    const now = Date.now();

    let entry = store.get(ip);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(ip, entry);
    }

    entry.count++;

    const remaining = Math.max(0, max - entry.count);
    const resetSec  = Math.ceil(entry.resetAt / 1_000);

    // Attach headers on every response so clients can implement back-off.
    c.header("X-RateLimit-Limit",     String(max));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset",     String(resetSec));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1_000);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        {
          error:       "Too Many Requests",
          message:     `Rate limit of ${max} req/min exceeded for your IP. Retry in ${retryAfter}s.`,
          retryAfter,
          ip,          // echo the IP so users behind proxies can confirm resolution
        },
        429
      );
    }

    await next();
  };
}

// ─── Preset instances (each has its own isolated store) ───────────────────────

/** 20 req/min — quote endpoints; each triggers a live RPC call to BSC. */
export const limitQuote = rateLimit(20);

/** 10 req/min — platform stats; executes 6 parallel aggregation queries. */
export const limitStats = rateLimit(10);

/** 120 req/min — lightweight single-item detail / primary-key lookups. */
export const limitDetail = rateLimit(120);

/** 60 req/min — paginated list endpoints (default bucket). */
export const limitList = rateLimit(60);
