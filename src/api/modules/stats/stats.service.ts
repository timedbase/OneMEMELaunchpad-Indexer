import { Injectable } from "@nestjs/common";
import { sql } from "../../db";

@Injectable()
export class StatsService {
  async platform() {
    const [
      tokenStats,
      tradeStats,
      traderStats,
      topTokenRows,
      migrationStats,
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
      sql`SELECT "id", "tokenType", "creator", "volumeBNB", "buyCount", "sellCount", "migrated" FROM token ORDER BY "volumeBNB"::numeric DESC LIMIT 1`,
      sql`SELECT COALESCE(SUM("liquidityBNB"::numeric), 0)::text AS "totalLiquidityBNB" FROM migration`,
    ]);

    const tokens     = tokenStats[0];
    const trades     = tradeStats[0];
    const traders    = traderStats[0];
    const topToken   = topTokenRows[0]   ?? null;
    const migration  = migrationStats[0] ?? null;

    return {
      data: {
        totalTokens:    tokens?.totalTokens    ?? 0,
        migratedTokens: tokens?.migratedTokens ?? 0,
        activeTokens:   tokens?.activeTokens   ?? 0,
        tokensByType: {
          Standard:   tokens?.standardTokens   ?? 0,
          Tax:        tokens?.taxTokens         ?? 0,
          Reflection: tokens?.reflectionTokens  ?? 0,
        },
        totalTrades:       trades?.totalTrades       ?? 0,
        totalBuys:         trades?.totalBuys          ?? 0,
        totalSells:        trades?.totalSells         ?? 0,
        uniqueTraders:     traders?.uniqueTraders     ?? 0,
        totalVolumeBNB:    tokens?.totalVolumeBNB     ?? "0",
        totalLiquidityBNB: migration?.totalLiquidityBNB ?? "0",
        topTokenByVolume:  topToken,
      },
    };
  }
}
