import { Injectable, BadRequestException } from "@nestjs/common";
import { sql } from "../../db";
import { isAddress, paginated, parsePagination, parseOrderBy, parseOrderDir } from "../../helpers";

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

    const ALLOWED_ORDER = ["timestamp", "bnbAmount", "tokenAmount", "blockNumber"] as const;
    const orderBy  = parseOrderBy(query, ALLOWED_ORDER, "timestamp");
    const orderDir = parseOrderDir(query);

    const tokenSql  = tokenFilter  ? sql`AND "token"     = ${tokenFilter.toLowerCase()}`  : sql``;
    const traderSql = traderFilter ? sql`AND "trader"    = ${traderFilter.toLowerCase()}` : sql``;
    const typeSql   = typeFilter   ? sql`AND "tradeType" = ${typeFilter}`                  : sql``;
    const fromSql   = from         ? sql`AND "timestamp" >= ${parseInt(from)}`             : sql``;
    const toSql     = to           ? sql`AND "timestamp" <= ${parseInt(to)}`               : sql``;

    const numericCols = new Set(["bnbAmount", "tokenAmount", "blockNumber"]);
    const orderExpr   = numericCols.has(orderBy)
      ? sql`ORDER BY ${sql('"' + orderBy + '"')}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`
      : sql`ORDER BY ${sql('"' + orderBy + '"')} ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`;

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM trade WHERE TRUE ${tokenSql} ${traderSql} ${typeSql} ${fromSql} ${toSql} ${orderExpr} LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM trade WHERE TRUE ${tokenSql} ${traderSql} ${typeSql} ${fromSql} ${toSql}`,
    ]);

    return paginated(rows, count, page, limit);
  }

  async byTrader(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid trader address");

    const { page, limit, offset } = parsePagination(query);
    const typeFilter = query["type"];
    const from       = query["from"];
    const to         = query["to"];

    const typeSql = typeFilter ? sql`AND "tradeType" = ${typeFilter}`      : sql``;
    const fromSql = from       ? sql`AND "timestamp" >= ${parseInt(from)}` : sql``;
    const toSql   = to         ? sql`AND "timestamp" <= ${parseInt(to)}`   : sql``;

    const addr = address.toLowerCase();

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM trade WHERE "trader" = ${addr} ${typeSql} ${fromSql} ${toSql} ORDER BY "timestamp" DESC LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM trade WHERE "trader" = ${addr} ${typeSql} ${fromSql} ${toSql}`,
    ]);

    return paginated(rows, count, page, limit);
  }
}
