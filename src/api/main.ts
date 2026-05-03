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

import fs              from "fs";
import compression      from "compression";
import { NestFactory }  from "@nestjs/core";
import { WsAdapter }    from "@nestjs/platform-ws";
import { AppModule }    from "./app.module";
import { AppLogger }    from "./logger";

function validateEnv() {
  // SUBGRAPH_URL is the primary data source — all token/trade endpoints fail without it.
  if (!process.env.SUBGRAPH_URL) {
    throw new Error(
      "SUBGRAPH_URL is not set. Copy .env.example to .env and configure it."
    );
  }
  // DATABASE_URL is validated eagerly by db.ts at module load, but check here
  // for a cleaner error message if bootstrap() is called before that module.
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and configure it."
    );
  }
}

async function bootstrap() {
  validateEnv();

  const certPath = process.env.SSL_CERT_PATH;
  const keyPath  = process.env.SSL_KEY_PATH;
  const httpsOptions = certPath && keyPath
    ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
    : undefined;

  const app = await NestFactory.create(AppModule, {
    logger: AppLogger,
    httpsOptions,
  });

  // ── Compression ────────────────────────────────────────────────────────────
  app.use(compression());

  // ── WebSocket adapter ──────────────────────────────────────────────────────
  app.useWebSocketAdapter(new WsAdapter(app));

  // ── Global route prefix ────────────────────────────────────────────────────
  // CHAIN_SLUG identifies the network (e.g. "bsc", "eth", "polygon").
  // All routes become /api/v1/<chain>/... — ready for multi-chain deployments.
  const chainSlug = process.env.CHAIN_SLUG ?? "bsc";
  const apiPrefix = `api/v1/${chainSlug}`;
  app.setGlobalPrefix(apiPrefix, { exclude: ["/health"] });

  // ── CORS ───────────────────────────────────────────────────────────────────
  // Set ALLOWED_ORIGINS as a comma-separated list (e.g. "https://app.1coin.meme,https://staging.1coin.meme").
  // Leave unset only in development — production must set an explicit allowlist.
  const rawOrigins = process.env.ALLOWED_ORIGINS;
  const corsOrigin: boolean | string[] = rawOrigins
    ? rawOrigins.split(",").map(o => o.trim()).filter(Boolean)
    : true; // dev fallback — Cloudflare WAF gates this in prod

  app.enableCors({
    origin:         corsOrigin,
    methods:        ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    exposedHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
  });

  // ── Listen ─────────────────────────────────────────────────────────────────
  const port     = parseInt(process.env.API_PORT ?? "3001", 10);
  const protocol = httpsOptions ? "https" : "http";

  await app.listen(port);

  console.log(`
  OneMEME Launchpad API  (NestJS)
  ─────────────────────────────────────────────────
  Listening   : ${protocol}://localhost:${port}
  Chain       : ${chainSlug}
  Route index : ${protocol}://localhost:${port}/${apiPrefix}
  Health      : ${protocol}://localhost:${port}/health
  Activity WS : ${httpsOptions ? "wss" : "ws"}://localhost:${port}/${apiPrefix}/activity/ws
  Chat WS     : ${httpsOptions ? "wss" : "ws"}://localhost:${port}/${apiPrefix}/chat/ws

  Rate limits (per IP / per minute):
    /quote/*  → 20   (live BSC RPC)
    /stats    → 10   (aggregation)
    default   → 60
  ─────────────────────────────────────────────────
`);
}

bootstrap().catch(err => { console.error(err); process.exit(1); });
