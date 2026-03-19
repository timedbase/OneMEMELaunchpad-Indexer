import { Injectable } from "@nestjs/common";
import { sql } from "../../db";
import { paginated, parsePagination, parseOrderBy, parseOrderDir, toCamel } from "../../helpers";

@Injectable()
export class MigrationsService {
  async list(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);

    const ALLOWED_ORDER = ["timestamp", "liquidity_bnb", "liquidity_tokens", "block_number"] as const;
    const orderBy  = parseOrderBy(query, ALLOWED_ORDER, "timestamp");
    const orderDir = parseOrderDir(query);

    const numericCols = new Set(["liquidity_bnb", "liquidity_tokens", "block_number"]);
    const orderExpr   = numericCols.has(orderBy)
      ? sql`ORDER BY ${sql([orderBy])}::numeric ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`
      : sql`ORDER BY ${sql([orderBy])} ${orderDir === "ASC" ? sql`ASC` : sql`DESC`}`;

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM migration ${orderExpr} LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM migration`,
    ]);

    return paginated(rows.map(toCamel), count, page, limit);
  }
}
