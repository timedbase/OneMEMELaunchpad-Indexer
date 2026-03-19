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

import compression      from "compression";
import { NestFactory }  from "@nestjs/core";
import { WsAdapter }    from "@nestjs/platform-ws";
import { AppModule }    from "./app.module";
import { AppLogger }    from "./logger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: AppLogger,
  });

  // ── Compression ────────────────────────────────────────────────────────────
  app.use(compression());

  // ── WebSocket adapter ──────────────────────────────────────────────────────
  app.useWebSocketAdapter(new WsAdapter(app));

  // ── Global route prefix ────────────────────────────────────────────────────
  app.setGlobalPrefix("api/v1", { exclude: ["/health"] });

  // ── CORS ───────────────────────────────────────────────────────────────────
  // Origin enforcement is handled by Cloudflare WAF — no in-app allowlist needed.
  app.enableCors({
    origin:         true,
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

bootstrap().catch(err => { console.error(err); process.exit(1); });
