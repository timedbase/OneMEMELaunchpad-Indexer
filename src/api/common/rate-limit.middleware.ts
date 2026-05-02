/**
 * Fixed-window rate limiter for the OneMEME Launchpad REST API.
 *
 * Each call to createRateLimitMiddleware() produces a NestJS middleware class
 * with its own ISOLATED in-memory store.  Different route groups (quotes,
 * stats, lists) maintain completely separate counters.
 *
 * Key = client IP only (not IP+path).  All requests from the same IP to any
 * endpoint covered by a given middleware instance share one counter — rotating
 * token addresses does not bypass the limit.
 *
 * IP resolution order (first non-empty wins):
 *   1. X-Real-IP      set by nginx proxy_set_header X-Real-IP $remote_addr
 *   2. X-Forwarded-For first entry
 *   3. socket.remoteAddress
 *   4. "unknown"      still counted
 */

import { Injectable, NestMiddleware } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { clientIp } from "./client-ip";

interface WindowEntry {
  count:   number;
  resetAt: number; // Unix ms
}

export function createRateLimitMiddleware(max: number, windowMs = 60_000) {
  @Injectable()
  class RateLimitMiddleware implements NestMiddleware {
    private readonly store = new Map<string, WindowEntry>();

    constructor() {
      // Purge expired entries every 5 min to prevent unbounded memory growth.
      setInterval(() => {
        const now = Date.now();
        for (const [ip, entry] of this.store) {
          if (entry.resetAt < now) this.store.delete(ip);
        }
      }, 5 * 60_000).unref();
    }

    use(req: IncomingMessage, res: ServerResponse, next: () => void): void {
      const ip  = clientIp(req);
      const now = Date.now();

      let entry = this.store.get(ip);
      if (!entry || entry.resetAt < now) {
        entry = { count: 0, resetAt: now + windowMs };
        this.store.set(ip, entry);
      }

      entry.count++;

      const remaining = Math.max(0, max - entry.count);
      const resetSec  = Math.ceil(entry.resetAt / 1_000);

      res.setHeader("X-RateLimit-Limit",     String(max));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      // X-RateLimit-Reset is a Unix timestamp in seconds when the window resets.
      res.setHeader("X-RateLimit-Reset",     String(resetSec));

      if (entry.count > max) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1_000);
        res.setHeader("Retry-After", String(retryAfter));
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error:       "Too Many Requests",
            message:     `Rate limit of ${max} req/min exceeded. Retry in ${retryAfter}s.`,
            retryAfter,
          })
        );
        return;
      }

      next();
    }
  }

  return RateLimitMiddleware;
}

// ─── Preset instances (each has its own isolated store) ───────────────────────

/** 20 req/min — quote endpoints; each triggers a live RPC call to BSC. */
export const QuoteRateLimitMiddleware = createRateLimitMiddleware(20);

/** 10 req/min — platform stats; executes 6 parallel aggregation queries. */
export const StatsRateLimitMiddleware = createRateLimitMiddleware(10);

/** 60 req/min — default for paginated lists, detail lookups, etc. */
export const ListRateLimitMiddleware  = createRateLimitMiddleware(60);

/** 10 req/min — POST endpoints (referral registration, etc.). */
export const PostRateLimitMiddleware  = createRateLimitMiddleware(10);
