import { Injectable, BadRequestException } from "@nestjs/common";
import { subgraphFetchAll, subgraphCount } from "../../subgraph";
import { paginated, parsePagination } from "../../helpers";
import { TO_API_TYPE } from "../../token-utils";

const PERIODS = {
  "1d":      86_400,
  "7d":      86_400 * 7,
  "30d":     86_400 * 30,
  "alltime": null,
} as const;

type Period = keyof typeof PERIODS;

function sinceTs(periodKey: Period): number | null {
  const secs = PERIODS[periodKey];
  return secs ? Math.floor(Date.now() / 1000) - secs : null;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

const TOKENS_LB_QUERY = /* GraphQL */ `
  query TokensLB($first: Int!, $skip: Int!, $where: Token_filter) {
    tokens(first: $first, skip: $skip, where: $where, orderBy: createdAtTimestamp, orderDirection: asc) {
      id tokenType creator migrated raisedBNB
      buysCount sellsCount totalVolumeBNBBuy totalVolumeBNBSell createdAtTimestamp
    }
  }
`;

const TRADES_LB_QUERY = /* GraphQL */ `
  query TradesLB($first: Int!, $skip: Int!, $where: Trade_filter) {
    trades(first: $first, skip: $skip, where: $where, orderBy: timestamp, orderDirection: asc) {
      token { id tokenType creator migrated raisedBNB buysCount sellsCount totalVolumeBNBBuy totalVolumeBNBSell createdAtTimestamp }
      trader type bnbAmount timestamp
    }
  }
`;

// ─── JS aggregation helpers ───────────────────────────────────────────────────

interface TokenStats {
  address: string;
  tokenType: string;
  creator: string;
  migrated: boolean;
  volumeBNB: bigint;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  raisedBNB: bigint;
  createdAt: number;
}

interface TraderStats {
  address: string;
  volumeBNB: bigint;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  tokensTraded: Set<string>;
  lastTradeAt: number;
}

interface CreatorStats {
  address: string;
  tokensLaunched: number;
  tokensMigrated: number;
  totalRaisedBNB: bigint;
  lastLaunchAt: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class LeaderboardService {

  async tokens(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const periodKey = (query["period"] ?? "alltime") as Period;
    if (!(periodKey in PERIODS)) throw new BadRequestException(`Invalid period. Allowed: ${Object.keys(PERIODS).join(", ")}`);

    const allowed = ["volumeBNB", "tradeCount", "buyCount", "sellCount", "raisedBNB"];
    const orderBy = query["orderBy"] ?? "volumeBNB";
    if (!allowed.includes(orderBy)) throw new BadRequestException(`Invalid orderBy. Allowed: ${allowed.join(", ")}`);

    const since = sinceTs(periodKey);

    let stats: TokenStats[];

    if (since === null) {
      // Alltime: use pre-aggregated token entity fields
      const tokens = await subgraphFetchAll<{
        id: string; tokenType: string; creator: string; migrated: boolean;
        raisedBNB: string; buysCount: string; sellsCount: string;
        totalVolumeBNBBuy: string; totalVolumeBNBSell: string; createdAtTimestamp: string;
      }>("tokens", TOKENS_LB_QUERY, { where: undefined });

      stats = tokens.map(t => ({
        address:    t.id,
        tokenType:  TO_API_TYPE[t.tokenType] ?? t.tokenType,
        creator:    t.creator,
        migrated:   t.migrated,
        volumeBNB:  BigInt(t.totalVolumeBNBBuy) + BigInt(t.totalVolumeBNBSell),
        tradeCount: parseInt(t.buysCount) + parseInt(t.sellsCount),
        buyCount:   parseInt(t.buysCount),
        sellCount:  parseInt(t.sellsCount),
        raisedBNB:  BigInt(t.raisedBNB),
        createdAt:  parseInt(t.createdAtTimestamp),
      }));
    } else {
      // Time-filtered: aggregate from trades in the period
      const trades = await subgraphFetchAll<{
        token: { id: string; tokenType: string; creator: string; migrated: boolean; raisedBNB: string; createdAtTimestamp: string };
        type: string; bnbAmount: string;
      }>("trades", TRADES_LB_QUERY, { where: { timestamp_gte: since.toString() } });

      const map = new Map<string, TokenStats>();
      for (const t of trades) {
        const entry = map.get(t.token.id) ?? {
          address:    t.token.id,
          tokenType:  TO_API_TYPE[t.token.tokenType] ?? t.token.tokenType,
          creator:    t.token.creator,
          migrated:   t.token.migrated,
          volumeBNB:  0n,
          tradeCount: 0,
          buyCount:   0,
          sellCount:  0,
          raisedBNB:  BigInt(t.token.raisedBNB),
          createdAt:  parseInt(t.token.createdAtTimestamp),
        };
        entry.volumeBNB += BigInt(t.bnbAmount);
        entry.tradeCount++;
        if (t.type === "BUY") entry.buyCount++; else entry.sellCount++;
        map.set(t.token.id, entry);
      }
      stats = [...map.values()];
    }

    // Sort
    stats.sort((a, b) => {
      const av = orderBy === "raisedBNB" ? a.raisedBNB : BigInt(a[orderBy as keyof TokenStats] as number);
      const bv = orderBy === "raisedBNB" ? b.raisedBNB : BigInt(b[orderBy as keyof TokenStats] as number);
      return bv > av ? 1 : bv < av ? -1 : 0;
    });

    const total = stats.length;
    const rows  = stats.slice(offset, offset + limit).map(s => ({
      address:    s.address,
      tokenType:  s.tokenType,
      creator:    s.creator,
      migrated:   s.migrated,
      volumeBNB:  s.volumeBNB.toString(),
      tradeCount: s.tradeCount,
      buyCount:   s.buyCount,
      sellCount:  s.sellCount,
      raisedBNB:  s.raisedBNB.toString(),
      createdAt:  s.createdAt,
    }));

    return { ...paginated(rows, total, page, limit), period: periodKey, orderBy };
  }

  async creators(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const periodKey = (query["period"] ?? "alltime") as Period;
    if (!(periodKey in PERIODS)) throw new BadRequestException(`Invalid period. Allowed: ${Object.keys(PERIODS).join(", ")}`);

    const since = sinceTs(periodKey);
    const tokenWhere = since !== null ? { createdAtTimestamp_gte: since.toString() } : undefined;

    const tokens = await subgraphFetchAll<{
      id: string; creator: string; migrated: boolean;
      raisedBNB: string; totalVolumeBNBBuy: string; totalVolumeBNBSell: string; createdAtTimestamp: string;
    }>("tokens", TOKENS_LB_QUERY, { where: tokenWhere });

    const map = new Map<string, CreatorStats>();
    for (const t of tokens) {
      const entry = map.get(t.creator) ?? {
        address:        t.creator,
        tokensLaunched: 0,
        tokensMigrated: 0,
        totalRaisedBNB: 0n,
        lastLaunchAt:   0,
      };
      entry.tokensLaunched++;
      if (t.migrated) entry.tokensMigrated++;
      entry.totalRaisedBNB += BigInt(t.raisedBNB);
      const ts = parseInt(t.createdAtTimestamp);
      if (ts > entry.lastLaunchAt) entry.lastLaunchAt = ts;
      map.set(t.creator, entry);
    }

    const stats = [...map.values()].sort((a, b) =>
      b.tokensLaunched !== a.tokensLaunched
        ? b.tokensLaunched - a.tokensLaunched
        : Number(b.totalRaisedBNB - a.totalRaisedBNB),
    );

    const total = stats.length;
    const rows = stats.slice(offset, offset + limit).map(s => ({
      address:        s.address,
      tokensLaunched: s.tokensLaunched,
      tokensMigrated: s.tokensMigrated,
      totalRaisedBNB: s.totalRaisedBNB.toString(),
      lastLaunchAt:   s.lastLaunchAt,
    }));

    return { ...paginated(rows, total, page, limit), period: periodKey };
  }

  async traders(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const periodKey = (query["period"] ?? "alltime") as Period;
    if (!(periodKey in PERIODS)) throw new BadRequestException(`Invalid period. Allowed: ${Object.keys(PERIODS).join(", ")}`);

    const since = sinceTs(periodKey);
    const where = since !== null ? { timestamp_gte: since.toString() } : undefined;

    const trades = await subgraphFetchAll<{
      token: { id: string }; trader: string; type: string; bnbAmount: string; timestamp: string;
    }>("trades", TRADES_LB_QUERY, { where });

    const map = new Map<string, TraderStats>();
    for (const t of trades) {
      const entry = map.get(t.trader) ?? {
        address:      t.trader,
        volumeBNB:    0n,
        tradeCount:   0,
        buyCount:     0,
        sellCount:    0,
        tokensTraded: new Set<string>(),
        lastTradeAt:  0,
      };
      entry.volumeBNB += BigInt(t.bnbAmount);
      entry.tradeCount++;
      if (t.type === "BUY") entry.buyCount++; else entry.sellCount++;
      entry.tokensTraded.add(t.token.id);
      const ts = parseInt(t.timestamp);
      if (ts > entry.lastTradeAt) entry.lastTradeAt = ts;
      map.set(t.trader, entry);
    }

    const stats = [...map.values()].sort((a, b) => Number(b.volumeBNB - a.volumeBNB));

    const total = stats.length;
    const rows = stats.slice(offset, offset + limit).map(s => ({
      address:      s.address,
      volumeBNB:    s.volumeBNB.toString(),
      tradeCount:   s.tradeCount,
      buyCount:     s.buyCount,
      sellCount:    s.sellCount,
      tokensTraded: s.tokensTraded.size,
      lastTradeAt:  s.lastTradeAt,
    }));

    return { ...paginated(rows, total, page, limit), period: periodKey };
  }

  async users(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const periodKey = (query["period"] ?? "alltime") as Period;
    if (!(periodKey in PERIODS)) throw new BadRequestException(`Invalid period. Allowed: ${Object.keys(PERIODS).join(", ")}`);

    const since = sinceTs(periodKey);
    const tradeWhere  = since !== null ? { timestamp_gte: since.toString() } : undefined;
    const tokenWhere  = since !== null ? { createdAtTimestamp_gte: since.toString() } : undefined;

    const [trades, tokens] = await Promise.all([
      subgraphFetchAll<{
        token: { id: string }; trader: string; type: string; bnbAmount: string; timestamp: string;
      }>("trades", TRADES_LB_QUERY, { where: tradeWhere }),
      subgraphFetchAll<{
        id: string; creator: string; migrated: boolean; raisedBNB: string;
      }>("tokens", TOKENS_LB_QUERY, { where: tokenWhere }),
    ]);

    // Build trader stats
    const traderMap = new Map<string, TraderStats>();
    for (const t of trades) {
      const e = traderMap.get(t.trader) ?? {
        address: t.trader, volumeBNB: 0n, tradeCount: 0, buyCount: 0,
        sellCount: 0, tokensTraded: new Set<string>(), lastTradeAt: 0,
      };
      e.volumeBNB += BigInt(t.bnbAmount);
      e.tradeCount++;
      if (t.type === "BUY") e.buyCount++; else e.sellCount++;
      e.tokensTraded.add(t.token.id);
      const ts = parseInt(t.timestamp);
      if (ts > e.lastTradeAt) e.lastTradeAt = ts;
      traderMap.set(t.trader, e);
    }

    // Build creator stats
    const creatorMap = new Map<string, CreatorStats>();
    for (const t of tokens) {
      const e = creatorMap.get(t.creator) ?? {
        address: t.creator, tokensLaunched: 0, tokensMigrated: 0, totalRaisedBNB: 0n, lastLaunchAt: 0,
      };
      e.tokensLaunched++;
      if (t.migrated) e.tokensMigrated++;
      e.totalRaisedBNB += BigInt(t.raisedBNB);
      creatorMap.set(t.creator, e);
    }

    // FULL OUTER JOIN by address
    const allAddresses = new Set([...traderMap.keys(), ...creatorMap.keys()]);
    const combined = [...allAddresses].map(addr => {
      const tr = traderMap.get(addr);
      const cr = creatorMap.get(addr);
      return {
        address:        addr,
        volumeBNB:      (tr?.volumeBNB ?? 0n).toString(),
        tradeCount:     tr?.tradeCount   ?? 0,
        buyCount:       tr?.buyCount     ?? 0,
        sellCount:      tr?.sellCount    ?? 0,
        tokensTraded:   tr?.tokensTraded.size ?? 0,
        lastTradeAt:    tr?.lastTradeAt  ?? null,
        tokensLaunched: cr?.tokensLaunched ?? 0,
        tokensMigrated: cr?.tokensMigrated ?? 0,
        totalRaisedBNB: (cr?.totalRaisedBNB ?? 0n).toString(),
      };
    });

    // Sort by volumeBNB DESC then tokensLaunched DESC
    combined.sort((a, b) => {
      const vd = BigInt(b.volumeBNB) - BigInt(a.volumeBNB);
      if (vd !== 0n) return vd > 0n ? 1 : -1;
      return b.tokensLaunched - a.tokensLaunched;
    });

    const total = combined.length;
    return { ...paginated(combined.slice(offset, offset + limit), total, page, limit), period: periodKey };
  }
}
