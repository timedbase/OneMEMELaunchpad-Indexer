import { Injectable } from "@nestjs/common";
import { sql } from "../../db";
import { paginated, parsePagination } from "../../helpers";

export const VALID_TYPES = new Set(["create", "buy", "sell"]);

export interface ActivityQueryOptions {
  typeFilter?: string;
  token?:      string;
  sinceBlock?: bigint;
  limit:       number;
  offset:      number;
}

@Injectable()
export class ActivityService {
  private latestBlockCache: { value: bigint; at: number } | null = null;

  async query(opts: ActivityQueryOptions) {
    const { typeFilter, token, sinceBlock, limit, offset } = opts;

    const sinceFilter = sinceBlock != null
      ? sql`AND block_number::numeric > ${sinceBlock.toString()}`
      : sql``;
    const tokenFilter = token
      ? sql`AND token = ${token.toLowerCase()}`
      : sql``;

    const createQ = (typeFilter === "buy" || typeFilter === "sell")
      ? null
      : sql`
          SELECT
            'create'             AS "eventType",
            id                   AS token,
            creator              AS actor,
            NULL::numeric        AS "bnbAmount",
            NULL::numeric        AS "tokenAmount",
            created_at_block     AS "blockNumber",
            created_at_timestamp AS timestamp,
            creation_tx_hash     AS "txHash"
          FROM token
          WHERE TRUE ${sinceBlock != null ? sql`AND created_at_block::numeric > ${sinceBlock.toString()}` : sql``}
                ${token ? sql`AND id = ${token.toLowerCase()}` : sql``}
        `;

    const tradeTypeFilter =
      typeFilter === "create" ? null :
      typeFilter === "buy"    ? sql`AND trade_type = 'buy'`  :
      typeFilter === "sell"   ? sql`AND trade_type = 'sell'` :
      sql``;

    const tradeQ = typeFilter === "create"
      ? null
      : sql`
          SELECT
            trade_type   AS "eventType",
            token        AS token,
            trader       AS actor,
            bnb_amount   AS "bnbAmount",
            token_amount AS "tokenAmount",
            block_number AS "blockNumber",
            timestamp    AS timestamp,
            tx_hash      AS "txHash"
          FROM trade
          WHERE TRUE ${tradeTypeFilter ?? sql``} ${sinceFilter} ${tokenFilter}
        `;

    let unionQ;
    if (createQ && tradeQ) unionQ = sql`${createQ} UNION ALL ${tradeQ}`;
    else if (createQ)      unionQ = createQ;
    else                   unionQ = tradeQ!;

    return sql`
      SELECT * FROM (${unionQ}) AS activity
      ORDER BY "blockNumber"::numeric DESC, "eventType"
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  async count(typeFilter?: string, token?: string) {
    const tokenFilter      = token ? sql`AND id = ${token.toLowerCase()}`      : sql``;
    const tradeTokenFilter = token ? sql`AND token = ${token.toLowerCase()}`   : sql``;

    const createCount =
      typeFilter === "buy" || typeFilter === "sell"
        ? sql`SELECT 0 AS n`
        : sql`SELECT COUNT(*)::int AS n FROM token WHERE TRUE ${tokenFilter}`;

    const tradeFilter =
      typeFilter === "create" ? sql`AND FALSE` :
      typeFilter === "buy"    ? sql`AND trade_type = 'buy'` :
      typeFilter === "sell"   ? sql`AND trade_type = 'sell'` :
      sql``;

    const tradeCount =
      typeFilter === "create"
        ? sql`SELECT 0 AS n`
        : sql`SELECT COUNT(*)::int AS n FROM trade WHERE TRUE ${tradeFilter} ${tradeTokenFilter}`;

    const [createRow, tradeRow] = await Promise.all([
      sql`${createCount}`,
      sql`${tradeCount}`,
    ]);

    return (createRow[0]?.n ?? 0) + (tradeRow[0]?.n ?? 0);
  }

  async latestBlock(): Promise<bigint> {
    const now = Date.now();
    if (this.latestBlockCache && now - this.latestBlockCache.at < 1_000) {
      return this.latestBlockCache.value;
    }
    const [row] = await sql`
      SELECT GREATEST(
        (SELECT MAX(created_at_block::numeric) FROM token),
        (SELECT MAX(block_number::numeric)     FROM trade)
      )::text AS block
    `;
    const value = BigInt(row?.block ?? "0");
    this.latestBlockCache = { value, at: now };
    return value;
  }

  async list(queryParams: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(queryParams);
    const typeFilter  = queryParams["type"];
    const tokenFilter = queryParams["token"];

    const [rows, total] = await Promise.all([
      this.query({ typeFilter, token: tokenFilter, limit, offset }),
      this.count(typeFilter, tokenFilter),
    ]);

    return paginated(rows, total, page, limit);
  }
}
