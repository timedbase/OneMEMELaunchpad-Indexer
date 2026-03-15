import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { sql } from "../../db";
import { isAddress, paginated, parsePagination, parseOrderBy, parseOrderDir } from "../../helpers";
import { getMetaURI } from "../../rpc";
import { fetchMetadata } from "../../metadata";

@Injectable()
export class TokensService {

  async list(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type     = query["type"];
    const migrated = query["migrated"];

    const ALLOWED_ORDER = ["createdAtBlock", "volumeBNB", "buyCount", "sellCount", "raisedBNB", "totalSupply"] as const;
    const orderBy  = parseOrderBy(query, ALLOWED_ORDER, "createdAtBlock");
    const orderDir = parseOrderDir(query);

    const migratedFilter =
      migrated === "true"  ? sql`AND "migrated" = TRUE`  :
      migrated === "false" ? sql`AND "migrated" = FALSE` :
      sql``;

    const typeFilter = type ? sql`AND "tokenType" = ${type}` : sql``;

    const ALLOWED_TYPES = new Set(["Standard", "Tax", "Reflection"]);
    if (type && !ALLOWED_TYPES.has(type)) {
      throw new BadRequestException(`Invalid type "${type}". Must be Standard, Tax, or Reflection.`);
    }

    const numericCols = new Set(["volumeBNB", "raisedBNB", "createdAtBlock", "tradingBlock", "totalSupply"]);
    const orderExpr   = numericCols.has(orderBy)
      ? sql`ORDER BY ${sql([orderBy])}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`
      : sql`ORDER BY ${sql([orderBy])} ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`;

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM token WHERE TRUE ${typeFilter} ${migratedFilter} ${orderExpr} LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM token WHERE TRUE ${typeFilter} ${migratedFilter}`,
    ]);

    return paginated(rows, count, page, limit);
  }

  async findOne(address: string) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const [row] = await sql`SELECT * FROM token WHERE id = ${address.toLowerCase()}`;
    if (!row) throw new NotFoundException(`Token ${address} not found`);

    const metaURI  = await getMetaURI(address.toLowerCase() as `0x${string}`);
    const metadata = metaURI ? await fetchMetadata(metaURI) : null;

    return { data: { ...row, metaURI: metaURI || null, metadata: metadata ?? null } };
  }

  async trades(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const { page, limit, offset } = parsePagination(query);
    const type = query["type"];
    const from = query["from"];
    const to   = query["to"];

    const ALLOWED_ORDER = ["timestamp", "bnbAmount", "tokenAmount", "blockNumber"] as const;
    const orderBy  = parseOrderBy(query, ALLOWED_ORDER, "timestamp");
    const orderDir = parseOrderDir(query);

    const fromInt = from ? parseInt(from, 10) : null;
    const toInt   = to   ? parseInt(to,   10) : null;
    if (fromInt !== null && isNaN(fromInt)) throw new BadRequestException("from must be a unix timestamp");
    if (toInt   !== null && isNaN(toInt))   throw new BadRequestException("to must be a unix timestamp");
    const typeFilter = type              ? sql`AND "tradeType" = ${type}`    : sql``;
    const fromFilter = fromInt !== null  ? sql`AND "timestamp" >= ${fromInt}` : sql``;
    const toFilter   = toInt   !== null  ? sql`AND "timestamp" <= ${toInt}`   : sql``;

    const numericCols = new Set(["bnbAmount", "tokenAmount", "blockNumber"]);
    const orderExpr   = numericCols.has(orderBy)
      ? sql`ORDER BY ${sql([orderBy])}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`
      : sql`ORDER BY ${sql([orderBy])} ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`;

    const addr = address.toLowerCase();

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM trade WHERE "token" = ${addr} ${typeFilter} ${fromFilter} ${toFilter} ${orderExpr} LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM trade WHERE "token" = ${addr} ${typeFilter} ${fromFilter} ${toFilter}`,
    ]);

    return paginated(rows, count, page, limit);
  }

  async migration(address: string) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const [row] = await sql`SELECT * FROM migration WHERE id = ${address.toLowerCase()}`;
    if (!row) throw new NotFoundException(`Token ${address} has not migrated yet`);

    return { data: row };
  }

  async traders(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const { page, limit, offset } = parsePagination(query);
    const ALLOWED_ORDER = ["totalVolumeBNB", "totalTrades", "buyCount", "sellCount", "netBNB"] as const;
    const orderBy  = parseOrderBy(query, ALLOWED_ORDER, "totalVolumeBNB");
    const orderDir = parseOrderDir(query);
    const addr     = address.toLowerCase();

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          "trader",
          COUNT(*) FILTER (WHERE "tradeType" = 'buy')::int                                AS "buyCount",
          COUNT(*) FILTER (WHERE "tradeType" = 'sell')::int                               AS "sellCount",
          COUNT(*)::int                                                                    AS "totalTrades",
          COALESCE(SUM("bnbAmount"::numeric) FILTER (WHERE "tradeType" = 'buy'),  0)::text AS "totalBNBIn",
          COALESCE(SUM("bnbAmount"::numeric) FILTER (WHERE "tradeType" = 'sell'), 0)::text AS "totalBNBOut",
          COALESCE(SUM("bnbAmount"::numeric), 0)::text                                    AS "totalVolumeBNB",
          (
            COALESCE(SUM("bnbAmount"::numeric) FILTER (WHERE "tradeType" = 'sell'), 0) -
            COALESCE(SUM("bnbAmount"::numeric) FILTER (WHERE "tradeType" = 'buy'),  0)
          )::text                                                                          AS "netBNB"
        FROM trade
        WHERE "token" = ${addr}
        GROUP BY "trader"
        ORDER BY ${sql([orderBy])}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(DISTINCT "trader")::int AS count FROM trade WHERE "token" = ${addr}`,
    ]);

    return paginated(rows, count, page, limit);
  }

  async holders(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const { page, limit, offset } = parsePagination(query);
    const orderDir = parseOrderDir(query);
    const addr     = address.toLowerCase();

    // Query the holder table which is maintained by indexing every Transfer
    // event on the token contract — exact onchain balances, not estimates.
    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          "address",
          "balance"::text AS "balance"
        FROM holder
        WHERE "token" = ${addr}
          AND "balance"::numeric > 0
        ORDER BY "balance"::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM holder
        WHERE "token" = ${addr}
          AND "balance"::numeric > 0
      `,
    ]);

    return paginated(rows, count, page, limit);
  }

  async byCreator(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid creator address");

    const { page, limit, offset } = parsePagination(query);
    const addr = address.toLowerCase();

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM token WHERE "creator" = ${addr} ORDER BY "createdAtBlock"::numeric DESC LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM token WHERE "creator" = ${addr}`,
    ]);

    return paginated(rows, count, page, limit);
  }
}
