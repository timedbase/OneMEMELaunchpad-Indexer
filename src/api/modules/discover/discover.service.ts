import { Injectable } from "@nestjs/common";
import { sql } from "../../db";
import { paginated, parsePagination, parseOrderDir, toCamel } from "../../helpers";
import { PriceService } from "../price/price.service";

const PRICE_COLS = sql`
  CASE
    WHEN t.migrated
      THEN (m.liquidity_bnb::numeric / NULLIF(m.liquidity_tokens::numeric, 0))::text
    ELSE ((t.virtual_bnb::numeric + t.raised_bnb::numeric)^2
          / NULLIF(t.virtual_bnb::numeric * t.total_supply::numeric, 0))::text
  END AS price_bnb,
  CASE
    WHEN t.migrated
      THEN (m.liquidity_bnb::numeric * t.total_supply::numeric
            / NULLIF(m.liquidity_tokens::numeric, 0) / 1e18)::text
    ELSE ((t.virtual_bnb::numeric + t.raised_bnb::numeric)^2
          / NULLIF(t.virtual_bnb::numeric, 0) / 1e18)::text
  END AS market_cap_bnb
`;

@Injectable()
export class DiscoverService {
  constructor(private readonly price: PriceService) {}

  private withUsd<T extends Record<string, unknown>>(
    row: T,
  ): T & { priceUsd: string | null; marketCapUsd: string | null } {
    const bnbPrice = this.price.getPrice()?.bnbUsdt ?? null;
    const priceBnb = row["priceBnb"]     as string | null;
    const mcBnb    = row["marketCapBnb"] as string | null;
    const priceUsd = (bnbPrice !== null && priceBnb !== null)
      ? (parseFloat(priceBnb) * bnbPrice).toFixed(10)
      : null;
    const mcUsd = (bnbPrice !== null && mcBnb !== null)
      ? (parseFloat(mcBnb) * bnbPrice).toFixed(2)
      : null;
    return { ...row, priceUsd, marketCapUsd: mcUsd };
  }

  async trending(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type  = query["type"];
    const since = Math.floor(Date.now() / 1000) - 300;

    const typeFilter = type ? sql`AND t.token_type = ${type}` : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          t.*,
          ${PRICE_COLS},
          COUNT(tr.id)::int                                                        AS "recentTrades",
          COUNT(tr.id) FILTER (WHERE tr.trade_type = 'buy')::int                  AS "recentBuys",
          COUNT(tr.id) FILTER (WHERE tr.trade_type = 'sell')::int                 AS "recentSells",
          COALESCE(SUM(tr.bnb_amount::numeric), 0)::text                          AS "recentVolumeBNB"
        FROM token t
        INNER JOIN trade tr ON tr.token = t.id
        LEFT JOIN migration m ON m.id = t.id
        WHERE tr.timestamp >= ${since} ${typeFilter}
        GROUP BY t.id, m.liquidity_bnb, m.liquidity_tokens
        ORDER BY "recentTrades" DESC, "recentVolumeBNB"::numeric DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(DISTINCT tr.token)::int AS count
        FROM trade tr
        JOIN token t ON t.id = tr.token
        WHERE tr.timestamp >= ${since} ${typeFilter}
      `,
    ]);

    return paginated(rows.map(r => this.withUsd(toCamel(r))), count, page, limit);
  }

  async newTokens(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type = query["type"];

    const typeFilter = type ? sql`AND t.token_type = ${type}` : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT t.*, ${PRICE_COLS}
        FROM token t
        LEFT JOIN migration m ON m.id = t.id
        WHERE t.migrated = FALSE ${typeFilter}
        ORDER BY t.created_at_block::numeric DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(*)::int AS count FROM token WHERE migrated = FALSE ${typeFilter}`,
    ]);

    return paginated(rows.map(r => this.withUsd(toCamel(r))), count, page, limit);
  }

  async bonding(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type  = query["type"];
    const since = Math.floor(Date.now() / 1000) - 86_400;

    const typeFilter = type ? sql`AND t.token_type = ${type}` : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          t.*,
          ${PRICE_COLS},
          COALESCE(a."recentTrades",    0)    AS "recentTrades",
          COALESCE(a."recentVolumeBNB", '0')  AS "recentVolumeBNB"
        FROM token t
        LEFT JOIN migration m ON m.id = t.id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int                    AS "recentTrades",
            SUM(bnb_amount::numeric)::text   AS "recentVolumeBNB"
          FROM trade
          WHERE token = t.id AND timestamp >= ${since}
        ) a ON TRUE
        WHERE t.migrated = FALSE ${typeFilter}
        ORDER BY t.raised_bnb::numeric DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(*)::int AS count FROM token t WHERE t.migrated = FALSE ${typeFilter}`,
    ]);

    return paginated(rows.map(r => this.withUsd(toCamel(r))), count, page, limit);
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

    const typeFilter = type ? sql`AND t.token_type = ${type}` : sql``;
    const orderExpr  =
      orderBy === "migratedAt"   ? sql`m.block_number::numeric`  :
      orderBy === "liquidityBNB" ? sql`m.liquidity_bnb::numeric` :
      /* volumeBNB */               sql`t.volume_bnb::numeric`;
    const dirExpr = orderDir === "ASC" ? sql`ASC` : sql`DESC`;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          t.*,
          ${PRICE_COLS},
          m.pair                        AS "pairAddress",
          m.liquidity_bnb::text         AS "liquidityBNB",
          m.liquidity_tokens::text      AS "liquidityTokens",
          m.block_number                AS "migratedAtBlock",
          m.timestamp                   AS "migratedAt",
          m.tx_hash                     AS "migrationTxHash"
        FROM token t
        INNER JOIN migration m ON m.id = t.id
        WHERE t.migrated = TRUE ${typeFilter}
        ORDER BY ${orderExpr} ${dirExpr}
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(*)::int AS count FROM token t WHERE t.migrated = TRUE ${typeFilter}`,
    ]);

    return paginated(rows.map(r => this.withUsd(toCamel(r))), count, page, limit);
  }
}
