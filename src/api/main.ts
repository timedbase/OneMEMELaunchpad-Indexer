/**
 * OneMEME Launchpad — NestJS API Server
 *
 * Runs plain HTTP on API_PORT (default 3001).
 * TLS is handled externally by Cloudflare — see CLOUDFLARE.md.
 *
 * Run:
 *   npm run api:dev   (ts-node, watch mode)
 *   npm run api:build && npm run api  (compiled production)
 */

import "reflect-metadata";
import { config } from "dotenv";
config();

import { NestFactory } from "@nestjs/core";
import { WsAdapter }   from "@nestjs/platform-ws";
import { AppModule }   from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "warn", "error"],
  });

  // ── WebSocket adapter ──────────────────────────────────────────────────────
  app.useWebSocketAdapter(new WsAdapter(app));

  // ── Global route prefix ────────────────────────────────────────────────────
  app.setGlobalPrefix("api/v1", { exclude: ["/health"] });

  // ── CORS ───────────────────────────────────────────────────────────────────
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const isDev = (process.env.NODE_ENV ?? "development") === "development";

  function isLocalhost(origin: string): boolean {
    try {
      const { hostname } = new URL(origin);
      return hostname === "localhost" || hostname === "127.0.0.1";
    } catch { return false; }
  }

  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      if (!origin || allowedOrigins.has(origin) || (isDev && isLocalhost(origin))) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed by CORS"), false);
      }
    },
    methods:        ["GET", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    exposedHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
  });

  // ── Listen ─────────────────────────────────────────────────────────────────
  const port = parseInt(process.env.API_PORT ?? "3001", 10);

  await app.listen(port);

  console.log(`
  OneMEME Launchpad API  (NestJS)
  ─────────────────────────────────────────────────
  Listening   : http://localhost:${port}
  Route index : http://localhost:${port}/api/v1
  Health      : http://localhost:${port}/health
  Activity WS : ws://localhost:${port}/api/v1/activity/ws
  Chat WS     : ws://localhost:${port}/api/v1/chat/ws

  Rate limits (per IP / per minute):
    /quote/*  → 20   (live BSC RPC)
    /stats    → 10   (aggregation)
    default   → 60
  ─────────────────────────────────────────────────
`);
}

bootstrap().catch(console.error);
