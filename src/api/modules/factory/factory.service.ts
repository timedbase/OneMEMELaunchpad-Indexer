import { Injectable, BadRequestException } from "@nestjs/common";
import { sql } from "../../db";
import { paginated, parsePagination } from "../../helpers";

const VALID_EVENT_TYPES = new Set([
  "DefaultParamsUpdated",
  "FeesWithdrawn",
  "RouterUpdated",
  "FeeRecipientUpdated",
  "TradeFeeUpdated",
  "UsdcPairUpdated",
  "TwapMaxAgeBlocksUpdated",
]);

@Injectable()
export class FactoryService {
  async events(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type = query["type"];
    const from = query["from"];
    const to   = query["to"];

    if (type && !VALID_EVENT_TYPES.has(type)) {
      throw new BadRequestException(
        `Invalid event type. Valid types: ${[...VALID_EVENT_TYPES].join(", ")}`
      );
    }

    const typeSql = type ? sql`AND "eventType" = ${type}`           : sql``;
    const fromSql = from ? sql`AND "timestamp" >= ${parseInt(from)}` : sql``;
    const toSql   = to   ? sql`AND "timestamp" <= ${parseInt(to)}`   : sql``;

    const [rows, [{ count }]] = await Promise.all([
      sql`SELECT * FROM factory_event WHERE TRUE ${typeSql} ${fromSql} ${toSql} ORDER BY "blockNumber"::numeric DESC LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS count FROM factory_event WHERE TRUE ${typeSql} ${fromSql} ${toSql}`,
    ]);

    return paginated(rows, count, page, limit);
  }
}
