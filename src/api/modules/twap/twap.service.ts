import { Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "../../db";
import { paginated, parsePagination } from "../../helpers";

@Injectable()
export class TwapService {
  async latest() {
    const [row] = await sql`SELECT * FROM twap_update ORDER BY "blockNumber"::numeric DESC LIMIT 1`;
    if (!row) throw new NotFoundException("No TWAP updates indexed yet");
    return { data: row };
  }

  async list(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const from = query["from"];
    const to   = query["to"];

    const fromSql = from ? sql`AND "timestamp" >= ${parseInt(from)}` : sql``;
    const toSql   = to   ? sql`AND "timestamp" <= ${parseInt(to)}`   : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM twap_update WHERE TRUE ${fromSql} ${toSql} ORDER BY "blockNumber"::numeric DESC LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM twap_update WHERE TRUE ${fromSql} ${toSql}`,
    ]);

    return paginated(rows, count, page, limit);
  }
}
