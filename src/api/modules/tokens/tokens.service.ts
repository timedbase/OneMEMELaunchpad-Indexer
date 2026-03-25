import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { sql } from "../../db";
import { isAddress, normalizeAddress, paginated, parsePagination, parseOrderBy, parseOrderDir, toCamel } from "../../helpers";
import { getMetaURI, getPairPrice } from "../../rpc";
import { fetchMetadata } from "../../metadata";
import { PriceService } from "../price/price.service";

/**
 * Computed price columns — requires token alias `t` and migration LEFT JOIN alias `m`.
 *
 * Bonding curve tokens: constant-product AMM formula from virtualBNB/raisedBNB/totalSupply.
 * Migrated tokens:      migration-time liquidity (liquidity_bnb / liquidity_tokens).
 *                       findOne() overrides this with a live PancakeSwap getReserves() call.
 */
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
export class TokensService {
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

  async list(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type     = query["type"];
    const migrated = query["migrated"];

    const ALLOWED_ORDER = ["created_at_block", "volume_bnb", "buy_count", "sell_count", "raised_bnb", "total_supply"] as const;
    const orderBy  = parseOrderBy(query, ALLOWED_ORDER, "created_at_block");
    const orderDir = parseOrderDir(query);

    const migratedFilter =
      migrated === "true"  ? sql`AND t.migrated = TRUE`  :
      migrated === "false" ? sql`AND t.migrated = FALSE` :
      sql``;

    const typeFilter = type ? sql`AND t.token_type = ${type}` : sql``;

    const ALLOWED_TYPES = new Set(["Standard", "Tax", "Reflection"]);
    if (type && !ALLOWED_TYPES.has(type)) {
      throw new BadRequestException(`Invalid type "${type}". Must be Standard, Tax, or Reflection.`);
    }

    const numericCols = new Set(["volume_bnb", "raised_bnb", "created_at_block", "trading_block", "total_supply"]);
    const orderExpr   = numericCols.has(orderBy)
      ? sql`ORDER BY ${sql([orderBy])}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`
      : sql`ORDER BY ${sql([orderBy])} ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`;

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT t.*, ${PRICE_COLS} FROM token t LEFT JOIN migration m ON m.id = t.id WHERE TRUE ${typeFilter} ${migratedFilter} ${orderExpr} LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM token WHERE TRUE ${typeFilter} ${migratedFilter}`,
    ]);

    return paginated(rows.map(r => this.withUsd(toCamel(r))), count, page, limit);
  }

  async findOne(address: string) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const addr = normalizeAddress(address);
    const [row] = await sql`SELECT t.*, ${PRICE_COLS} FROM token t LEFT JOIN migration m ON m.id = t.id WHERE t.id = ${addr}`;
    if (!row) throw new NotFoundException(`Token ${address} not found`);

    const camelRow = toCamel(row);

    // Override with live PancakeSwap price for migrated tokens.
    if (camelRow.migrated && camelRow.pairAddress) {
      const live = await getPairPrice(
        camelRow.pairAddress  as `0x${string}`,
        addr                  as `0x${string}`,
        BigInt(camelRow.totalSupply as string),
      );
      if (live) {
        camelRow.priceBnb     = live.priceBnb;
        camelRow.marketCapBnb = live.marketCapBnb;
      }
    }

    const metaURI  = await getMetaURI(addr as `0x${string}`);
    const metadata = metaURI ? await fetchMetadata(metaURI) : null;

    return { data: { ...this.withUsd(camelRow), metaURI: metaURI || null, metadata: metadata ?? null } };
  }

  async trades(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const { page, limit, offset } = parsePagination(query);
    const type = query["type"];
    const from = query["from"];
    const to   = query["to"];

    const ALLOWED_ORDER = ["timestamp", "bnb_amount", "token_amount", "block_number"] as const;
    const orderBy  = parseOrderBy(query, ALLOWED_ORDER, "timestamp");
    const orderDir = parseOrderDir(query);

    const fromInt = from ? parseInt(from, 10) : null;
    const toInt   = to   ? parseInt(to,   10) : null;
    if (fromInt !== null && isNaN(fromInt)) throw new BadRequestException("from must be a unix timestamp");
    if (toInt   !== null && isNaN(toInt))   throw new BadRequestException("to must be a unix timestamp");
    const typeFilter = type              ? sql`AND trade_type = ${type}`      : sql``;
    const fromFilter = fromInt !== null  ? sql`AND timestamp >= ${fromInt}`   : sql``;
    const toFilter   = toInt   !== null  ? sql`AND timestamp <= ${toInt}`     : sql``;

    const numericCols = new Set(["bnb_amount", "token_amount", "block_number"]);
    const orderExpr   = numericCols.has(orderBy)
      ? sql`ORDER BY ${sql([orderBy])}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`
      : sql`ORDER BY ${sql([orderBy])} ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`;

    const addr = normalizeAddress(address);

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM trade WHERE token = ${addr} ${typeFilter} ${fromFilter} ${toFilter} ${orderExpr} LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM trade WHERE token = ${addr} ${typeFilter} ${fromFilter} ${toFilter}`,
    ]);

    return paginated(rows.map(toCamel), count, page, limit);
  }

  async migration(address: string) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const [row] = await sql`SELECT * FROM migration WHERE id = ${normalizeAddress(address)}`;
    if (!row) throw new NotFoundException(`Token ${address} has not migrated yet`);

    return { data: toCamel(row) };
  }

  async traders(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const { page, limit, offset } = parsePagination(query);
    const ALLOWED_ORDER = ["totalVolumeBNB", "totalTrades", "buyCount", "sellCount", "netBNB"] as const;
    const orderBy  = parseOrderBy(query, ALLOWED_ORDER, "totalVolumeBNB");
    const orderDir = parseOrderDir(query);
    const addr     = normalizeAddress(address);

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          trader,
          COUNT(*) FILTER (WHERE trade_type = 'buy')::int                                AS "buyCount",
          COUNT(*) FILTER (WHERE trade_type = 'sell')::int                               AS "sellCount",
          COUNT(*)::int                                                                    AS "totalTrades",
          COALESCE(SUM(bnb_amount::numeric) FILTER (WHERE trade_type = 'buy'),  0)::text  AS "totalBNBIn",
          COALESCE(SUM(bnb_amount::numeric) FILTER (WHERE trade_type = 'sell'), 0)::text  AS "totalBNBOut",
          COALESCE(SUM(bnb_amount::numeric), 0)::text                                     AS "totalVolumeBNB",
          (
            COALESCE(SUM(bnb_amount::numeric) FILTER (WHERE trade_type = 'sell'), 0) -
            COALESCE(SUM(bnb_amount::numeric) FILTER (WHERE trade_type = 'buy'),  0)
          )::text                                                                          AS "netBNB"
        FROM trade
        WHERE token = ${addr}
        GROUP BY trader
        ORDER BY ${sql([orderBy])}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(DISTINCT trader)::int AS count FROM trade WHERE token = ${addr}`,
    ]);

    return paginated(rows, count, page, limit);
  }

  async holders(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const { page, limit, offset } = parsePagination(query);
    const orderDir = parseOrderDir(query);
    const addr     = normalizeAddress(address);

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          address,
          balance::text              AS balance,
          last_updated_block::text   AS "lastUpdatedBlock",
          last_updated_timestamp     AS "lastUpdatedTimestamp"
        FROM holder
        WHERE token = ${addr}
          AND balance::numeric > 0
        ORDER BY balance::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM holder
        WHERE token = ${addr}
          AND balance::numeric > 0
      `,
    ]);

    return paginated(rows, count, page, limit);
  }

  /**
   * GET /tokens/:address/snapshots
   *
   * Returns per-block bonding-curve state with AMM price computed for each block.
   * Supports ?from=<unix>&to=<unix> time range filtering and standard pagination.
   * Includes priceBnb (spot price at block close) derived from the AMM formula.
   */
  async snapshots(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const { page, limit, offset } = parsePagination(query);
    const addr = normalizeAddress(address);

    const fromTs = query["from"] ? parseInt(query["from"], 10) : null;
    const toTs   = query["to"]   ? parseInt(query["to"],   10) : null;

    if (fromTs !== null && isNaN(fromTs)) throw new BadRequestException("from must be a unix timestamp");
    if (toTs   !== null && isNaN(toTs))   throw new BadRequestException("to must be a unix timestamp");

    const [tokenRow] = await sql`SELECT id FROM token WHERE id = ${addr} LIMIT 1`;
    if (!tokenRow) throw new NotFoundException(`Token ${address} not found`);

    const fromFilter = fromTs !== null ? sql`AND s.timestamp >= ${fromTs}` : sql``;
    const toFilter   = toTs   !== null ? sql`AND s.timestamp <= ${toTs}`   : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          s.block_number::text                                                                              AS "blockNumber",
          s.timestamp,
          s.open_raised_bnb::text                                                                           AS "openRaisedBNB",
          s.close_raised_bnb::text                                                                          AS "closeRaisedBNB",
          s.volume_bnb::text                                                                                AS "volumeBNB",
          s.buy_count                                                                                       AS "buyCount",
          s.sell_count                                                                                      AS "sellCount",
          ((s.close_raised_bnb::numeric + t.virtual_bnb::numeric)^2
            / NULLIF(t.virtual_bnb::numeric * t.total_supply::numeric, 0))::text                           AS "priceBnb"
        FROM token_snapshot s
        JOIN token t ON t.id = s.token
        WHERE s.token = ${addr} ${fromFilter} ${toFilter}
        ORDER BY s.block_number::numeric DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(*)::int AS count FROM token_snapshot WHERE token = ${addr} ${fromTs !== null ? sql`AND timestamp >= ${fromTs}` : sql``} ${toTs !== null ? sql`AND timestamp <= ${toTs}` : sql``}`,
    ]);

    return paginated(rows, count, page, limit);
  }

  async byCreator(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid creator address");

    const { page, limit, offset } = parsePagination(query);
    const addr = normalizeAddress(address);

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT t.*, ${PRICE_COLS} FROM token t LEFT JOIN migration m ON m.id = t.id WHERE t.creator = ${addr} ORDER BY t.created_at_block::numeric DESC LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM token WHERE creator = ${addr}`,
    ]);

    return paginated(rows.map(r => this.withUsd(toCamel(r))), count, page, limit);
  }
}
