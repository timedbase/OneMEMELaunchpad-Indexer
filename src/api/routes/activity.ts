/**
 * Activity feed routes
 *
 * GET /activity           Paginated unified feed of create/buy/sell events
 * GET /activity/stream    Server-Sent Events stream for real-time push
 *
 * The feed merges two DB tables into a single time-ordered event list:
 *   - token  → "create" events (TokenCreated)
 *   - trade  → "buy" | "sell" events (TokenBought / TokenSold)
 *
 * Each event has a common envelope:
 *   {
 *     eventType:   "create" | "buy" | "sell"
 *     token:       token contract address
 *     actor:       creator address (create) | trader address (buy/sell)
 *     bnbAmount:   null for create, wei string for buy/sell
 *     tokenAmount: null for create, wei string for buy/sell
 *     blockNumber: string (numeric)
 *     timestamp:   unix seconds (int)
 *     txHash:      transaction hash (null for create — not stored in token table)
 *   }
 *
 * SSE stream (/activity/stream):
 *   Polls the DB every 2 seconds and pushes only new events since the last
 *   poll. Clients connect with a standard EventSource — no auth required.
 *   Each SSE message is a JSON-stringified activity event.
 *   The stream sends a keepalive comment every 15 s to prevent proxy timeouts.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { sql } from "../db";
import {
  badRequest,
  paginated,
  parsePagination,
  serverError,
} from "../helpers";

const app = new Hono();

// ─── Shared query builder ──────────────────────────────────────────────────────

const VALID_TYPES = new Set(["create", "buy", "sell"]);

/**
 * Builds the UNION ALL query that merges token creates and trades into
 * a single time-ordered activity stream.
 *
 * @param typeFilter  Optional event type to restrict results ("create"|"buy"|"sell")
 * @param token       Optional token address to restrict results
 * @param sinceBlock  Only return events with blockNumber > sinceBlock (for SSE polling)
 * @param limit       Max rows to return
 * @param offset      Row offset for pagination
 */
async function queryActivity({
  typeFilter,
  token,
  sinceBlock,
  limit,
  offset,
}: {
  typeFilter?: string;
  token?: string;
  sinceBlock?: bigint;
  limit: number;
  offset: number;
}) {
  const sinceFilter = sinceBlock != null
    ? sql`AND "blockNumber"::numeric > ${sinceBlock.toString()}`
    : sql``;

  const tokenFilter = token
    ? sql`AND "token" = ${token.toLowerCase()}`
    : sql``;

  // "create" sub-query — pulls from the token table
  const createQ = (typeFilter === "buy" || typeFilter === "sell")
    ? null
    : sql`
        SELECT
          'create'                  AS "eventType",
          id                        AS "token",
          "creator"                 AS "actor",
          NULL::text                AS "bnbAmount",
          NULL::text                AS "tokenAmount",
          "createdAtBlock"          AS "blockNumber",
          "createdAtTimestamp"      AS "timestamp",
          NULL::text                AS "txHash"
        FROM token
        WHERE TRUE ${sinceBlock != null ? sql`AND "createdAtBlock"::numeric > ${sinceBlock.toString()}` : sql``}
              ${token ? sql`AND id = ${token.toLowerCase()}` : sql``}
      `;

  // "buy" / "sell" sub-query — pulls from the trade table
  const tradeTypeFilter =
    typeFilter === "create" ? null :
    typeFilter === "buy"    ? sql`AND "tradeType" = 'buy'`  :
    typeFilter === "sell"   ? sql`AND "tradeType" = 'sell'` :
    sql``;

  const tradeQ = typeFilter === "create"
    ? null
    : sql`
        SELECT
          "tradeType"               AS "eventType",
          "token"                   AS "token",
          "trader"                  AS "actor",
          "bnbAmount"               AS "bnbAmount",
          "tokenAmount"             AS "tokenAmount",
          "blockNumber"             AS "blockNumber",
          "timestamp"               AS "timestamp",
          "txHash"                  AS "txHash"
        FROM trade
        WHERE TRUE ${tradeTypeFilter ?? sql``} ${sinceFilter} ${tokenFilter}
      `;

  // Build the UNION
  let unionQ;
  if (createQ && tradeQ) {
    unionQ = sql`${createQ} UNION ALL ${tradeQ}`;
  } else if (createQ) {
    unionQ = createQ;
  } else {
    unionQ = tradeQ!;
  }

  return sql`
    SELECT * FROM (${unionQ}) AS activity
    ORDER BY "blockNumber"::numeric DESC, "eventType"
    LIMIT ${limit} OFFSET ${offset}
  `;
}

/** Count query matching the same filters. */
async function countActivity({
  typeFilter,
  token,
}: {
  typeFilter?: string;
  token?: string;
}) {
  const tokenFilter = token
    ? sql`AND id = ${token.toLowerCase()}`
    : sql``;
  const tradeTokenFilter = token
    ? sql`AND "token" = ${token.toLowerCase()}`
    : sql``;

  const createCount =
    typeFilter === "buy" || typeFilter === "sell"
      ? sql`SELECT 0 AS n`
      : sql`SELECT COUNT(*)::int AS n FROM token WHERE TRUE ${tokenFilter}`;

  const tradeFilter =
    typeFilter === "create" ? sql`AND FALSE` :
    typeFilter === "buy"    ? sql`AND "tradeType" = 'buy'` :
    typeFilter === "sell"   ? sql`AND "tradeType" = 'sell'` :
    sql``;

  const tradeCount =
    typeFilter === "create"
      ? sql`SELECT 0 AS n`
      : sql`SELECT COUNT(*)::int AS n FROM trade WHERE TRUE ${tradeFilter} ${tradeTokenFilter}`;

  const [createRow, tradeRow] = await Promise.all([
    sql`${createCount}`,
    sql`${tradeCount}`,
  ]);

  return (createRow[0]?.n ?? 0) + (tradeRow[0]?.n ?? 0);
}

// ─── GET /activity ─────────────────────────────────────────────────────────────

/**
 * GET /activity
 *
 * Query params:
 *   page     int     default 1
 *   limit    int     default 20, max 100
 *   type     string  "create" | "buy" | "sell"
 *   token    string  filter by token address
 */
app.get("/", async (c) => {
  try {
    const { page, limit, offset } = parsePagination(c);
    const typeParam  = c.req.query("type");
    const tokenParam = c.req.query("token");

    if (typeParam && !VALID_TYPES.has(typeParam)) {
      return badRequest(c, `Invalid type. Must be one of: ${[...VALID_TYPES].join(", ")}`);
    }

    const [rows, total] = await Promise.all([
      queryActivity({ typeFilter: typeParam, token: tokenParam, limit, offset }),
      countActivity({ typeFilter: typeParam, token: tokenParam }),
    ]);

    return c.json(paginated(rows, total, page, limit));
  } catch (err) {
    return serverError(c, err);
  }
});

// ─── GET /activity/stream (SSE) ────────────────────────────────────────────────

/** Poll interval for new DB events (ms). */
const POLL_INTERVAL_MS = 2_000;

/** Keepalive comment interval (ms) — prevents proxy / browser timeout. */
const KEEPALIVE_INTERVAL_MS = 15_000;

/**
 * GET /activity/stream
 *
 * Server-Sent Events stream. Pushes new create/buy/sell events as they
 * are indexed. Clients connect with a native EventSource:
 *
 *   const es = new EventSource("http://localhost:3001/api/v1/activity/stream");
 *   es.addEventListener("activity", e => console.log(JSON.parse(e.data)));
 *
 * Query params:
 *   type   string  filter by "create" | "buy" | "sell" (optional)
 *   token  string  filter by token address (optional)
 */
app.get("/stream", async (c) => {
  const typeParam  = c.req.query("type");
  const tokenParam = c.req.query("token");

  if (typeParam && !VALID_TYPES.has(typeParam)) {
    return badRequest(c, `Invalid type. Must be one of: ${[...VALID_TYPES].join(", ")}`);
  }

  return streamSSE(c, async (stream) => {
    // Seed with the most recent block already in DB so we only push NEW events.
    const [latest] = await sql`
      SELECT GREATEST(
        (SELECT MAX("createdAtBlock"::numeric) FROM token),
        (SELECT MAX("blockNumber"::numeric)    FROM trade)
      )::text AS block
    `;
    let lastBlock: bigint = BigInt(latest?.block ?? "0");

    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    // Keepalive: SSE comment every 15 s
    keepaliveTimer = setInterval(async () => {
      try { await stream.writeSSE({ data: "", event: "keepalive" }); } catch { /* client gone */ }
    }, KEEPALIVE_INTERVAL_MS);

    try {
      while (!stream.aborted) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

        const rows = await queryActivity({
          typeFilter: typeParam,
          token:      tokenParam,
          sinceBlock: lastBlock,
          limit:      50,
          offset:     0,
        });

        if (rows.length > 0) {
          // Update cursor to the highest block seen in this batch
          for (const row of rows) {
            const b = BigInt(row.blockNumber as string);
            if (b > lastBlock) lastBlock = b;
          }
          // Push events oldest-first so the client processes them in order
          for (const row of [...rows].reverse()) {
            await stream.writeSSE({
              event: "activity",
              data:  JSON.stringify(row),
            });
          }
        }
      }
    } finally {
      if (keepaliveTimer) clearInterval(keepaliveTimer);
    }
  });
});

export default app;
