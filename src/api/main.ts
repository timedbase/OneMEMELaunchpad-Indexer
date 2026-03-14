/**
 * OneMEME Launchpad — NestJS API Server
 *
 * Supports HTTPS + WSS out of the box:
 *   - Set SSL_KEY_PATH and SSL_CERT_PATH to enable HTTPS/WSS automatically.
 *   - Without SSL vars the server starts in plain HTTP/WS mode.
 *
 * Run:
 *   npm run api:dev   (ts-node, watch mode)
 *   npm run api:build && npm run api  (compiled production)
 *
 * Environment variables: see .env.example
 * Base URL: https://localhost:<API_PORT>/api/v1
 * WebSocket: wss://localhost:<API_PORT>/api/v1/activity/ws
 */

import "reflect-metadata";
import { config } from "dotenv";
config();

import * as fs   from "node:fs";
import { NestFactory }   from "@nestjs/core";
import { WsAdapter }     from "@nestjs/platform-ws";
import { AppModule }     from "./app.module";

async function bootstrap() {
  // ── TLS / HTTPS ────────────────────────────────────────────────────────────
  const sslKey  = process.env.SSL_KEY_PATH;
  const sslCert = process.env.SSL_CERT_PATH;

  const httpsOptions =
    sslKey && sslCert
      ? { key: fs.readFileSync(sslKey), cert: fs.readFileSync(sslCert) }
      : undefined;

  const app = await NestFactory.create(AppModule, {
    httpsOptions,
    logger: ["log", "warn", "error"],
  });

  // ── WebSocket adapter (WSS when HTTPS is active) ───────────────────────────
  app.useWebSocketAdapter(new WsAdapter(app));

  // ── Global route prefix ────────────────────────────────────────────────────
  // /health is excluded so uptime monitors can reach it without the prefix.
  app.setGlobalPrefix("api/v1", { exclude: ["/health"] });

  // ── CORS ───────────────────────────────────────────────────────────────────
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins.length
      ? (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
          // Allow requests with no Origin header (non-browser) and listed origins.
          if (!origin || allowedOrigins.includes(origin)) cb(null, true);
          else cb(null, false);
        }
      : "*",
    methods:        ["GET", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    exposedHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
  });

  // ── Listen ─────────────────────────────────────────────────────────────────
  const port    = parseInt(process.env.API_PORT ?? "3001", 10);
  const proto   = httpsOptions ? "https" : "http";
  const wsProto = httpsOptions ? "wss"   : "ws";

  await app.listen(port);

  console.log(`
  OneMEME Launchpad API  (NestJS)
  ─────────────────────────────────────────────────
  Listening   : ${proto}://localhost:${port}
  Route index : ${proto}://localhost:${port}/api/v1
  Health      : ${proto}://localhost:${port}/health
  Activity WS : ${wsProto}://localhost:${port}/api/v1/activity/ws
  TLS         : ${httpsOptions ? "enabled (HTTPS / WSS)" : "disabled (HTTP / WS)"}

  Rate limits (per IP / per minute):
    /quote/*  → 20   (live BSC RPC)
    /stats    → 10   (aggregation)
    default   → 60   (lists & detail)
  ─────────────────────────────────────────────────
`);
}

bootstrap().catch(console.error);
