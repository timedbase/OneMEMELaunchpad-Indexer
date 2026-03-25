import { Injectable, BadRequestException } from "@nestjs/common";
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

  /** GET /charts/config — TradingView UDF configuration */
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

  /** GET /charts/symbols?symbol=<tokenAddress> — symbol metadata */
  async symbols(symbolParam: string | undefined) {
    if (!symbolParam) throw new BadRequestException("symbol is required");

    const addr = symbolParam.toLowerCase();
    const rows = await sql`
      SELECT token_type, total_supply, created_at_timestamp
      FROM token
      WHERE id = ${addr}
      LIMIT 1
    `;
    const row = rows[0];

    if (!row) {
      return { s: "error", errmsg: "Symbol not found" };
    }

    return {
      name:                   addr,
      ticker:                 addr,
      description:            `OneMEME Token (${row.token_type})`,
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
   * GET /charts/history — OHLCV bars
   *
   * Price is computed from the bonding-curve AMM formula using per-block snapshots:
   *   price = (virtualBNB + raisedBNB)^2 / (virtualBNB * totalSupply)
   *
   * Within each resolution bucket:
   *   open  = AMM price at openRaisedBNB of the first snapshot in the bucket
   *   close = AMM price at closeRaisedBNB of the last snapshot in the bucket
   *   high  = AMM price at max(closeRaisedBNB) in the bucket
   *   low   = AMM price at min(closeRaisedBNB) in the bucket
   *   volume= sum of volumeBNB across all snapshots in the bucket
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

    if (!token) return { s: "error", errmsg: "Symbol not found" };

    // AMM formula computed entirely in SQL by joining the token row.
    // Avoids passing JS bigint values as postgres.js parameters (unsupported type).
    const rows = await sql`
      WITH buckets AS (
        SELECT
          (floor(s.timestamp::numeric / ${resSecs}) * ${resSecs})::bigint       AS t,
          (array_agg(s.open_raised_bnb::numeric  ORDER BY s.block_number ASC))[1]  AS open_raised,
          (array_agg(s.close_raised_bnb::numeric ORDER BY s.block_number DESC))[1] AS close_raised,
          MAX(s.close_raised_bnb::numeric)                                          AS high_raised,
          MIN(s.close_raised_bnb::numeric)                                          AS low_raised,
          SUM(s.volume_bnb::numeric)                                                AS v,
          MAX(t.virtual_bnb::numeric)                                               AS v_bnb,
          MAX(t.total_supply::numeric)                                              AS total_supply
        FROM token_snapshot s
        JOIN token t ON t.id = s.token
        WHERE
          s.token       = ${addr}
          AND s.timestamp >= ${effectiveFrom}
          AND s.timestamp <= ${toTs}
        GROUP BY floor(s.timestamp::numeric / ${resSecs}) * ${resSecs}
        ORDER BY t ASC
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

    if (rows.length === 0) return { s: "no_data" };

    return {
      s: "ok",
      t: rows.map((r: any) => Number(r.t)),
      o: rows.map((r: any) => r.o),
      h: rows.map((r: any) => r.h),
      l: rows.map((r: any) => r.l),
      c: rows.map((r: any) => r.c),
      v: rows.map((r: any) => r.v),
    };
  }

  /**
   * GET /charts/search?query=<addr>
   */
  async search(query: Record<string, string | undefined>) {
    const q        = (query["query"] ?? "").toLowerCase();
    const limitRaw = parseInt(query["limit"] ?? "10", 10);
    const limit    = isNaN(limitRaw) ? 10 : Math.min(limitRaw, 30);

    const rows = await sql`
      SELECT id, token_type
      FROM token
      WHERE id LIKE ${q} || '%'
      ORDER BY created_at_timestamp DESC
      LIMIT ${limit}
    `;

    return rows.map((r: any) => ({
      symbol:      r.id,
      full_name:   r.id,
      description: `OneMEME Token (${r.token_type})`,
      exchange:    "OneMEME",
      ticker:      r.id,
      type:        "crypto",
    }));
  }
}
