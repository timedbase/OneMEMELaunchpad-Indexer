/**
 * Trade routes
 *
 * GET /trades                       All bonding-curve trades (filterable, paginated)
 * GET /traders/:address/trades      All trades by a specific wallet address
 */

import { Hono } from "hono";
import { sql } from "../db";
import {
  badRequest,
  isAddress,
  paginated,
  parsePagination,
  parseOrderBy,
  parseOrderDir,
  serverError,
} from "../helpers";

const app = new Hono();

// ─── All trades ───────────────────────────────────────────────────────────────

/**
 * GET /trades
 *
 * Query params:
 *   page       int      default 1
 *   limit      int      default 20, max 100
 *   token      address  filter by token contract
 *   trader     address  filter by buyer / seller wallet
 *   type       string   "buy" | "sell"
 *   from       int      Unix timestamp lower bound (inclusive)
 *   to         int      Unix timestamp upper bound (inclusive)
 *   orderBy    string   "timestamp" | "bnbAmount" | "tokenAmount" | "blockNumber"
 *   orderDir   string   "asc" | "desc" (default "desc")
 */
app.get("/", async (c) => {
  try {
    const { page, limit, offset } = parsePagination(c);

    const tokenFilter  = c.req.query("token");
    const traderFilter = c.req.query("trader");
    const typeFilter   = c.req.query("type");
    const from         = c.req.query("from");
    const to           = c.req.query("to");

    if (tokenFilter  && !isAddress(tokenFilter))  return badRequest(c, "Invalid token address");
    if (traderFilter && !isAddress(traderFilter)) return badRequest(c, "Invalid trader address");

    const ALLOWED_ORDER = ["timestamp", "bnbAmount", "tokenAmount", "blockNumber"] as const;
    const orderBy  = parseOrderBy(c, ALLOWED_ORDER, "timestamp");
    const orderDir = parseOrderDir(c);

    const tokenSql  = tokenFilter  ? sql`AND "token"     = ${tokenFilter.toLowerCase()}`  : sql``;
    const traderSql = traderFilter ? sql`AND "trader"    = ${traderFilter.toLowerCase()}` : sql``;
    const typeSql   = typeFilter   ? sql`AND "tradeType" = ${typeFilter}`                  : sql``;
    const fromSql   = from         ? sql`AND "timestamp" >= ${parseInt(from)}`             : sql``;
    const toSql     = to           ? sql`AND "timestamp" <= ${parseInt(to)}`               : sql``;

    const numericCols = new Set(["bnbAmount", "tokenAmount", "blockNumber"]);
    const orderExpr = numericCols.has(orderBy)
      ? sql`ORDER BY ${sql('"' + orderBy + '"')}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`
      : sql`ORDER BY ${sql('"' + orderBy + '"')} ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT *
        FROM trade
        WHERE TRUE ${tokenSql} ${traderSql} ${typeSql} ${fromSql} ${toSql}
        ${orderExpr}
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM trade
        WHERE TRUE ${tokenSql} ${traderSql} ${typeSql} ${fromSql} ${toSql}
      `,
    ]);

    return c.json(paginated(rows, count, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

// ─── Trades by trader ─────────────────────────────────────────────────────────

/**
 * GET /traders/:address/trades
 *
 * Returns all bonding-curve trades made by a specific wallet, newest first.
 * Supports the same `type`, `from`, `to`, `limit`, `page` filters as /trades.
 */
app.get("/traders/:address/trades", async (c) => {
  try {
    const { address } = c.req.param();
    if (!isAddress(address)) return badRequest(c, "Invalid trader address");

    const { page, limit, offset } = parsePagination(c);
    const typeFilter = c.req.query("type");
    const from       = c.req.query("from");
    const to         = c.req.query("to");

    const typeSql = typeFilter ? sql`AND "tradeType" = ${typeFilter}`        : sql``;
    const fromSql = from       ? sql`AND "timestamp" >= ${parseInt(from)}`   : sql``;
    const toSql   = to         ? sql`AND "timestamp" <= ${parseInt(to)}`     : sql``;

    const addr = address.toLowerCase();

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT *
        FROM trade
        WHERE "trader" = ${addr} ${typeSql} ${fromSql} ${toSql}
        ORDER BY "timestamp" DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM trade
        WHERE "trader" = ${addr} ${typeSql} ${fromSql} ${toSql}
      `,
    ]);

    return c.json(paginated(rows, count, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

export default app;
