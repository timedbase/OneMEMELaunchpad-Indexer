/**
 * Stats routes
 *
 * GET /stats    Platform-wide aggregated statistics
 */

import { Hono } from "hono";
import { sql } from "../db";
import { serverError } from "../helpers";

const app = new Hono();

/**
 * GET /stats
 *
 * Returns aggregated platform-wide statistics computed directly from the
 * indexed data. All BNB amounts are returned as strings to preserve uint256
 * precision.
 *
 * Response fields:
 *   totalTokens        int     Total meme tokens ever launched
 *   migratedTokens     int     Tokens that graduated to PancakeSwap
 *   activeTokens       int     Tokens still on the bonding curve
 *   tokensByType       object  { Standard, Tax, Reflection } counts
 *   totalTrades        int     All buy + sell transactions
 *   totalBuys          int     Buy transactions only
 *   totalSells         int     Sell transactions only
 *   uniqueTraders      int     Distinct wallet addresses that have traded
 *   totalVolumeBNB     string  Sum of all BNB traded on the bonding curve (wei)
 *   totalLiquidityBNB  string  Sum of BNB locked as permanent LP on PancakeSwap (wei)
 *   latestTwap         object  Most recent TWAP reading (priceAvg, blockNumber, timestamp)
 *   topTokenByVolume   object  Token with the highest bonding-curve volume
 */
app.get("/", async (c) => {
  try {
    const [
      tokenStats,
      tradeStats,
      [{ uniqueTraders }],
      [latestTwap],
      [topToken],
      [migrationStats],
    ] = await Promise.all([
      // Token counts grouped by migrated status and type
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

      // Trade counts
      sql`
        SELECT
          COUNT(*)::int                                            AS "totalTrades",
          COUNT(*) FILTER (WHERE "tradeType" = 'buy')::int        AS "totalBuys",
          COUNT(*) FILTER (WHERE "tradeType" = 'sell')::int       AS "totalSells"
        FROM trade
      `,

      // Unique traders
      sql`SELECT COUNT(DISTINCT "trader")::int AS "uniqueTraders" FROM trade`,

      // Latest TWAP
      sql`
        SELECT "priceAvg", "priceBlockNumber", "blockNumber", "timestamp"
        FROM twap_update
        ORDER BY "blockNumber"::numeric DESC
        LIMIT 1
      `,

      // Top token by bonding-curve volume
      sql`
        SELECT "id", "tokenType", "creator", "volumeBNB", "buyCount", "sellCount", "migrated"
        FROM token
        ORDER BY "volumeBNB"::numeric DESC
        LIMIT 1
      `,

      // Total permanent liquidity locked in PancakeSwap migrations
      sql`
        SELECT COALESCE(SUM("liquidityBNB"::numeric), 0)::text AS "totalLiquidityBNB"
        FROM migration
      `,
    ]);

    return c.json({
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
        latestTwap:        latestTwap ?? null,
        topTokenByVolume:  topToken ?? null,
      },
    });
  } catch (err) {
    return serverError(c, err);
  }
});

export default app;
