/**
 * Migration routes
 *
 * GET /migrations      All PancakeSwap migrations (paginated, sortable)
 */

import { Hono } from "hono";
import { sql } from "../db";
import {
  paginated,
  parsePagination,
  parseOrderBy,
  parseOrderDir,
  serverError,
} from "../helpers";

const app = new Hono();

/**
 * GET /migrations
 *
 * Returns all tokens that have graduated from the bonding curve to PancakeSwap,
 * ordered by migration timestamp (most recent first by default).
 *
 * Query params:
 *   page       int     default 1
 *   limit      int     default 20, max 100
 *   orderBy    string  "timestamp" | "liquidityBNB" | "liquidityTokens" | "blockNumber"
 *   orderDir   string  "asc" | "desc" (default "desc")
 */
app.get("/", async (c) => {
  try {
    const { page, limit, offset } = parsePagination(c);

    const ALLOWED_ORDER = ["timestamp", "liquidityBNB", "liquidityTokens", "blockNumber"] as const;
    const orderBy  = parseOrderBy(c, ALLOWED_ORDER, "timestamp");
    const orderDir = parseOrderDir(c);

    const numericCols = new Set(["liquidityBNB", "liquidityTokens", "blockNumber"]);
    const orderExpr = numericCols.has(orderBy)
      ? sql`ORDER BY ${sql('"' + orderBy + '"')}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`
      : sql`ORDER BY ${sql('"' + orderBy + '"')} ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`;

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM migration ${orderExpr} LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM migration`,
    ]);

    return c.json(paginated(rows, count, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

export default app;
