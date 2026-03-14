/**
 * Origin guard middleware — restricts endpoints to requests originating
 * from the configured launchpad UI domains.
 *
 * How it works:
 *   Browsers always send the `Origin` header on cross-origin requests.
 *   The middleware checks that header (falling back to `Referer`) against
 *   the ALLOWED_ORIGINS env var. If the origin is not in the allowlist,
 *   the request is rejected with 403.
 *
 * Configuration (.env):
 *   ALLOWED_ORIGINS=https://onememe.io,https://app.onememe.io
 *
 *   In development (NODE_ENV=development), localhost origins of any port
 *   are automatically permitted so the frontend dev server works without
 *   env changes.
 *
 * Non-browser clients (curl, Postman, server-to-server):
 *   These do not send an Origin header. They are blocked unless the
 *   ALLOWED_ORIGINS list explicitly includes "server" as a value, which
 *   can be useful for internal backend-to-backend calls.
 *
 * Usage:
 *   import { originGuard } from "../middleware/originGuard";
 *
 *   // Applied to a single route group:
 *   v1.use("/discover/*", originGuard);
 *   v1.use("/activity/*", originGuard);
 *
 *   // Applied to a single route:
 *   v1.use("/stats", originGuard);
 */

import type { MiddlewareHandler } from "hono";

// ─── Allowlist ────────────────────────────────────────────────────────────────

/**
 * Parses the ALLOWED_ORIGINS env var into a Set of lowercase origin strings.
 * Called once at module load so repeated requests pay no parsing cost.
 */
function buildAllowlist(): Set<string> {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  const entries = raw
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/\/$/, "")) // strip trailing slash
    .filter(Boolean);
  return new Set(entries);
}

const allowlist = buildAllowlist();

const isDev = (process.env.NODE_ENV ?? "development") === "development";

// ─── Origin extraction ────────────────────────────────────────────────────────

/**
 * Returns the request origin from the `Origin` header, falling back to the
 * host portion of the `Referer` header. Returns null if neither is present.
 */
function requestOrigin(req: Request): string | null {
  // Standard cross-origin header set by all modern browsers.
  const origin = req.headers.get("origin");
  if (origin) return origin.toLowerCase().replace(/\/$/, "");

  // Fallback: extract origin from Referer (same-origin requests in some browsers).
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const u = new URL(referer);
      return `${u.protocol}//${u.host}`.toLowerCase();
    } catch {
      // malformed Referer — ignore
    }
  }

  return null;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export const originGuard: MiddlewareHandler = async (c, next) => {
  const origin = requestOrigin(c.req.raw);

  // Development: permit all localhost origins automatically.
  if (isDev && origin && (
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1")
  )) {
    return next();
  }

  // No Origin header — block unless allowlist contains the special "server" entry
  // (useful for internal server-to-server calls where no browser is involved).
  if (!origin) {
    if (allowlist.has("server")) return next();
    return c.json(
      {
        error:   "Forbidden",
        message: "This endpoint is restricted to the OneMEME Launchpad UI.",
      },
      403
    );
  }

  if (!allowlist.has(origin)) {
    return c.json(
      {
        error:   "Forbidden",
        message: "Origin not permitted.",
        origin,
      },
      403
    );
  }

  return next();
};
