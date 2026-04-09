import { Injectable } from "@nestjs/common";
import { subgraphFetch, subgraphFetchAll, subgraphCount } from "../../subgraph";
import { paginated, parsePagination, normalizeAddress } from "../../helpers";

export const VALID_TYPES = new Set(["create", "buy", "sell"]);

export interface ActivityQueryOptions {
  typeFilter?: string;
  token?:      string;
  sinceBlock?: bigint;
  limit:       number;
  offset:      number;
}

interface ActivityEvent {
  eventType:   string;
  token:       string;
  actor:       string;
  bnbAmount:   string | null;
  tokenAmount: string | null;
  blockNumber: string;
  timestamp:   number;
  txHash:      string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

const TOKENS_ACTIVITY_QUERY = /* GraphQL */ `
  query TokenCreates($first: Int!, $skip: Int!, $where: Token_filter) {
    tokens(first: $first, skip: $skip, where: $where, orderBy: createdAtBlockNumber, orderDirection: desc) {
      id creator createdAtBlockNumber createdAtTimestamp txHash
    }
  }
`;

const TRADES_ACTIVITY_QUERY = /* GraphQL */ `
  query TradeActivity($first: Int!, $skip: Int!, $where: Trade_filter) {
    trades(first: $first, skip: $skip, where: $where, orderBy: blockNumber, orderDirection: desc) {
      id type token { id } trader bnbAmount tokenAmount blockNumber timestamp txHash
    }
  }
`;

const TOKENS_COUNT_QUERY = /* GraphQL */ `
  query TokenCount($where: Token_filter, $first: Int!, $skip: Int!) {
    tokens(first: $first, skip: $skip, where: $where) { id }
  }
`;

const TRADES_COUNT_QUERY = /* GraphQL */ `
  query TradeCount($where: Trade_filter, $first: Int!, $skip: Int!) {
    trades(first: $first, skip: $skip, where: $where) { id }
  }
`;

const META_QUERY = /* GraphQL */ `
  query Meta { _meta { block { number } } }
`;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ActivityService {
  private latestBlockCache: { value: bigint; at: number } | null = null;

  async query(opts: ActivityQueryOptions): Promise<ActivityEvent[]> {
    const { typeFilter, token, sinceBlock, limit, offset } = opts;

    const includeCreates = typeFilter !== "buy"  && typeFilter !== "sell";
    const includeTrades  = typeFilter !== "create";

    const tokenAddr = token ? normalizeAddress(token) : undefined;

    const tokenWhere: Record<string, unknown> = {};
    if (sinceBlock != null) tokenWhere["createdAtBlockNumber_gt"] = sinceBlock.toString();
    if (tokenAddr)           tokenWhere["id"] = tokenAddr;

    const tradeWhere: Record<string, unknown> = {};
    if (sinceBlock != null) tradeWhere["blockNumber_gt"]  = sinceBlock.toString();
    if (tokenAddr)          tradeWhere["token"]           = tokenAddr;
    if (typeFilter === "buy")  tradeWhere["type"] = "BUY";
    if (typeFilter === "sell") tradeWhere["type"] = "SELL";

    // Fetch both streams with high enough first to cover merge+sort+slice
    const fetchSize = limit + offset + 200;

    const [creates, trades] = await Promise.all([
      includeCreates
        ? subgraphFetch<{ tokens: { id: string; creator: string; createdAtBlockNumber: string; createdAtTimestamp: string; txHash: string }[] }>(
            TOKENS_ACTIVITY_QUERY,
            { first: fetchSize, skip: 0, where: Object.keys(tokenWhere).length ? tokenWhere : undefined },
          ).then(r => r.tokens)
        : Promise.resolve([]),

      includeTrades
        ? subgraphFetch<{ trades: { id: string; type: string; token: { id: string }; trader: string; bnbAmount: string; tokenAmount: string; blockNumber: string; timestamp: string; txHash: string }[] }>(
            TRADES_ACTIVITY_QUERY,
            { first: fetchSize, skip: 0, where: Object.keys(tradeWhere).length ? tradeWhere : undefined },
          ).then(r => r.trades)
        : Promise.resolve([]),
    ]);

    const events: ActivityEvent[] = [
      ...creates.map(t => ({
        eventType:   "create",
        token:       t.id,
        actor:       t.creator,
        bnbAmount:   null,
        tokenAmount: null,
        blockNumber: t.createdAtBlockNumber,
        timestamp:   parseInt(t.createdAtTimestamp),
        txHash:      t.txHash,
      })),
      ...trades.map(t => ({
        eventType:   t.type === "BUY" ? "buy" : "sell",
        token:       t.token.id,
        actor:       t.trader,
        bnbAmount:   t.bnbAmount,
        tokenAmount: t.tokenAmount,
        blockNumber: t.blockNumber,
        timestamp:   parseInt(t.timestamp),
        txHash:      t.txHash,
      })),
    ];

    // Sort: blockNumber DESC, then eventType ASC (create < buy < sell alphabetically)
    events.sort((a, b) => {
      const bn = BigInt(b.blockNumber) - BigInt(a.blockNumber);
      if (bn !== 0n) return bn > 0n ? 1 : -1;
      return a.eventType.localeCompare(b.eventType);
    });

    return events.slice(offset, offset + limit);
  }

  async count(typeFilter?: string, token?: string): Promise<number> {
    const tokenAddr = token ? normalizeAddress(token) : undefined;

    const includeCreates = typeFilter !== "buy"  && typeFilter !== "sell";
    const includeTrades  = typeFilter !== "create";

    const tokenWhere: Record<string, unknown> = {};
    if (tokenAddr) tokenWhere["id"] = tokenAddr;

    const tradeWhere: Record<string, unknown> = {};
    if (tokenAddr)            tradeWhere["token"] = tokenAddr;
    if (typeFilter === "buy")  tradeWhere["type"]  = "BUY";
    if (typeFilter === "sell") tradeWhere["type"]  = "SELL";

    const [createCount, tradeCount] = await Promise.all([
      includeCreates
        ? subgraphCount("tokens", TOKENS_COUNT_QUERY, {
            where: Object.keys(tokenWhere).length ? tokenWhere : undefined,
          })
        : Promise.resolve(0),
      includeTrades
        ? subgraphCount("trades", TRADES_COUNT_QUERY, {
            where: Object.keys(tradeWhere).length ? tradeWhere : undefined,
          })
        : Promise.resolve(0),
    ]);

    return createCount + tradeCount;
  }

  async latestBlock(): Promise<bigint> {
    const now = Date.now();
    if (this.latestBlockCache && now - this.latestBlockCache.at < 1_000) {
      return this.latestBlockCache.value;
    }
    const { _meta } = await subgraphFetch<{ _meta: { block: { number: number } } }>(META_QUERY);
    const value = BigInt(_meta?.block?.number ?? 0);
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
