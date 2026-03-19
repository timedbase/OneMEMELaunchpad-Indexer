import { Injectable } from "@nestjs/common";
import { sql } from "../../db";
import { toCamel } from "../../helpers";

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
          COUNT(*) FILTER (WHERE migrated = TRUE)::int                        AS "migratedTokens",
          COUNT(*) FILTER (WHERE migrated = FALSE)::int                       AS "activeTokens",
          COUNT(*) FILTER (WHERE token_type = 'Standard')::int                AS "standardTokens",
          COUNT(*) FILTER (WHERE token_type = 'Tax')::int                     AS "taxTokens",
          COUNT(*) FILTER (WHERE token_type = 'Reflection')::int              AS "reflectionTokens",
          COALESCE(SUM(volume_bnb::numeric), 0)::text                         AS "totalVolumeBNB"
        FROM token
      `,
      sql`
        SELECT
          COUNT(*)::int                                             AS "totalTrades",
          COUNT(*) FILTER (WHERE trade_type = 'buy')::int          AS "totalBuys",
          COUNT(*) FILTER (WHERE trade_type = 'sell')::int         AS "totalSells"
        FROM trade
      `,
      sql`SELECT COUNT(DISTINCT trader)::int AS "uniqueTraders" FROM trade`,
      sql`SELECT id, token_type AS "tokenType", creator, volume_bnb AS "volumeBNB", buy_count AS "buyCount", sell_count AS "sellCount", migrated FROM token ORDER BY volume_bnb::numeric DESC LIMIT 1`,
      sql`SELECT COALESCE(SUM(liquidity_bnb::numeric), 0)::text AS "totalLiquidityBNB" FROM migration`,
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
