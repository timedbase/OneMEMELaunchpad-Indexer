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
    const [rows] = await sql`
      SELECT "tokenType", "totalSupply", "createdAtTimestamp"
      FROM token
      WHERE id = ${addr}
      LIMIT 1
    `;

    if (!rows) {
      return { s: "error", errmsg: "Symbol not found" };
    }

    return {
      name:                   addr,
      ticker:                 addr,
      description:            `OneMEME Token (${rows.tokenType})`,
      type:                   "crypto",
      session:                "24x7",
      timezone:               "Etc/UTC",
      exchange:               "OneMEME",
      listed_exchange:        "OneMEME",
      format:                 "price",
      pricescale:             1_000_000_000, // 9 decimal places (BNB-denominated meme prices)
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
   * Query params (TradingView UDF spec):
   *   symbol      token address
   *   resolution  "1" | "5" | "15" | "30" | "60" | "240" | "D"
   *   from        unix timestamp (start)
   *   to          unix timestamp (end)
   *   countback   number of bars to return (used instead of `from` by TV)
   *
   * Returns: { s, t, o, h, l, c, v }
   */
  async history(query: Record<string, string | undefined>) {
    const symbol     = query["symbol"];
    const resolution = query["resolution"] ?? "60";
    const toRaw       = query["to"]        ? parseInt(query["to"],        10) : null;
    const countbackRaw = query["countback"] ? parseInt(query["countback"], 10) : null;
    const fromRaw      = query["from"]      ? parseInt(query["from"],      10) : null;

    if (!symbol) throw new BadRequestException("symbol is required");

    const resSecs = RESOLUTION_MAP[resolution];
    if (!resSecs) throw new BadRequestException(`Unsupported resolution: ${resolution}`);

    if (toRaw       !== null && isNaN(toRaw))       throw new BadRequestException("to must be a unix timestamp");
    if (countbackRaw !== null && isNaN(countbackRaw)) throw new BadRequestException("countback must be an integer");
    if (fromRaw      !== null && isNaN(fromRaw))     throw new BadRequestException("from must be a unix timestamp");

    const toTs      = toRaw       ?? Math.floor(Date.now() / 1000);
    const countback = countbackRaw ?? null;
    const fromTs    = fromRaw      ?? null;

    const addr = symbol.toLowerCase();

    // Derive `from` from countback if provided (TV sends countback instead of from)
    const effectiveFrom = countback !== null
      ? toTs - countback * resSecs
      : (fromTs ?? toTs - 300 * resSecs); // default: 300 bars back

    const rows = await sql`
      SELECT
        (floor("timestamp"::numeric / ${resSecs}) * ${resSecs})::bigint       AS t,
        (array_agg(
          "bnbAmount"::numeric / NULLIF("tokenAmount"::numeric, 0)
          ORDER BY "timestamp" ASC
        ))[1]                                                                  AS o,
        MAX("bnbAmount"::numeric / NULLIF("tokenAmount"::numeric, 0))          AS h,
        MIN("bnbAmount"::numeric / NULLIF("tokenAmount"::numeric, 0))          AS l,
        (array_agg(
          "bnbAmount"::numeric / NULLIF("tokenAmount"::numeric, 0)
          ORDER BY "timestamp" DESC
        ))[1]                                                                  AS c,
        SUM("bnbAmount"::numeric)                                              AS v
      FROM trade
      WHERE
        "token"     = ${addr}
        AND "timestamp" >= ${effectiveFrom}
        AND "timestamp" <= ${toTs}
      GROUP BY floor("timestamp"::numeric / ${resSecs}) * ${resSecs}
      ORDER BY t ASC
    `;

    // Fetch token state to check migration
    const [token] = await sql`
      SELECT "migrated" FROM token WHERE id = ${addr} LIMIT 1
    `;

    if (!token) return { s: "error", errmsg: "Symbol not found" };

    // Migrated tokens have no bonding-curve chart — return blank
    if (token.migrated) return { s: "no_data" };

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
   * GET /charts/search?query=<addr>&type=&exchange=&limit=
   * Basic symbol search — returns tokens whose address starts with the query string.
   */
  async search(query: Record<string, string | undefined>) {
    const q     = (query["query"] ?? "").toLowerCase();
    const limitRaw = parseInt(query["limit"] ?? "10", 10);
    const limit    = isNaN(limitRaw) ? 10 : Math.min(limitRaw, 30);

    const rows = await sql`
      SELECT id, "tokenType"
      FROM token
      WHERE id LIKE ${q} || '%'
      ORDER BY "createdAtTimestamp" DESC
      LIMIT ${limit}
    `;

    return rows.map((r: any) => ({
      symbol:          r.id,
      full_name:       r.id,
      description:     `OneMEME Token (${r.tokenType})`,
      exchange:        "OneMEME",
      ticker:          r.id,
      type:            "crypto",
    }));
  }
}
