/**
 * TWAP routes
 *
 * GET /twap           Historical TWAP oracle readings (paginated)
 * GET /twap/latest    Most recent TWAP reading
 */

import { Hono } from "hono";
import { sql } from "../db";
import {
  notFound,
  paginated,
  parsePagination,
  serverError,
} from "../helpers";

const app = new Hono();

/**
 * GET /twap/latest
 *
 * Returns the most recent TWAP price average recorded by the factory oracle.
 * This represents the 30-minute time-weighted BNB/USD price used for
 * converting USD-denominated parameters (creation fee, virtual BNB, migration
 * target) to BNB at runtime.
 */
app.get("/latest", async (c) => {
  try {
    const [row] = await sql`
      SELECT * FROM twap_update
      ORDER BY "blockNumber"::numeric DESC
      LIMIT 1
    `;

    if (!row) return notFound(c, "No TWAP updates indexed yet");

    return c.json({ data: row });
  } catch (err) {
    return serverError(c, err);
  }
});

/**
 * GET /twap
 *
 * Returns the full history of TWAP oracle updates emitted by the factory,
 * most recent first.
 *
 * Query params:
 *   page    int   default 1
 *   limit   int   default 20, max 100
 *   from    int   Unix timestamp lower bound (inclusive)
 *   to      int   Unix timestamp upper bound (inclusive)
 */
app.get("/", async (c) => {
  try {
    const { page, limit, offset } = parsePagination(c);
    const from = c.req.query("from");
    const to   = c.req.query("to");

    const fromSql = from ? sql`AND "timestamp" >= ${parseInt(from)}` : sql``;
    const toSql   = to   ? sql`AND "timestamp" <= ${parseInt(to)}`   : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT *
        FROM twap_update
        WHERE TRUE ${fromSql} ${toSql}
        ORDER BY "blockNumber"::numeric DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM twap_update
        WHERE TRUE ${fromSql} ${toSql}
      `,
    ]);

    return c.json(paginated(rows, count, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

export default app;
