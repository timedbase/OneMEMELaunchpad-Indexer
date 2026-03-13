/**
 * Token routes
 *
 * GET /tokens                    List all tokens (filterable, paginated, sortable)
 * GET /tokens/:address           Single token detail
 * GET /tokens/:address/trades    Bonding-curve trades for a token
 * GET /tokens/:address/migration PancakeSwap migration record
 * GET /creators/:address/tokens  Tokens deployed by a creator address
 */

import { Hono } from "hono";
import { sql } from "../db";
import {
  badRequest,
  isAddress,
  notFound,
  paginated,
  parsePagination,
  parseOrderBy,
  parseOrderDir,
  serverError,
} from "../helpers";
import { getMetaURI } from "../rpc";
import { fetchMetadata } from "../metadata";

const app = new Hono();

// ─── List tokens ──────────────────────────────────────────────────────────────

/**
 * GET /tokens
 *
 * Query params:
 *   page       int      default 1
 *   limit      int      default 20, max 100
 *   type       string   "Standard" | "Tax" | "Reflection"
 *   migrated   boolean  "true" | "false"
 *   orderBy    string   "createdAtBlock" | "volumeBNB" | "buyCount" | "sellCount" | "raisedBNB"
 *   orderDir   string   "asc" | "desc"  (default "desc")
 */
app.get("/", async (c) => {
  try {
    const { page, limit, offset } = parsePagination(c);
    const type     = c.req.query("type");
    const migrated = c.req.query("migrated");

    const ALLOWED_ORDER = ["createdAtBlock", "volumeBNB", "buyCount", "sellCount", "raisedBNB", "totalSupply"] as const;
    const orderBy  = parseOrderBy(c, ALLOWED_ORDER, "createdAtBlock");
    const orderDir = parseOrderDir(c);

    const migratedFilter =
      migrated === "true"  ? sql`AND "migrated" = TRUE`  :
      migrated === "false" ? sql`AND "migrated" = FALSE` :
      sql``;

    const typeFilter = type
      ? sql`AND "tokenType" = ${type}`
      : sql``;

    // Numeric columns must be cast for correct sorting; text columns are fine as-is.
    const numericCols = new Set(["volumeBNB", "raisedBNB", "createdAtBlock", "tradingBlock", "totalSupply"]);
    const orderExpr = numericCols.has(orderBy)
      ? sql`ORDER BY ${sql('"' + orderBy + '"')}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`
      : sql`ORDER BY ${sql('"' + orderBy + '"')} ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT *
        FROM token
        WHERE TRUE ${typeFilter} ${migratedFilter}
        ${orderExpr}
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM token
        WHERE TRUE ${typeFilter} ${migratedFilter}
      `,
    ]);

    return c.json(paginated(rows, count, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

// ─── Single token ─────────────────────────────────────────────────────────────

/**
 * GET /tokens/:address
 * Returns full token detail including current bonding-curve stats.
 */
app.get("/:address", async (c) => {
  try {
    const { address } = c.req.param();
    if (!isAddress(address)) return badRequest(c, "Invalid token address");

    const [row] = await sql`SELECT * FROM token WHERE id = ${address.toLowerCase()}`;
    if (!row) return notFound(c, `Token ${address} not found`);

    // Fetch off-chain metadata in parallel with nothing (non-blocking).
    // getMetaURI never throws; fetchMetadata never throws.
    const metaURI  = await getMetaURI(address.toLowerCase() as `0x${string}`);
    const metadata = metaURI ? await fetchMetadata(metaURI) : null;

    return c.json({
      data: {
        ...row,
        metaURI:  metaURI  || null,
        metadata: metadata ?? null,
      },
    });
  } catch (err) {
    return serverError(c, err);
  }
});

// ─── Token trades ─────────────────────────────────────────────────────────────

/**
 * GET /tokens/:address/trades
 *
 * Query params:
 *   page       int      default 1
 *   limit      int      default 20, max 100
 *   type       string   "buy" | "sell"
 *   orderBy    string   "timestamp" | "bnbAmount" | "tokenAmount"
 *   orderDir   string   "asc" | "desc" (default "desc")
 *   from       int      Unix timestamp lower bound (inclusive)
 *   to         int      Unix timestamp upper bound (inclusive)
 */
app.get("/:address/trades", async (c) => {
  try {
    const { address } = c.req.param();
    if (!isAddress(address)) return badRequest(c, "Invalid token address");

    const { page, limit, offset } = parsePagination(c);
    const type      = c.req.query("type");
    const from      = c.req.query("from");
    const to        = c.req.query("to");

    const ALLOWED_ORDER = ["timestamp", "bnbAmount", "tokenAmount", "blockNumber"] as const;
    const orderBy  = parseOrderBy(c, ALLOWED_ORDER, "timestamp");
    const orderDir = parseOrderDir(c);

    const typeFilter = type    ? sql`AND "tradeType" = ${type}`            : sql``;
    const fromFilter = from    ? sql`AND "timestamp" >= ${parseInt(from)}` : sql``;
    const toFilter   = to      ? sql`AND "timestamp" <= ${parseInt(to)}`   : sql``;

    const numericCols = new Set(["bnbAmount", "tokenAmount", "blockNumber"]);
    const orderExpr = numericCols.has(orderBy)
      ? sql`ORDER BY ${sql('"' + orderBy + '"')}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`
      : sql`ORDER BY ${sql('"' + orderBy + '"')} ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`;

    const addr = address.toLowerCase();

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT *
        FROM trade
        WHERE "token" = ${addr} ${typeFilter} ${fromFilter} ${toFilter}
        ${orderExpr}
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM trade
        WHERE "token" = ${addr} ${typeFilter} ${fromFilter} ${toFilter}
      `,
    ]);

    return c.json(paginated(rows, count, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

// ─── Token migration ──────────────────────────────────────────────────────────

/**
 * GET /tokens/:address/migration
 * Returns the PancakeSwap migration record for a token, or 404 if not yet migrated.
 */
app.get("/:address/migration", async (c) => {
  try {
    const { address } = c.req.param();
    if (!isAddress(address)) return badRequest(c, "Invalid token address");

    const [row] = await sql`SELECT * FROM migration WHERE id = ${address.toLowerCase()}`;
    if (!row) return notFound(c, `Token ${address} has not migrated yet`);

    return c.json({ data: row });
  } catch (err) {
    return serverError(c, err);
  }
});

// ─── Tokens by creator ────────────────────────────────────────────────────────

/**
 * GET /creators/:address/tokens
 *
 * Returns all tokens deployed by a given creator address, newest first.
 */
app.get("/creators/:address/tokens", async (c) => {
  try {
    const { address } = c.req.param();
    if (!isAddress(address)) return badRequest(c, "Invalid creator address");

    const { page, limit, offset } = parsePagination(c);
    const addr = address.toLowerCase();

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT *
        FROM token
        WHERE "creator" = ${addr}
        ORDER BY "createdAtBlock"::numeric DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(*)::int AS count FROM token WHERE "creator" = ${addr}`,
    ]);

    return c.json(paginated(rows, count, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

// ─── Top traders for a token ──────────────────────────────────────────────────

/**
 * GET /tokens/:address/traders
 *
 * Returns the top wallets by bonding-curve trading volume for a specific token.
 * Useful for leaderboards, whale tracking, and community dashboards.
 *
 * Query params:
 *   page       int     default 1
 *   limit      int     default 20, max 100
 *   orderBy    string  "totalVolumeBNB" | "totalTrades" | "buyCount" | "sellCount"
 *   orderDir   string  "asc" | "desc" (default "desc")
 *
 * Response per entry:
 *   trader           Wallet address
 *   buyCount         Number of buy trades
 *   sellCount        Number of sell trades
 *   totalTrades      buyCount + sellCount
 *   totalBNBIn       Total BNB spent buying (wei)
 *   totalBNBOut      Total BNB received from selling (wei)
 *   totalVolumeBNB   totalBNBIn + totalBNBOut (overall activity, wei)
 *   netBNB           totalBNBOut - totalBNBIn (positive = net profit in BNB, wei)
 */
app.get("/:address/traders", async (c) => {
  try {
    const { address } = c.req.param();
    if (!isAddress(address)) return badRequest(c, "Invalid token address");

    const { page, limit, offset } = parsePagination(c);

    const ALLOWED_ORDER = ["totalVolumeBNB", "totalTrades", "buyCount", "sellCount", "netBNB"] as const;
    const orderBy  = parseOrderBy(c, ALLOWED_ORDER, "totalVolumeBNB");
    const orderDir = parseOrderDir(c);

    const addr = address.toLowerCase();

    // All numeric aggregates are cast to text via ::text to preserve precision.
    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          "trader",
          COUNT(*) FILTER (WHERE "tradeType" = 'buy')::int                             AS "buyCount",
          COUNT(*) FILTER (WHERE "tradeType" = 'sell')::int                            AS "sellCount",
          COUNT(*)::int                                                                 AS "totalTrades",
          COALESCE(SUM("bnbAmount"::numeric) FILTER (WHERE "tradeType" = 'buy'),  0)::text AS "totalBNBIn",
          COALESCE(SUM("bnbAmount"::numeric) FILTER (WHERE "tradeType" = 'sell'), 0)::text AS "totalBNBOut",
          COALESCE(SUM("bnbAmount"::numeric), 0)::text                                 AS "totalVolumeBNB",
          (
            COALESCE(SUM("bnbAmount"::numeric) FILTER (WHERE "tradeType" = 'sell'), 0) -
            COALESCE(SUM("bnbAmount"::numeric) FILTER (WHERE "tradeType" = 'buy'),  0)
          )::text                                                                       AS "netBNB"
        FROM trade
        WHERE "token" = ${addr}
        GROUP BY "trader"
        ORDER BY ${sql('"' + orderBy + '"')}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(DISTINCT "trader")::int AS count
        FROM trade
        WHERE "token" = ${addr}
      `,
    ]);

    return c.json(paginated(rows, count, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

export default app;
