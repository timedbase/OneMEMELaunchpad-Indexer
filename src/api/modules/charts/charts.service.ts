import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { sql } from "../../db";

// TradingView resolution → seconds
const RESOLUTION_MAP: Record<string, number> = {
  "1":    60,
  "3":    180,
  "5":    300,
  "15":   900,
  "30":   1_800,
  "60":   3_600,
  "120":  7_200,
  "240":  14_400,
  "360":  21_600,
  "720":  43_200,
  "D":    86_400,
  "1D":   86_400,
  "W":    604_800,
  "1W":   604_800,
};

@Injectable()
export class ChartsService {

  /** GET /charts/config — TradingView UDF configuration (Advanced Charts widget only, not used by Lightweight Charts) */
  config() {
    return {
      supported_resolutions: ["1", "5", "15", "30", "60", "240", "D"],
      supports_group_request: false,
      supports_marks: false,
      supports_search: true,
      supports_timescale_marks: false,
    };
  }

  /** GET /charts/time — current server unix timestamp */
  time() {
    return Math.floor(Date.now() / 1000);
  }

  /** GET /charts/symbols?symbol=<tokenAddress> — symbol metadata (UDF/Advanced Charts only) */
  async symbols(symbolParam: string | undefined) {
    if (!symbolParam) throw new BadRequestException("symbol is required");

    const addr = symbolParam.toLowerCase();
    const rows = await sql`
      SELECT name, symbol, token_type, total_supply, created_at_timestamp
      FROM token
      WHERE id = ${addr}
      LIMIT 1
    `;
    const row = rows[0];

    if (!row) {
      return { s: "error", errmsg: "Symbol not found" };
    }

    return {
      name:                   row.name as string,
      ticker:                 row.symbol as string,
      description:            `${row.name as string} (${row.symbol as string}) — OneMEME ${row.token_type as string}`,
      type:                   "crypto",
      session:                "24x7",
      timezone:               "Etc/UTC",
      exchange:               "OneMEME",
      listed_exchange:        "OneMEME",
      format:                 "price",
      pricescale:             1_000_000_000,
      minmov:                 1,
      has_intraday:           true,
      has_daily:              true,
      has_weekly_and_monthly: false,
      supported_resolutions:  ["1", "5", "15", "30", "60", "240", "D"],
      volume_precision:       4,
      data_status:            "streaming",
    };
  }

  /**
   * GET /charts/history — OHLCV bars for TradingView Lightweight Charts
   *
   * Price is computed from the bonding-curve AMM formula using per-block snapshots:
   *   virtualLiquidity  = baseVirtualBNB + raisedBNB
   *   price (BNB/token) = virtualLiquidity² / (baseVirtualBNB × totalSupply)
   *   (all values in wei; units cancel to produce BNB/token directly)
   *
   * Within each resolution bucket:
   *   open   = AMM price at the first snapshot's openRaisedBNB
   *   close  = AMM price at the last snapshot's closeRaisedBNB
   *   high   = AMM price at the highest closeRaisedBNB in the bucket
   *   low    = AMM price at the lowest closeRaisedBNB in the bucket
   *   volume = sum of volumeBNB across all snapshots in the bucket (in BNB, not wei)
   *
   * Response shape:
   *   { bars: CandleBar[], migrated: boolean, nextTime?: number }
   *   bars is empty when no data exists in the requested range.
   *   nextTime is set (to the earliest available snapshot timestamp) when bars
   *   is empty and the token has not yet migrated, so the caller knows where
   *   to seek to find the first bar.
   */
  async history(query: Record<string, string | undefined>) {
    const symbol     = query["symbol"];
    const resolution = query["resolution"] ?? "60";
    const toRaw        = query["to"]        ? parseInt(query["to"],        10) : null;
    const countbackRaw = query["countback"] ? parseInt(query["countback"], 10) : null;
    const fromRaw      = query["from"]      ? parseInt(query["from"],      10) : null;

    if (!symbol) throw new BadRequestException("symbol is required");

    const resSecs = RESOLUTION_MAP[resolution];
    if (!resSecs) throw new BadRequestException(`Unsupported resolution: ${resolution}`);

    if (toRaw        !== null && isNaN(toRaw))        throw new BadRequestException("to must be a unix timestamp");
    if (countbackRaw !== null && isNaN(countbackRaw)) throw new BadRequestException("countback must be an integer");
    if (fromRaw      !== null && isNaN(fromRaw))      throw new BadRequestException("from must be a unix timestamp");

    const toTs      = toRaw       ?? Math.floor(Date.now() / 1000);
    const countback = countbackRaw ?? null;
    const fromTs    = fromRaw      ?? null;

    const addr = symbol.toLowerCase();

    const effectiveFrom = countback !== null
      ? toTs - countback * resSecs
      : (fromTs ?? toTs - 300 * resSecs);

    const [token] = await sql`
      SELECT migrated FROM token WHERE id = ${addr} LIMIT 1
    `;

    if (!token) throw new NotFoundException(`Token ${addr} not found`);

    // AMM formula computed entirely in SQL by joining the token row.
    // Bucket is computed in a subquery first so GROUP BY can reference the alias
    // without PostgreSQL rejecting the repeated parameterized expression.
    const rows = await sql`
      WITH raw AS (
        SELECT
          (floor(s.timestamp::numeric / ${resSecs}) * ${resSecs})::bigint AS bucket,
          s.open_raised_bnb::numeric   AS open_raised_bnb,
          s.close_raised_bnb::numeric  AS close_raised_bnb,
          s.volume_bnb::numeric        AS volume_bnb,
          s.block_number,
          t.virtual_bnb::numeric       AS v_bnb,
          t.total_supply::numeric      AS total_supply
        FROM token_snapshot s
        JOIN token t ON t.id = s.token
        WHERE
          s.token       = ${addr}
          AND s.timestamp >= ${effectiveFrom}
          AND s.timestamp <= ${toTs}
      ),
      buckets AS (
        SELECT
          bucket                                                                    AS t,
          (array_agg(open_raised_bnb  ORDER BY block_number ASC))[1]               AS open_raised,
          (array_agg(close_raised_bnb ORDER BY block_number DESC))[1]              AS close_raised,
          MAX(close_raised_bnb)                                                     AS high_raised,
          MIN(close_raised_bnb)                                                     AS low_raised,
          SUM(volume_bnb)                                                           AS v,
          MAX(v_bnb)                                                                AS v_bnb,
          MAX(total_supply)                                                         AS total_supply
        FROM raw
        GROUP BY bucket
        ORDER BY bucket ASC
      )
      SELECT
        t,
        (open_raised  + v_bnb)^2 / NULLIF(v_bnb * total_supply, 0)  AS o,
        (close_raised + v_bnb)^2 / NULLIF(v_bnb * total_supply, 0)  AS c,
        (high_raised  + v_bnb)^2 / NULLIF(v_bnb * total_supply, 0)  AS h,
        (low_raised   + v_bnb)^2 / NULLIF(v_bnb * total_supply, 0)  AS l,
        v
      FROM buckets
    `;

    if (rows.length === 0) {
      // No bars in the requested range — tell the caller where the bonding-curve
      // data starts so it can seek there. Applies to both active and migrated
      // tokens: migrated tokens still have all their pre-migration snapshots.
      const [earliest] = await sql`
        SELECT MIN(timestamp)::int AS ts FROM token_snapshot WHERE token = ${addr}
      `;
      const nextTime: number | undefined = earliest?.ts as number | undefined;
      return { bars: [], migrated: token.migrated as boolean, ...(nextTime !== undefined ? { nextTime } : {}) };
    }

    return {
      bars: rows
        .filter((r: any) => r.o !== null && r.c !== null && r.h !== null && r.l !== null)
        .map((r: any) => ({
          time:   Number(r.t),
          open:   parseFloat(r.o),
          high:   parseFloat(r.h),
          low:    parseFloat(r.l),
          close:  parseFloat(r.c),
          volume: parseFloat(r.v) / 1e18,   // wei → BNB
        })),
      migrated: token.migrated as boolean,
    };
  }

  /**
   * GET /charts/search?query=<addr>
   */
  async search(query: Record<string, string | undefined>) {
    const q        = (query["query"] ?? "").toLowerCase();
    const escaped  = q.replace(/[%_\\]/g, "\\$&");
    const limitRaw = parseInt(query["limit"] ?? "10", 10);
    const limit    = isNaN(limitRaw) ? 10 : Math.min(limitRaw, 30);

    const rows = await sql`
      SELECT id, name, symbol, token_type
      FROM token
      WHERE id LIKE ${escaped + "%"} ESCAPE '\\'
      ORDER BY created_at_timestamp DESC
      LIMIT ${limit}
    `;

    return rows.map((r: any) => ({
      symbol:      r.symbol,
      full_name:   `${r.name} (${r.symbol})`,
      description: `${r.name} — OneMEME ${r.token_type}`,
      exchange:    "OneMEME",
      ticker:      r.symbol,
      type:        "crypto",
    }));
  }
}
