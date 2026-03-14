/**
 * Origin guard — restricts endpoints to requests from configured launchpad UI domains.
 *
 * Apply with @UseGuards(OriginGuard) on any controller or route handler.
 *
 * Configuration (.env):
 *   ALLOWED_ORIGINS=https://onememe.io,https://app.onememe.io
 *
 * Development: localhost origins of any port are automatically permitted.
 * Non-browser clients (no Origin header): blocked unless "server" is in ALLOWED_ORIGINS.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { IncomingMessage } from "node:http";

// ─── Allowlist (built once at module load) ────────────────────────────────────

function buildAllowlist(): Set<string> {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/\/$/, ""))
      .filter(Boolean)
  );
}

const allowlist = buildAllowlist();
const isDev     = (process.env.NODE_ENV ?? "development") === "development";

// ─── Origin extraction ────────────────────────────────────────────────────────

function requestOrigin(req: IncomingMessage): string | null {
  const origin = req.headers["origin"];
  if (origin) return (Array.isArray(origin) ? origin[0] : origin).toLowerCase().replace(/\/$/, "");

  const referer = req.headers["referer"];
  if (referer) {
    try {
      const u = new URL(Array.isArray(referer) ? referer[0] : referer);
      return `${u.protocol}//${u.host}`.toLowerCase();
    } catch { /* malformed */ }
  }

  return null;
}

// ─── Guard ────────────────────────────────────────────────────────────────────

@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req    = context.switchToHttp().getRequest<IncomingMessage>();
    const origin = requestOrigin(req);

    // Development: all localhost origins pass automatically.
    if (isDev && origin && (
      origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1")
    )) {
      return true;
    }

    // No Origin header — allow only if "server" is in the allowlist.
    if (!origin) {
      if (allowlist.has("server")) return true;
      throw new ForbiddenException("This endpoint is restricted to the OneMEME Launchpad UI.");
    }

    if (!allowlist.has(origin)) {
      throw new ForbiddenException(`Origin not permitted: ${origin}`);
    }

    return true;
  }
}
