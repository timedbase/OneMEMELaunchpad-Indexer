/**
 * Factory routes
 *
 * GET /factory/events      Admin / config-change events emitted by the factory
 */

import { Hono } from "hono";
import { sql } from "../db";
import {
  badRequest,
  paginated,
  parsePagination,
  serverError,
} from "../helpers";

const app = new Hono();

const VALID_EVENT_TYPES = new Set([
  "DefaultParamsUpdated",
  "FeesWithdrawn",
  "RouterUpdated",
  "FeeRecipientUpdated",
  "TradeFeeUpdated",
  "UsdcPairUpdated",
  "TwapMaxAgeBlocksUpdated",
]);

/**
 * GET /factory/events
 *
 * Returns admin / configuration events emitted by the LaunchpadFactory.
 * Useful for auditing owner actions and tracking parameter changes over time.
 *
 * Query params:
 *   page    int     default 1
 *   limit   int     default 20, max 100
 *   type    string  one of the 7 factory event types (see VALID_EVENT_TYPES)
 *   from    int     Unix timestamp lower bound (inclusive)
 *   to      int     Unix timestamp upper bound (inclusive)
 */
app.get("/events", async (c) => {
  try {
    const { page, limit, offset } = parsePagination(c);
    const type = c.req.query("type");
    const from = c.req.query("from");
    const to   = c.req.query("to");

    if (type && !VALID_EVENT_TYPES.has(type)) {
      return badRequest(
        c,
        `Invalid event type. Valid types: ${[...VALID_EVENT_TYPES].join(", ")}`
      );
    }

    const typeSql = type ? sql`AND "eventType" = ${type}`          : sql``;
    const fromSql = from ? sql`AND "timestamp" >= ${parseInt(from)}` : sql``;
    const toSql   = to   ? sql`AND "timestamp" <= ${parseInt(to)}`   : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT *
        FROM factory_event
        WHERE TRUE ${typeSql} ${fromSql} ${toSql}
        ORDER BY "blockNumber"::numeric DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM factory_event
        WHERE TRUE ${typeSql} ${fromSql} ${toSql}
      `,
    ]);

    return c.json(paginated(rows, count, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

export default app;
