import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { sql } from "../../db";
import { isAddress, normalizeAddress, paginated, parsePagination, parseOrderBy, parseOrderDir, toCamel } from "../../helpers";
import { getMetaURI } from "../../rpc";
import { fetchMetadata } from "../../metadata";

@Injectable()
export class TokensService {

  async list(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type     = query["type"];
    const migrated = query["migrated"];

    const ALLOWED_ORDER = ["created_at_block", "volume_bnb", "buy_count", "sell_count", "raised_bnb", "total_supply"] as const;
    const orderBy  = parseOrderBy(query, ALLOWED_ORDER, "created_at_block");
    const orderDir = parseOrderDir(query);

    const migratedFilter =
      migrated === "true"  ? sql`AND migrated = TRUE`  :
      migrated === "false" ? sql`AND migrated = FALSE` :
      sql``;

    const typeFilter = type ? sql`AND token_type = ${type}` : sql``;

    const ALLOWED_TYPES = new Set(["Standard", "Tax", "Reflection"]);
    if (type && !ALLOWED_TYPES.has(type)) {
      throw new BadRequestException(`Invalid type "${type}". Must be Standard, Tax, or Reflection.`);
    }

    const numericCols = new Set(["volume_bnb", "raised_bnb", "created_at_block", "trading_block", "total_supply"]);
    const orderExpr   = numericCols.has(orderBy)
      ? sql`ORDER BY ${sql([orderBy])}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`
      : sql`ORDER BY ${sql([orderBy])} ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`;

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM token WHERE TRUE ${typeFilter} ${migratedFilter} ${orderExpr} LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM token WHERE TRUE ${typeFilter} ${migratedFilter}`,
    ]);

    return paginated(rows.map(toCamel), count, page, limit);
  }

  async findOne(address: string) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const addr = normalizeAddress(address);
    const [row] = await sql`SELECT * FROM token WHERE id = ${addr}`;
    if (!row) throw new NotFoundException(`Token ${address} not found`);

    const camelRow = toCamel(row);
    const metaURI  = await getMetaURI(addr as `0x${string}`);
    const metadata = metaURI ? await fetchMetadata(metaURI) : null;

    return { data: { ...camelRow, metaURI: metaURI || null, metadata: metadata ?? null } };
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
          balance::text AS balance
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

  async byCreator(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid creator address");

    const { page, limit, offset } = parsePagination(query);
    const addr = normalizeAddress(address);

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM token WHERE creator = ${addr} ORDER BY created_at_block::numeric DESC LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM token WHERE creator = ${addr}`,
    ]);

    return paginated(rows.map(toCamel), count, page, limit);
  }
}
