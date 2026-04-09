import { Injectable, BadRequestException } from "@nestjs/common";
import { subgraphFetch, subgraphFetchAll, subgraphCount } from "../../subgraph";
import { SubgraphToken, TOKEN_FIELDS, FROM_API_TYPE, normalizeToken } from "../../token-utils";
import { paginated, parsePagination, parseOrderDir } from "../../helpers";
import { PriceService } from "../price/price.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_TOKEN_TYPES = new Set(["Standard", "Tax", "Reflection"]);

function validateType(type: string | undefined) {
  if (type && !VALID_TOKEN_TYPES.has(type)) {
    throw new BadRequestException('type must be "Standard", "Tax", or "Reflection"');
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

const TOKENS_QUERY = /* GraphQL */ `
  query Tokens(
    $first: Int!, $skip: Int!
    $orderBy: Token_orderBy!, $orderDirection: OrderDirection!
    $where: Token_filter
  ) {
    tokens(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection, where: $where) {
      ${TOKEN_FIELDS}
    }
  }
`;

const TOKENS_COUNT_QUERY = /* GraphQL */ `
  query TokensCount($where: Token_filter, $first: Int!, $skip: Int!) {
    tokens(first: $first, skip: $skip, where: $where) { id }
  }
`;

// Fetch trades in a time window for trending computation
const TRADES_WINDOW_QUERY = /* GraphQL */ `
  query TradesWindow($where: Trade_filter, $first: Int!, $skip: Int!) {
    trades(first: $first, skip: $skip, where: $where) {
      token { id ${TOKEN_FIELDS} }
      type bnbAmount
    }
  }
`;

// For graduating: recent trade stats per token
const RECENT_TRADES_FOR_TOKENS_QUERY = /* GraphQL */ `
  query RecentTradesForTokens($where: Trade_filter, $first: Int!, $skip: Int!) {
    trades(first: $first, skip: $skip, where: $where) {
      token { id }
      type bnbAmount
    }
  }
`;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class DiscoverService {
  constructor(private readonly price: PriceService) {}

  private withUsd<T extends Record<string, unknown>>(
    row: T,
  ): T & { priceUsd: string | null; marketCapUsd: string | null } {
    const bnbPrice = this.price.getPrice()?.bnbUsdt ?? null;
    const priceBnb = row["priceBnb"]     as string | null;
    const mcBnb    = row["marketCapBnb"] as string | null;
    return {
      ...row,
      priceUsd:     bnbPrice !== null && priceBnb !== null ? (parseFloat(priceBnb) * bnbPrice).toFixed(10) : null,
      marketCapUsd: bnbPrice !== null && mcBnb    !== null ? (parseFloat(mcBnb)    * bnbPrice).toFixed(2)  : null,
    };
  }

  async trending(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type = query["type"];
    validateType(type);

    // Window fallback: 5m → 1h → 24h → 7d → 30d
    const WINDOWS = [
      { secs:       300, label: "5m"  },
      { secs:     3_600, label: "1h"  },
      { secs:    86_400, label: "24h" },
      { secs:   604_800, label: "7d"  },
      { secs: 2_592_000, label: "30d" },
    ];

    const now  = Math.floor(Date.now() / 1000);
    let since  = now - WINDOWS[0].secs;
    let window = WINDOWS[0].label;

    // Find smallest window with at least one token traded
    for (const w of WINDOWS) {
      const candidate = now - w.secs;
      const { trades } = await subgraphFetch<{ trades: { token: { id: string } }[] }>(
        `query { trades(first: 1, where: { timestamp_gte: "${candidate}" }) { token { id } } }`,
      );
      if (trades.length > 0) { since = candidate; window = w.label; break; }
    }

    // Fetch all trades in the window
    const tradeWhere: Record<string, unknown> = { timestamp_gte: since.toString() };
    if (type) tradeWhere["token_"] = { tokenType: FROM_API_TYPE[type] };

    const allTrades = await subgraphFetchAll<{
      token: SubgraphToken;
      type: "BUY" | "SELL";
      bnbAmount: string;
    }>("trades", TRADES_WINDOW_QUERY, { where: tradeWhere });

    // Aggregate per token
    const tokenMap = new Map<string, {
      token: SubgraphToken;
      recentTrades: number;
      recentBuys: number;
      recentSells: number;
      recentVolumeBNB: bigint;
    }>();

    for (const t of allTrades) {
      const entry = tokenMap.get(t.token.id) ?? {
        token: t.token, recentTrades: 0, recentBuys: 0, recentSells: 0, recentVolumeBNB: 0n,
      };
      entry.recentTrades++;
      if (t.type === "BUY") entry.recentBuys++; else entry.recentSells++;
      entry.recentVolumeBNB += BigInt(t.bnbAmount);
      tokenMap.set(t.token.id, entry);
    }

    // Sort by recentTrades DESC then volume DESC
    const sorted = [...tokenMap.values()].sort((a, b) =>
      b.recentTrades !== a.recentTrades
        ? b.recentTrades - a.recentTrades
        : Number(b.recentVolumeBNB - a.recentVolumeBNB),
    );

    const total = sorted.length;
    const page_items = sorted.slice(offset, offset + limit).map(entry => this.withUsd({
      ...normalizeToken(entry.token),
      recentTrades:     entry.recentTrades,
      recentBuys:       entry.recentBuys,
      recentSells:      entry.recentSells,
      recentVolumeBNB:  entry.recentVolumeBNB.toString(),
    } as Record<string, unknown>));

    return { ...paginated(page_items, total, page, limit), window };
  }

  async newTokens(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type = query["type"];
    validateType(type);

    const where: Record<string, unknown> = { migrated: false };
    if (type) where["tokenType"] = FROM_API_TYPE[type];

    const [{ tokens }, total] = await Promise.all([
      subgraphFetch<{ tokens: SubgraphToken[] }>(TOKENS_QUERY, {
        first: limit, skip: offset,
        orderBy: "createdAtBlockNumber", orderDirection: "desc",
        where,
      }),
      subgraphCount("tokens", TOKENS_COUNT_QUERY, { where }),
    ]);

    return paginated(tokens.map(t => this.withUsd(normalizeToken(t))), total, page, limit);
  }

  async graduating(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type  = query["type"];
    validateType(type);

    const where: Record<string, unknown> = { migrated: false };
    if (type) where["tokenType"] = FROM_API_TYPE[type];

    const since24h = Math.floor(Date.now() / 1000) - 86_400;

    // Fetch non-migrated tokens sorted by raisedBNB (graduating progress)
    // and recent trade activity in parallel
    const [{ tokens }, recentTrades] = await Promise.all([
      subgraphFetch<{ tokens: SubgraphToken[] }>(TOKENS_QUERY, {
        first: 1000, skip: 0,
        orderBy: "raisedBNB", orderDirection: "desc",
        where,
      }),
      subgraphFetchAll<{ token: { id: string }; type: "BUY" | "SELL"; bnbAmount: string }>(
        "trades",
        RECENT_TRADES_FOR_TOKENS_QUERY,
        { where: { timestamp_gte: since24h.toString(), token_: { migrated: false } } },
      ),
    ]);

    // Build per-token recent stats map
    const recentMap = new Map<string, { trades: number; volumeBNB: bigint }>();
    for (const t of recentTrades) {
      const entry = recentMap.get(t.token.id) ?? { trades: 0, volumeBNB: 0n };
      entry.trades++;
      entry.volumeBNB += BigInt(t.bnbAmount);
      recentMap.set(t.token.id, entry);
    }

    const total = tokens.length;
    const page_items = tokens.slice(offset, offset + limit).map(t => {
      const recent = recentMap.get(t.id) ?? { trades: 0, volumeBNB: 0n };
      const progress = BigInt(t.migrationTarget) > 0n
        ? (Number(BigInt(t.raisedBNB) * 10000n / BigInt(t.migrationTarget)) / 100).toFixed(2)
        : "0.00";
      return this.withUsd({
        ...normalizeToken(t),
        recentTrades:       recent.trades,
        recentVolumeBNB:    recent.volumeBNB.toString(),
        graduatingProgress: progress,
      } as Record<string, unknown>);
    });

    return paginated(page_items, total, page, limit);
  }

  async migrated(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type     = query["type"];
    validateType(type);
    const orderDir = parseOrderDir(query).toLowerCase() as "asc" | "desc";

    const ALLOWED_ORDER = ["migratedAt", "liquidityBNB", "volumeBNB"] as const;
    type AllowedOrder = typeof ALLOWED_ORDER[number];
    const orderByRaw = query["orderBy"] ?? "migratedAt";
    const orderBy: AllowedOrder = (ALLOWED_ORDER as readonly string[]).includes(orderByRaw)
      ? orderByRaw as AllowedOrder
      : "migratedAt";

    const subgraphOrderBy =
      orderBy === "migratedAt"   ? "migratedAtBlockNumber" :
      orderBy === "liquidityBNB" ? "migrationBNB"          :
      "raisedBNB"; // volumeBNB proxy

    const where: Record<string, unknown> = { migrated: true };
    if (type) where["tokenType"] = FROM_API_TYPE[type];

    const MIGRATED_TOKENS_QUERY = /* GraphQL */ `
      query MigratedTokens(
        $first: Int!, $skip: Int!
        $orderBy: Token_orderBy!, $orderDirection: OrderDirection!
        $where: Token_filter
      ) {
        tokens(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection, where: $where) {
          ${TOKEN_FIELDS}
          migrations(first: 1) { txHash }
        }
      }
    `;

    const [{ tokens }, total] = await Promise.all([
      subgraphFetch<{ tokens: (SubgraphToken & { migrations: { txHash: string }[] })[] }>(
        MIGRATED_TOKENS_QUERY,
        { first: limit, skip: offset, orderBy: subgraphOrderBy, orderDirection: orderDir, where },
      ),
      subgraphCount("tokens", TOKENS_COUNT_QUERY, { where }),
    ]);

    return paginated(
      tokens.map(t => this.withUsd({
        ...normalizeToken(t),
        liquidityBNB:     t.migrationBNB     ?? null,
        liquidityTokens:  t.migrationLiquidityTokens ?? null,
        migratedAtBlock:  t.migratedAtBlockNumber ?? null,
        migratedAt:       t.migratedAtTimestamp ? parseInt(t.migratedAtTimestamp) : null,
        migrationTxHash:  t.migrations[0]?.txHash ?? null,
      } as Record<string, unknown>)),
      total,
      page,
      limit,
    );
  }
}
