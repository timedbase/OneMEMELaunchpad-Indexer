import { Injectable } from "@nestjs/common";
import { sql } from "../../db";

@Injectable()
export class StatsService {
  async platform() {
    const [
      tokenStats,
      tradeStats,
      [{ uniqueTraders }],
      [latestTwap],
      [topToken],
      [migrationStats],
    ] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int                                                        AS "totalTokens",
          COUNT(*) FILTER (WHERE "migrated" = TRUE)::int                      AS "migratedTokens",
          COUNT(*) FILTER (WHERE "migrated" = FALSE)::int                     AS "activeTokens",
          COUNT(*) FILTER (WHERE "tokenType" = 'Standard')::int               AS "standardTokens",
          COUNT(*) FILTER (WHERE "tokenType" = 'Tax')::int                    AS "taxTokens",
          COUNT(*) FILTER (WHERE "tokenType" = 'Reflection')::int             AS "reflectionTokens",
          COALESCE(SUM("volumeBNB"::numeric), 0)::text                        AS "totalVolumeBNB"
        FROM token
      `,
      sql`
        SELECT
          COUNT(*)::int                                            AS "totalTrades",
          COUNT(*) FILTER (WHERE "tradeType" = 'buy')::int        AS "totalBuys",
          COUNT(*) FILTER (WHERE "tradeType" = 'sell')::int       AS "totalSells"
        FROM trade
      `,
      sql`SELECT COUNT(DISTINCT "trader")::int AS "uniqueTraders" FROM trade`,
      sql`SELECT "priceAvg", "priceBlockNumber", "blockNumber", "timestamp" FROM twap_update ORDER BY "blockNumber"::numeric DESC LIMIT 1`,
      sql`SELECT "id", "tokenType", "creator", "volumeBNB", "buyCount", "sellCount", "migrated" FROM token ORDER BY "volumeBNB"::numeric DESC LIMIT 1`,
      sql`SELECT COALESCE(SUM("liquidityBNB"::numeric), 0)::text AS "totalLiquidityBNB" FROM migration`,
    ]);

    return {
      data: {
        totalTokens:    tokenStats[0].totalTokens,
        migratedTokens: tokenStats[0].migratedTokens,
        activeTokens:   tokenStats[0].activeTokens,
        tokensByType: {
          Standard:   tokenStats[0].standardTokens,
          Tax:        tokenStats[0].taxTokens,
          Reflection: tokenStats[0].reflectionTokens,
        },
        totalTrades:       tradeStats[0].totalTrades,
        totalBuys:         tradeStats[0].totalBuys,
        totalSells:        tradeStats[0].totalSells,
        uniqueTraders,
        totalVolumeBNB:    tokenStats[0].totalVolumeBNB,
        totalLiquidityBNB: migrationStats?.totalLiquidityBNB ?? "0",
        latestTwap:        latestTwap  ?? null,
        topTokenByVolume:  topToken    ?? null,
      },
    };
  }
}
