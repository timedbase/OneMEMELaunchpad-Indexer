/**
 * Resolves the real client IP from an HTTP request.
 *
 * Only reads proxy headers when TRUST_PROXY=true is set, preventing IP
 * spoofing when the API is reached directly (dev / staging without a proxy).
 *
 * Priority (when trusted):
 *   1. X-Real-IP      — set by nginx: proxy_set_header X-Real-IP $remote_addr
 *   2. X-Forwarded-For first entry
 *   3. socket.remoteAddress
 */
import type { IncomingMessage } from "node:http";

const TRUST_PROXY = process.env.TRUST_PROXY === "true";

export function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const xri = req.headers["x-real-ip"];
    if (xri) return (Array.isArray(xri) ? xri[0] : xri).trim();

    const xff = req.headers["x-forwarded-for"];
    if (xff) return (Array.isArray(xff) ? xff[0] : xff).split(",")[0]!.trim();
  }

  return (req.socket as { remoteAddress?: string }).remoteAddress ?? "unknown";
}
