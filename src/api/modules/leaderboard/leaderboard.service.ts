import { Injectable, BadRequestException } from "@nestjs/common";
import { sql } from "../../db";
import { paginated, parsePagination } from "../../helpers";

const PERIODS = {
  "1d":    86_400,
  "7d":    86_400 * 7,
  "30d":   86_400 * 30,
  "alltime": null,
} as const;

type Period = keyof typeof PERIODS;

@Injectable()
export class LeaderboardService {

  async tokens(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);

    const periodKey = (query["period"] ?? "alltime") as Period;
    if (!(periodKey in PERIODS)) {
      throw new BadRequestException(`Invalid period. Allowed: ${Object.keys(PERIODS).join(", ")}`);
    }

    const orderBy = query["orderBy"] ?? "volumeBNB";
    const allowed = ["volumeBNB", "tradeCount", "buyCount", "sellCount", "raisedBNB"];
    if (!allowed.includes(orderBy)) {
      throw new BadRequestException(`Invalid orderBy. Allowed: ${allowed.join(", ")}`);
    }

    const windowSecs = PERIODS[periodKey];
    const sinceTs    = windowSecs ? Math.floor(Date.now() / 1000) - windowSecs : null;
    const timeSql    = sinceTs !== null ? sql`AND t.timestamp >= ${sinceTs}` : sql``;

    const orderCol = orderBy === "volumeBNB"  ? sql`SUM(t.bnb_amount::numeric) DESC`
                   : orderBy === "tradeCount" ? sql`COUNT(*)::int DESC`
                   : orderBy === "buyCount"   ? sql`COUNT(*) FILTER (WHERE t.trade_type = 'buy')::int DESC`
                   : orderBy === "sellCount"  ? sql`COUNT(*) FILTER (WHERE t.trade_type = 'sell')::int DESC`
                   :                           sql`MAX(tk.raised_bnb::numeric) DESC`;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          tk.id                                                             AS address,
          tk.token_type                                                     AS "tokenType",
          tk.creator,
          tk.migrated,
          SUM(t.bnb_amount::numeric)                                        AS "volumeBNB",
          COUNT(*)::int                                                     AS "tradeCount",
          COUNT(*) FILTER (WHERE t.trade_type = 'buy')::int                AS "buyCount",
          COUNT(*) FILTER (WHERE t.trade_type = 'sell')::int               AS "sellCount",
          COUNT(DISTINCT t.trader)::int                                     AS "uniqueTraders",
          tk.raised_bnb                                                     AS "raisedBNB",
          tk.created_at_timestamp                                           AS "createdAt"
        FROM token tk
        LEFT JOIN trade t ON t.token = tk.id
        WHERE TRUE ${timeSql}
        GROUP BY tk.id
        ORDER BY ${orderCol}
        LIMIT ${limit} OFFSET ${offset}
      `,
      sinceTs !== null
        ? sql`SELECT COUNT(DISTINCT token)::int AS count FROM trade WHERE timestamp >= ${sinceTs}`
        : sql`SELECT COUNT(*)::int AS count FROM token`,
    ]);

    return {
      ...paginated(rows, count, page, limit),
      period: periodKey,
      orderBy,
    };
  }

  async creators(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);

    const periodKey = (query["period"] ?? "alltime") as Period;
    if (!(periodKey in PERIODS)) {
      throw new BadRequestException(`Invalid period. Allowed: ${Object.keys(PERIODS).join(", ")}`);
    }

    const windowSecs = PERIODS[periodKey];
    const sinceTs    = windowSecs ? Math.floor(Date.now() / 1000) - windowSecs : null;
    const timeSql    = sinceTs !== null ? sql`AND tk.created_at_timestamp >= ${sinceTs}` : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          tk.creator                                                        AS address,
          COUNT(*)::int                                                     AS "tokensLaunched",
          COUNT(*) FILTER (WHERE tk.migrated = true)::int                  AS "tokensMigrated",
          SUM(tr.bnb_amount::numeric)                                       AS "totalVolumeBNB",
          SUM(tk.raised_bnb::numeric)                                       AS "totalRaisedBNB",
          MAX(tk.created_at_timestamp)                                      AS "lastLaunchAt"
        FROM token tk
        LEFT JOIN trade tr ON tr.token = tk.id
        WHERE TRUE ${timeSql}
        GROUP BY tk.creator
        ORDER BY COUNT(*) DESC, SUM(tk.raised_bnb::numeric) DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(DISTINCT creator)::int AS count FROM token WHERE TRUE ${timeSql}`,
    ]);

    return {
      ...paginated(rows, count, page, limit),
      period: periodKey,
    };
  }

  async users(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);

    const periodKey = (query["period"] ?? "alltime") as Period;
    if (!(periodKey in PERIODS)) {
      throw new BadRequestException(`Invalid period. Allowed: ${Object.keys(PERIODS).join(", ")}`);
    }

    const windowSecs = PERIODS[periodKey];
    const sinceTs    = windowSecs ? Math.floor(Date.now() / 1000) - windowSecs : null;
    const tradeSql   = sinceTs !== null ? sql`AND t.timestamp >= ${sinceTs}` : sql``;
    const createSql  = sinceTs !== null ? sql`AND tk.created_at_timestamp >= ${sinceTs}` : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        WITH trader_stats AS (
          SELECT
            trader                                          AS address,
            SUM(bnb_amount::numeric)                        AS "volumeBNB",
            COUNT(*)::int                                   AS "tradeCount",
            COUNT(*) FILTER (WHERE trade_type = 'buy')::int AS "buyCount",
            COUNT(*) FILTER (WHERE trade_type = 'sell')::int AS "sellCount",
            COUNT(DISTINCT token)::int                      AS "tokensTraded",
            MAX(timestamp)                                  AS "lastTradeAt"
          FROM trade t
          WHERE TRUE ${tradeSql}
          GROUP BY trader
        ),
        creator_stats AS (
          SELECT
            creator                                         AS address,
            COUNT(*)::int                                   AS "tokensLaunched",
            COUNT(*) FILTER (WHERE migrated = true)::int   AS "tokensMigrated",
            SUM(raised_bnb::numeric)                        AS "totalRaisedBNB"
          FROM token tk
          WHERE TRUE ${createSql}
          GROUP BY creator
        ),
        combined AS (
          SELECT COALESCE(tr.address, cr.address)          AS address,
            COALESCE(tr."volumeBNB", 0)                    AS "volumeBNB",
            COALESCE(tr."tradeCount", 0)                   AS "tradeCount",
            COALESCE(tr."buyCount", 0)                     AS "buyCount",
            COALESCE(tr."sellCount", 0)                    AS "sellCount",
            COALESCE(tr."tokensTraded", 0)                 AS "tokensTraded",
            tr."lastTradeAt",
            COALESCE(cr."tokensLaunched", 0)               AS "tokensLaunched",
            COALESCE(cr."tokensMigrated", 0)               AS "tokensMigrated",
            COALESCE(cr."totalRaisedBNB", 0)               AS "totalRaisedBNB"
          FROM trader_stats tr
          FULL OUTER JOIN creator_stats cr ON cr.address = tr.address
        )
        SELECT * FROM combined
        ORDER BY "volumeBNB" DESC, "tokensLaunched" DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(DISTINCT address)::int AS count FROM (
          SELECT trader AS address FROM trade
          UNION
          SELECT creator AS address FROM token
        ) u
      `,
    ]);

    return {
      ...paginated(rows, count, page, limit),
      period: periodKey,
    };
  }

  async traders(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);

    const periodKey = (query["period"] ?? "alltime") as Period;
    if (!(periodKey in PERIODS)) {
      throw new BadRequestException(
        `Invalid period. Allowed: ${Object.keys(PERIODS).join(", ")}`
      );
    }

    const windowSecs = PERIODS[periodKey];
    const sinceTs    = windowSecs ? Math.floor(Date.now() / 1000) - windowSecs : null;
    const timeSql    = sinceTs !== null ? sql`AND timestamp >= ${sinceTs}` : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          trader                                                            AS address,
          SUM(bnb_amount::numeric)                                          AS "volumeBNB",
          COUNT(*)::int                                                     AS "tradeCount",
          COUNT(*) FILTER (WHERE trade_type = 'buy')::int                  AS "buyCount",
          COUNT(*) FILTER (WHERE trade_type = 'sell')::int                 AS "sellCount",
          COUNT(DISTINCT token)::int                                        AS "tokensTraded",
          MAX(timestamp)                                                    AS "lastTradeAt"
        FROM trade
        WHERE TRUE ${timeSql}
        GROUP BY trader
        ORDER BY SUM(bnb_amount::numeric) DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(DISTINCT trader)::int AS count
        FROM trade
        WHERE TRUE ${timeSql}
      `,
    ]);

    return {
      ...paginated(rows, count, page, limit),
      period: periodKey,
    };
  }
}
