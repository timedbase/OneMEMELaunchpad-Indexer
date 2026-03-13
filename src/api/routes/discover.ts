/**
 * Discovery routes — curated token lists for frontend surfaces
 *
 * GET /discover/trending   Tokens most traded in the last 30 minutes
 * GET /discover/new        Freshly created tokens, newest first
 * GET /discover/bonding    Active bonding-curve tokens closest to migration
 * GET /discover/migrated   Tokens that have graduated to PancakeSwap
 *
 * All endpoints are paginated and read-only from PostgreSQL.
 * No RPC calls — responses are fast even when the indexer is mid-sync.
 */

import { Hono } from "hono";
import { sql } from "../db";
import { paginated, parsePagination, serverError } from "../helpers";

const app = new Hono();

// ─── Trending ──────────────────────────────────────────────────────────────────

/**
 * GET /discover/trending
 *
 * Tokens ranked by trading activity in the last 30 minutes.
 * Joins the trade table to aggregate per-token metrics over the window,
 * then returns the full token row plus the window stats.
 *
 * Response extras per token:
 *   recentTrades      Total trades (buy + sell) in the window
 *   recentBuys        Buy count in the window
 *   recentSells       Sell count in the window
 *   recentVolumeBNB   Total BNB traded in the window (wei, string)
 *
 * Query params:
 *   page       int   default 1
 *   limit      int   default 20, max 100
 *   window     int   lookback window in seconds (default 1800 = 30 min, max 86400)
 */
app.get("/trending", async (c) => {
  try {
    const { page, limit, offset } = parsePagination(c);

    const windowRaw = parseInt(c.req.query("window") ?? "1800", 10);
    const window    = Math.min(Math.max(isNaN(windowRaw) ? 1800 : windowRaw, 60), 86_400);
    const since     = Math.floor(Date.now() / 1000) - window;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          t.*,
          COUNT(tr.id)::int                                                        AS "recentTrades",
          COUNT(tr.id) FILTER (WHERE tr."tradeType" = 'buy')::int                 AS "recentBuys",
          COUNT(tr.id) FILTER (WHERE tr."tradeType" = 'sell')::int                AS "recentSells",
          COALESCE(SUM(tr."bnbAmount"::numeric), 0)::text                         AS "recentVolumeBNB"
        FROM token t
        INNER JOIN trade tr ON tr."token" = t.id
        WHERE tr."timestamp" >= ${since}
        GROUP BY t.id
        ORDER BY "recentTrades" DESC, "recentVolumeBNB"::numeric DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(DISTINCT tr."token")::int AS count
        FROM trade tr
        WHERE tr."timestamp" >= ${since}
      `,
    ]);

    return c.json({
      ...paginated(rows, count, page, limit),
      window,
      since,
    });
  } catch (err) {
    return serverError(c, err);
  }
});

// ─── New tokens ────────────────────────────────────────────────────────────────

/**
 * GET /discover/new
 *
 * All tokens ordered by creation block descending — the freshest tokens first.
 * Useful for a "just launched" feed on the frontend.
 *
 * Query params:
 *   page    int   default 1
 *   limit   int   default 20, max 100
 *   type    string  "Standard" | "Tax" | "Reflection"
 */
app.get("/new", async (c) => {
  try {
    const { page, limit, offset } = parsePagination(c);
    const type = c.req.query("type");

    const typeFilter = type ? sql`AND "tokenType" = ${type}` : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT *
        FROM token
        WHERE "migrated" = FALSE ${typeFilter}
        ORDER BY "createdAtBlock"::numeric DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM token
        WHERE "migrated" = FALSE ${typeFilter}
      `,
    ]);

    return c.json(paginated(rows, count, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

// ─── Bonding (close to migration) ─────────────────────────────────────────────

/**
 * GET /discover/bonding
 *
 * Active bonding-curve tokens not yet migrated, sorted by raisedBNB descending.
 * Tokens at the top of this list are closest to hitting the fundraising target
 * and graduating to PancakeSwap.
 *
 * Response extras per token:
 *   recentTrades    Trades in the last 24 h (activity signal)
 *   recentVolumeBNB BNB volume in the last 24 h (wei, string)
 *
 * Query params:
 *   page    int    default 1
 *   limit   int    default 20, max 100
 *   type    string "Standard" | "Tax" | "Reflection"
 */
app.get("/bonding", async (c) => {
  try {
    const { page, limit, offset } = parsePagination(c);
    const type  = c.req.query("type");
    const since = Math.floor(Date.now() / 1000) - 86_400; // 24 h

    const typeFilter = type ? sql`AND t."tokenType" = ${type}` : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          t.*,
          COALESCE(a."recentTrades",    0)                                         AS "recentTrades",
          COALESCE(a."recentVolumeBNB", '0')                                       AS "recentVolumeBNB"
        FROM token t
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int                          AS "recentTrades",
            SUM("bnbAmount"::numeric)::text        AS "recentVolumeBNB"
          FROM trade
          WHERE "token" = t.id AND "timestamp" >= ${since}
        ) a ON TRUE
        WHERE t."migrated" = FALSE ${typeFilter}
        ORDER BY t."raisedBNB"::numeric DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM token t
        WHERE t."migrated" = FALSE ${typeFilter}
      `,
    ]);

    return c.json(paginated(rows, count, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

// ─── Migrated (graduated) ─────────────────────────────────────────────────────

/**
 * GET /discover/migrated
 *
 * Tokens that have graduated from the bonding curve to PancakeSwap V2.
 * Joined with the migration table to include pair address, liquidity amounts,
 * and the block/timestamp of graduation.
 *
 * Query params:
 *   page    int    default 1
 *   limit   int    default 20, max 100
 *   type    string "Standard" | "Tax" | "Reflection"
 *   orderBy string "migratedAt" (default) | "liquidityBNB" | "volumeBNB"
 *   orderDir string "asc" | "desc" (default "desc")
 */
app.get("/migrated", async (c) => {
  try {
    const { page, limit, offset } = parsePagination(c);
    const type = c.req.query("type");

    const ALLOWED_ORDER = ["migratedAt", "liquidityBNB", "volumeBNB"] as const;
    type AllowedOrder = typeof ALLOWED_ORDER[number];
    const orderByRaw = c.req.query("orderBy") ?? "migratedAt";
    const orderBy: AllowedOrder = (ALLOWED_ORDER as readonly string[]).includes(orderByRaw)
      ? orderByRaw as AllowedOrder
      : "migratedAt";
    const orderDir = (c.req.query("orderDir") ?? "desc").toUpperCase() === "ASC" ? sql`ASC` : sql`DESC`;

    const typeFilter = type ? sql`AND t."tokenType" = ${type}` : sql``;

    // Map orderBy to the actual column expression
    const orderExpr =
      orderBy === "migratedAt"    ? sql`m."blockNumber"::numeric`  :
      orderBy === "liquidityBNB"  ? sql`m."liquidityBNB"::numeric` :
      /* volumeBNB */               sql`t."volumeBNB"::numeric`;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          t.*,
          m."pair"             AS "pairAddress",
          m."liquidityBNB"     AS "liquidityBNB",
          m."liquidityTokens"  AS "liquidityTokens",
          m."blockNumber"      AS "migratedAtBlock",
          m."timestamp"        AS "migratedAt",
          m."txHash"           AS "migrationTxHash"
        FROM token t
        INNER JOIN migration m ON m.id = t.id
        WHERE t."migrated" = TRUE ${typeFilter}
        ORDER BY ${orderExpr} ${orderDir}
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM token t
        WHERE t."migrated" = TRUE ${typeFilter}
      `,
    ]);

    return c.json(paginated(rows, count, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

export default app;
