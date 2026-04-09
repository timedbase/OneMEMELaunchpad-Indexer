import { Injectable } from "@nestjs/common";
import { subgraphFetch, subgraphCount } from "../../subgraph";
import { paginated, parsePagination, parseOrderBy, parseOrderDir } from "../../helpers";

interface SubgraphMigration {
  txHash:          string;
  pair:            string;
  liquidityBNB:    string;
  liquidityTokens: string;
  blockNumber:     string;
  timestamp:       string;
  token:           { id: string };
}

const MIGRATIONS_QUERY = /* GraphQL */ `
  query Migrations(
    $first: Int!, $skip: Int!
    $orderBy: Migration_orderBy!, $orderDirection: OrderDirection!
  ) {
    migrations(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
      txHash pair liquidityBNB liquidityTokens blockNumber timestamp
      token { id }
    }
  }
`;

const MIGRATIONS_COUNT_QUERY = /* GraphQL */ `
  query MigrationsCount($first: Int!, $skip: Int!) {
    migrations(first: $first, skip: $skip) { id }
  }
`;

const ORDER_MAP: Record<string, string> = {
  timestamp:        "timestamp",
  liquidity_bnb:    "liquidityBNB",
  liquidity_tokens: "liquidityTokens",
  block_number:     "blockNumber",
};

@Injectable()
export class MigrationsService {
  async list(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);

    const ALLOWED_ORDER = ["timestamp", "liquidity_bnb", "liquidity_tokens", "block_number"] as const;
    const orderBy  = ORDER_MAP[parseOrderBy(query, ALLOWED_ORDER, "timestamp")] ?? "timestamp";
    const orderDir = parseOrderDir(query).toLowerCase() as "asc" | "desc";

    const [{ migrations }, total] = await Promise.all([
      subgraphFetch<{ migrations: SubgraphMigration[] }>(MIGRATIONS_QUERY, {
        first: limit, skip: offset, orderBy, orderDirection: orderDir,
      }),
      subgraphCount("migrations", MIGRATIONS_COUNT_QUERY),
    ]);

    return paginated(
      migrations.map(m => ({
        id:              m.token.id,   // backward compat: Ponder keyed migration by token address
        txHash:          m.txHash,
        pair:            m.pair,
        liquidityBnb:    m.liquidityBNB,
        liquidityTokens: m.liquidityTokens,
        blockNumber:     m.blockNumber,
        timestamp:       parseInt(m.timestamp),
      })),
      total,
      page,
      limit,
    );
  }
}
