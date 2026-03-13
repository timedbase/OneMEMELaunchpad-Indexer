/**
 * OneMEME Launchpad — REST API Server
 *
 * A Hono-based REST API that exposes indexed blockchain data from the
 * OneMEME Launchpad (BSC) stored in PostgreSQL by the Ponder indexer,
 * plus real-time bonding-curve quote simulation via direct RPC calls.
 *
 * Run independently of the Ponder indexer process:
 *   npm run api        (production)
 *   npm run api:dev    (watch mode)
 *
 * Environment variables: see .env.example
 * Base URL: http://localhost:<API_PORT>/api/v1
 *
 * Rate limits (per IP, per minute):
 *   /api/v1/stats                  10  req/min  (heavy aggregation)
 *   /api/v1/tokens/*/quote/*       20  req/min  (triggers RPC calls to BSC)
 *   /api/v1/tokens/:addr (detail)  120 req/min  (lightweight DB lookup)
 *   Everything else                60  req/min  (paginated lists)
 */

import { config } from "dotenv";
config();

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import {
  limitDetail,
  limitList,
  limitQuote,
  limitStats,
} from "./ratelimit";

import tokenRoutes     from "./routes/tokens";
import tradeRoutes     from "./routes/trades";
import migrationRoutes from "./routes/migrations";
import twapRoutes      from "./routes/twap";
import factoryRoutes   from "./routes/factory";
import statsRoutes     from "./routes/stats";
import quoteRoutes     from "./routes/quotes";

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono();

app.use("*", logger());
app.use("*", cors({ origin: "*" }));
app.use("*", prettyJSON());

// ─── Health check (no rate limit — used by uptime monitors) ──────────────────

app.get("/health", (c) =>
  c.json({ status: "ok", service: "onememe-launchpad-api", timestamp: Date.now() })
);

// ─── API v1 ───────────────────────────────────────────────────────────────────

const v1 = new Hono();

// Route index — no rate limit, purely informational
v1.get("/", (c) =>
  c.json({
    version: "1.0.0",
    description: "OneMEME Launchpad REST API",
    rateLimits: {
      quotes:  "20 req/min per IP  (triggers live RPC calls to BSC)",
      stats:   "10 req/min per IP  (heavy aggregation query)",
      detail:  "120 req/min per IP (lightweight DB lookup)",
      default: "60 req/min per IP  (paginated list endpoints)",
    },
    endpoints: {
      "GET /api/v1":                                "This route index",
      "GET /health":                                "Health check",
      // Tokens
      "GET /api/v1/tokens":                         "List all tokens",
      "GET /api/v1/tokens/:address":                "Token detail",
      "GET /api/v1/tokens/:address/trades":         "Bonding-curve trades for a token",
      "GET /api/v1/tokens/:address/traders":        "Top traders leaderboard for a token",
      "GET /api/v1/tokens/:address/migration":      "PancakeSwap migration record",
      // Quotes (live RPC)
      "GET /api/v1/tokens/:address/quote/price":    "Live spot price from contract",
      "GET /api/v1/tokens/:address/quote/buy":      "Simulate buy — BNB → tokens (live RPC)",
      "GET /api/v1/tokens/:address/quote/sell":     "Simulate sell — tokens → BNB (live RPC)",
      // Trades
      "GET /api/v1/trades":                         "All bonding-curve trades",
      // Migrations
      "GET /api/v1/migrations":                     "All PancakeSwap migrations",
      // TWAP
      "GET /api/v1/twap":                           "TWAP oracle history",
      "GET /api/v1/twap/latest":                    "Most recent TWAP reading",
      // Factory
      "GET /api/v1/factory/events":                 "Factory admin/config events",
      // Stats
      "GET /api/v1/stats":                          "Platform-wide aggregated stats",
      // By actor
      "GET /api/v1/creators/:address/tokens":       "Tokens deployed by a creator",
      "GET /api/v1/traders/:address/trades":        "Trades by a wallet",
    },
  })
);

// ─── Rate-limited route groups ────────────────────────────────────────────────
//
// Order matters in Hono: more-specific middleware patterns must come before
// broader ones so the correct limit is applied.

// 1. Quote routes (20 req/min) — each call triggers a live BSC RPC read.
v1.use("/tokens/*/quote/*", limitQuote);
v1.route("/tokens", quoteRoutes); // mounts /:address/quote/price|buy|sell

// 2. Stats (10 req/min) — executes 6 parallel aggregation queries.
v1.use("/stats", limitStats);
v1.route("/stats", statsRoutes);

// 3. Single-item detail endpoints (120 req/min) — fast primary-key lookups.
v1.use("/tokens/:address",            limitDetail);
v1.use("/tokens/:address/migration",  limitDetail);
v1.use("/twap/latest",                limitDetail);

// 4. Everything else (60 req/min) — paginated lists, leaderboards, etc.
v1.use("/*", limitList);

// ─── Mount route handlers ─────────────────────────────────────────────────────

v1.route("/tokens",     tokenRoutes);
v1.route("/trades",     tradeRoutes);
v1.route("/migrations", migrationRoutes);
v1.route("/twap",       twapRoutes);
v1.route("/factory",    factoryRoutes);

// Cross-cutting "by actor" routes reuse the same handlers.
v1.route("/creators",   tokenRoutes);  // /creators/:addr/tokens
v1.route("/traders",    tradeRoutes);  // /traders/:addr/trades

app.route("/api/v1", v1);

// ─── 404 fallback ─────────────────────────────────────────────────────────────

app.notFound((c) =>
  c.json(
    {
      error:   "Not Found",
      message: `${c.req.method} ${c.req.path} does not exist`,
      hint:    "GET /api/v1 for a list of available endpoints",
    },
    404
  )
);

// ─── Start ────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.API_PORT ?? "3001", 10);

console.log(`
  OneMEME Launchpad API
  ─────────────────────────────────────────────────
  Listening   : http://localhost:${port}
  Route index : http://localhost:${port}/api/v1
  Health      : http://localhost:${port}/health

  Rate limits (per IP / per minute):
    /quote/*  → 20   (live BSC RPC)
    /stats    → 10   (aggregation)
    detail    → 120  (DB lookup)
    default   → 60   (lists)
  ─────────────────────────────────────────────────
`);

serve({ fetch: app.fetch, port });
