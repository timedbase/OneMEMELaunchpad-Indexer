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
