import { Injectable, BadRequestException } from "@nestjs/common";
import { sql } from "../../db";
import { isAddress, normalizeAddress, paginated, parsePagination, parseOrderBy, parseOrderDir, toCamel } from "../../helpers";

@Injectable()
export class TradesService {

  async list(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const tokenFilter  = query["token"];
    const traderFilter = query["trader"];
    const typeFilter   = query["type"];
    const from         = query["from"];
    const to           = query["to"];

    if (tokenFilter  && !isAddress(tokenFilter))  throw new BadRequestException("Invalid token address");
    if (traderFilter && !isAddress(traderFilter)) throw new BadRequestException("Invalid trader address");

    const ALLOWED_ORDER = ["timestamp", "bnb_amount", "token_amount", "block_number"] as const;
    const orderBy  = parseOrderBy(query, ALLOWED_ORDER, "timestamp");
    const orderDir = parseOrderDir(query);

    const tokenSql  = tokenFilter  ? sql`AND token    = ${normalizeAddress(tokenFilter)}`  : sql``;
    const traderSql = traderFilter ? sql`AND trader   = ${normalizeAddress(traderFilter)}` : sql``;
    const typeSql   = typeFilter   ? sql`AND trade_type = ${typeFilter}`                   : sql``;
    const fromInt   = from ? parseInt(from, 10) : null;
    const toInt     = to   ? parseInt(to,   10) : null;
    if (fromInt !== null && isNaN(fromInt)) throw new BadRequestException("from must be a unix timestamp");
    if (toInt   !== null && isNaN(toInt))   throw new BadRequestException("to must be a unix timestamp");
    const fromSql   = fromInt !== null ? sql`AND timestamp >= ${fromInt}` : sql``;
    const toSql     = toInt   !== null ? sql`AND timestamp <= ${toInt}`   : sql``;

    const numericCols = new Set(["bnb_amount", "token_amount", "block_number"]);
    const orderExpr   = numericCols.has(orderBy)
      ? sql`ORDER BY ${sql([orderBy])}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`
      : sql`ORDER BY ${sql([orderBy])} ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`;

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM trade WHERE TRUE ${tokenSql} ${traderSql} ${typeSql} ${fromSql} ${toSql} ${orderExpr} LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM trade WHERE TRUE ${tokenSql} ${traderSql} ${typeSql} ${fromSql} ${toSql}`,
    ]);

    return paginated(rows.map(toCamel), count, page, limit);
  }

  async byTrader(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid trader address");

    const { page, limit, offset } = parsePagination(query);
    const typeFilter = query["type"];
    const from       = query["from"];
    const to         = query["to"];

    const fromInt2 = from ? parseInt(from, 10) : null;
    const toInt2   = to   ? parseInt(to,   10) : null;
    if (fromInt2 !== null && isNaN(fromInt2)) throw new BadRequestException("from must be a unix timestamp");
    if (toInt2   !== null && isNaN(toInt2))   throw new BadRequestException("to must be a unix timestamp");
    const typeSql = typeFilter        ? sql`AND trade_type = ${typeFilter}`   : sql``;
    const fromSql = fromInt2 !== null ? sql`AND timestamp >= ${fromInt2}`     : sql``;
    const toSql   = toInt2   !== null ? sql`AND timestamp <= ${toInt2}`       : sql``;

    const addr = normalizeAddress(address);

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM trade WHERE trader = ${addr} ${typeSql} ${fromSql} ${toSql} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM trade WHERE trader = ${addr} ${typeSql} ${fromSql} ${toSql}`,
    ]);

    return paginated(rows.map(toCamel), count, page, limit);
  }
}
