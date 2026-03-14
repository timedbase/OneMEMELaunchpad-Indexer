import { Injectable } from "@nestjs/common";
import { sql } from "../../db";
import { paginated, parsePagination, parseOrderDir } from "../../helpers";

@Injectable()
export class DiscoverService {

  async trending(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);

    const windowRaw = parseInt(query["window"] ?? "1800", 10);
    const window    = Math.min(Math.max(isNaN(windowRaw) ? 1800 : windowRaw, 60), 86_400);
    const since     = Math.floor(Date.now() / 1000) - window;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          t.*,
          COUNT(tr.id)::int                                                        AS "recentTrades",
          COUNT(tr.id) FILTER (WHERE tr."tradeType" = 'buy')::int                 AS "recentBuys",
          COUNT(tr.id) FILTER (WHERE tr."tradeType" = 'sell')::int                AS "recentSells",
          COALESCE(SUM(tr."bnbAmount"::numeric), 0)::text                         AS "recentVolumeBNB"
        FROM token t
        INNER JOIN trade tr ON tr."token" = t.id
        WHERE tr."timestamp" >= ${since}
        GROUP BY t.id
        ORDER BY "recentTrades" DESC, "recentVolumeBNB"::numeric DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(DISTINCT tr."token")::int AS count
        FROM trade tr
        WHERE tr."timestamp" >= ${since}
      `,
    ]);

    return { ...paginated(rows, count, page, limit), window, since };
  }

  async newTokens(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type = query["type"];

    const typeFilter = type ? sql`AND "tokenType" = ${type}` : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM token WHERE "migrated" = FALSE ${typeFilter} ORDER BY "createdAtBlock"::numeric DESC LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM token WHERE "migrated" = FALSE ${typeFilter}`,
    ]);

    return paginated(rows, count, page, limit);
  }

  async bonding(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type  = query["type"];
    const since = Math.floor(Date.now() / 1000) - 86_400;

    const typeFilter = type ? sql`AND t."tokenType" = ${type}` : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          t.*,
          COALESCE(a."recentTrades",    0)    AS "recentTrades",
          COALESCE(a."recentVolumeBNB", '0')  AS "recentVolumeBNB"
        FROM token t
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int                   AS "recentTrades",
            SUM("bnbAmount"::numeric)::text AS "recentVolumeBNB"
          FROM trade
          WHERE "token" = t.id AND "timestamp" >= ${since}
        ) a ON TRUE
        WHERE t."migrated" = FALSE ${typeFilter}
        ORDER BY t."raisedBNB"::numeric DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(*)::int AS count FROM token t WHERE t."migrated" = FALSE ${typeFilter}`,
    ]);

    return paginated(rows, count, page, limit);
  }

  async migrated(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type     = query["type"];
    const orderDir = parseOrderDir(query);

    const ALLOWED_ORDER = ["migratedAt", "liquidityBNB", "volumeBNB"] as const;
    type AllowedOrder   = typeof ALLOWED_ORDER[number];
    const orderByRaw    = query["orderBy"] ?? "migratedAt";
    const orderBy: AllowedOrder = (ALLOWED_ORDER as readonly string[]).includes(orderByRaw)
      ? orderByRaw as AllowedOrder
      : "migratedAt";

    const typeFilter = type ? sql`AND t."tokenType" = ${type}` : sql``;
    const orderExpr  =
      orderBy === "migratedAt"   ? sql`m."blockNumber"::numeric`  :
      orderBy === "liquidityBNB" ? sql`m."liquidityBNB"::numeric` :
      /* volumeBNB */               sql`t."volumeBNB"::numeric`;
    const dirExpr = orderDir === "ASC" ? sql`ASC` : sql`DESC`;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          t.*,
          m."pair"            AS "pairAddress",
          m."liquidityBNB"    AS "liquidityBNB",
          m."liquidityTokens" AS "liquidityTokens",
          m."blockNumber"     AS "migratedAtBlock",
          m."timestamp"       AS "migratedAt",
          m."txHash"          AS "migrationTxHash"
        FROM token t
        INNER JOIN migration m ON m.id = t.id
        WHERE t."migrated" = TRUE ${typeFilter}
        ORDER BY ${orderExpr} ${dirExpr}
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(*)::int AS count FROM token t WHERE t."migrated" = TRUE ${typeFilter}`,
    ]);

    return paginated(rows, count, page, limit);
  }
}
