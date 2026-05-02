import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import {
  DexEndpoint,
  DEX_PROTOCOL_ENDPOINTS,
  dexFetch,
  dexFetchFrom,
  dexCount,
  mainFetch,
} from "./dex-subgraph";
import { ADAPTER_IDS, ADAPTER_NAMES } from "./dex-rpc";
import { isAddress, normalizeAddress, paginated, parsePagination, parseOrderBy, parseOrderDir } from "../../helpers";

// ─── Aggregator subgraph types (FOURMEME / FLAPSH bonding-curve + Aggregator swaps) ──

interface AggToken {
  id:                  string;
  name:                string | null;
  symbol:              string | null;
  decimals:            string;
  launchPlatform:      string | null;
  graduated:           boolean;
  currentPriceBNB:     string;
  currentPriceUSD:     string;
  currentMarketCapBNB: string;
  currentMarketCapUSD: string;
  currentLiquidityBNB: string;
  bondingVolumeBNB:    string;
  dexVolumeBNB:        string;
  bondingBuysCount:    string;
  bondingSellsCount:   string;
  dexTradesCount:      string;
  createdAtTimestamp:  string;
}

interface AggBondingTrade {
  id:          string;
  token:       { id: string; name: string | null; symbol: string | null };
  trader:      string;
  type:        "BUY" | "SELL";
  bnbAmount:   string;
  tokenAmount: string;
  platform:    string;
  timestamp:   string;
  txHash:      string;
}

interface AggSwap {
  id:            string;
  user:          string;
  adapterId:     string;
  adapterName:   string;
  tokenIn:       { id: string; symbol: string | null };
  tokenOut:      { id: string; symbol: string | null };
  grossAmountIn: string;
  feeCharged:    string;
  amountOut:     string;
  timestamp:     string;
  txHash:        string;
}

interface AggGlobalState { id: string; bnbPriceUSD: string; lastUpdated: string }
interface AggProtocol    { id: string; totalSwaps: string; totalVolumeBNB: string; totalFeesBNB: string; uniqueUsers: string }

// ─── Main launchpad subgraph types (1MEME tokens + trades via SUBGRAPH_URL) ──

interface MainToken {
  id:           string;
  name:         string | null;
  symbol:       string | null;
  decimals:     string;
  raisedBNB:    string;
  buysCount:    string;
  sellsCount:   string;
  migration:    { pair: string } | null;
  createdAtBlock: string;
}

interface MainTrade {
  id:          string;
  token:       { id: string; name: string | null; symbol: string | null };
  trader:      string;
  type:        "BUY" | "SELL";
  bnbAmount:   string;
  tokenAmount: string;
  timestamp:   string;
  txHash:      string;
}

// ─── DEX protocol token subgraph types ───────────────────────────────────────

interface DexV2Token {
  id:             string;
  name:           string | null;
  symbol:         string | null;
  decimals:       string;
  tradeVolumeUSD: string;
  txCount:        string;
}

interface DexV3Token {
  id:                  string;
  name:                string | null;
  symbol:              string | null;
  decimals:            string;
  volumeUSD:           string;
  totalValueLockedUSD: string;
  txCount:             string;
}

// ─── DEX pool subgraph types (PancakeSwap / Uniswap V2 / V3 / V4) ────────────

interface V2Pair {
  id:                 string;
  token0:             { id: string; symbol: string | null };
  token1:             { id: string; symbol: string | null };
  reserveUSD:         string;
  volumeUSD:          string;
  txCount:            string;
  createdAtTimestamp: string;
}

interface V3Pool {
  id:                  string;
  token0:              { id: string; symbol: string | null };
  token1:              { id: string; symbol: string | null };
  feeTier:             string;
  liquidity:           string;
  totalValueLockedUSD: string;
  volumeUSD:           string;
  txCount:             string;
  createdAtTimestamp:  string;
}

// ─── Aggregator queries ───────────────────────────────────────────────────────

const AGG_TOKENS_QUERY = /* GraphQL */ `
  query AggTokens($first: Int!, $skip: Int!, $orderBy: Token_orderBy!, $orderDirection: OrderDirection!, $where: Token_filter) {
    tokens(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection, where: $where) {
      id name symbol decimals launchPlatform graduated
      currentPriceBNB currentPriceUSD currentMarketCapBNB currentMarketCapUSD currentLiquidityBNB
      bondingVolumeBNB dexVolumeBNB bondingBuysCount bondingSellsCount dexTradesCount
      createdAtTimestamp
    }
  }
`;

const AGG_TOKEN_QUERY = /* GraphQL */ `
  query AggToken($id: ID!) {
    token(id: $id) {
      id name symbol decimals launchPlatform graduated
      currentPriceBNB currentPriceUSD currentMarketCapBNB currentMarketCapUSD currentLiquidityBNB
      bondingVolumeBNB dexVolumeBNB bondingBuysCount bondingSellsCount dexTradesCount
      createdAtTimestamp
    }
  }
`;

const AGG_BONDING_TRADES_QUERY = /* GraphQL */ `
  query AggBondingTrades($first: Int!, $skip: Int!, $where: BondingTrade_filter) {
    bondingTrades(first: $first, skip: $skip, where: $where, orderBy: timestamp, orderDirection: desc) {
      id trader type bnbAmount tokenAmount platform timestamp txHash
      token { id name symbol }
    }
  }
`;

const AGG_SWAPS_QUERY = /* GraphQL */ `
  query AggSwaps($first: Int!, $skip: Int!, $where: Swap_filter) {
    swaps(first: $first, skip: $skip, where: $where, orderBy: timestamp, orderDirection: desc) {
      id user adapterId adapterName grossAmountIn feeCharged amountOut timestamp txHash
      tokenIn  { id symbol }
      tokenOut { id symbol }
    }
  }
`;

const AGG_GLOBAL_QUERY = /* GraphQL */ `
  query AggGlobal {
    globalState(id: "global") { id bnbPriceUSD lastUpdated }
    protocol(id: "aggregator") { id totalSwaps totalVolumeBNB totalFeesBNB uniqueUsers }
  }
`;

const AGG_TOKENS_COUNT_QUERY = /* GraphQL */ `
  query AggTokensCount($first: Int!, $skip: Int!, $where: Token_filter) {
    tokens(first: $first, skip: $skip, where: $where) { id }
  }
`;

const AGG_SWAPS_COUNT_QUERY = /* GraphQL */ `
  query AggSwapsCount($first: Int!, $skip: Int!, $where: Swap_filter) {
    swaps(first: $first, skip: $skip, where: $where) { id }
  }
`;

// ─── Main launchpad queries ───────────────────────────────────────────────────

const MAIN_TOKENS_QUERY = /* GraphQL */ `
  query MainTokens($first: Int!, $skip: Int!, $orderBy: Token_orderBy!, $orderDirection: OrderDirection!, $where: Token_filter) {
    tokens(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection, where: $where) {
      id name symbol decimals raisedBNB buysCount sellsCount createdAtBlock
      migration { pair }
    }
  }
`;

const MAIN_TOKEN_QUERY = /* GraphQL */ `
  query MainToken($id: ID!) {
    token(id: $id) {
      id name symbol decimals raisedBNB buysCount sellsCount createdAtBlock
      migration { pair }
    }
  }
`;

const MAIN_TRADES_QUERY = /* GraphQL */ `
  query MainTrades($first: Int!, $skip: Int!, $where: Trade_filter) {
    trades(first: $first, skip: $skip, where: $where, orderBy: timestamp, orderDirection: desc) {
      id trader type bnbAmount tokenAmount timestamp txHash
      token { id name symbol }
    }
  }
`;

const MAIN_TOKENS_COUNT_QUERY = /* GraphQL */ `
  query MainTokensCount($first: Int!, $skip: Int!, $where: Token_filter) {
    tokens(first: $first, skip: $skip, where: $where) { id }
  }
`;

// ─── DEX protocol token queries ──────────────────────────────────────────────

const V2_TOKENS_QUERY = /* GraphQL */ `
  query V2Tokens($first: Int!, $skip: Int!, $where: Token_filter) {
    tokens(first: $first, skip: $skip, orderBy: tradeVolumeUSD, orderDirection: desc, where: $where) {
      id name symbol decimals tradeVolumeUSD txCount
    }
  }
`;

const V3_TOKENS_QUERY = /* GraphQL */ `
  query V3Tokens($first: Int!, $skip: Int!, $where: Token_filter) {
    tokens(first: $first, skip: $skip, orderBy: volumeUSD, orderDirection: desc, where: $where) {
      id name symbol decimals volumeUSD totalValueLockedUSD txCount
    }
  }
`;

const V2_TOKEN_QUERY = /* GraphQL */ `
  query V2Token($id: ID!) {
    token(id: $id) { id name symbol decimals tradeVolumeUSD txCount }
  }
`;

const V3_TOKEN_QUERY = /* GraphQL */ `
  query V3Token($id: ID!) {
    token(id: $id) { id name symbol decimals volumeUSD totalValueLockedUSD txCount }
  }
`;

// Platform filter → DexEndpoint (for the 6 DEX protocol platforms)
const DEX_PLATFORM_TO_ENDPOINT: Record<string, DexEndpoint> = {
  "PANCAKESWAP-V2": "PANCAKE_V2",
  "PANCAKESWAP-V3": "PANCAKE_V3",
  "PANCAKESWAP-V4": "PANCAKE_V4",
  "UNISWAP-V2":     "UNISWAP_V2",
  "UNISWAP-V3":     "UNISWAP_V3",
  "UNISWAP-V4":     "UNISWAP_V4",
};

const ALL_PLATFORMS = [
  "1MEME", "FOURMEME", "FLAPSH",
  "PANCAKESWAP-V2", "PANCAKESWAP-V3", "PANCAKESWAP-V4",
  "UNISWAP-V2", "UNISWAP-V3", "UNISWAP-V4",
];

// ─── V2 pool queries (PancakeSwap V2 / Uniswap V2) ───────────────────────────

const V2_POOLS_QUERY = /* GraphQL */ `
  query V2Pools($addr: String!, $first: Int!) {
    t0: pairs(first: $first, where: { token0: $addr }, orderBy: volumeUSD, orderDirection: desc) {
      id token0 { id symbol } token1 { id symbol }
      reserveUSD volumeUSD txCount createdAtTimestamp
    }
    t1: pairs(first: $first, where: { token1: $addr }, orderBy: volumeUSD, orderDirection: desc) {
      id token0 { id symbol } token1 { id symbol }
      reserveUSD volumeUSD txCount createdAtTimestamp
    }
  }
`;

// ─── V3/V4 pool queries (PancakeSwap V3/V4 / Uniswap V3/V4) ─────────────────

const V3_POOLS_QUERY = /* GraphQL */ `
  query V3Pools($addr: String!, $first: Int!) {
    t0: pools(first: $first, where: { token0: $addr }, orderBy: volumeUSD, orderDirection: desc) {
      id token0 { id symbol } token1 { id symbol }
      feeTier liquidity totalValueLockedUSD volumeUSD txCount createdAtTimestamp
    }
    t1: pools(first: $first, where: { token1: $addr }, orderBy: volumeUSD, orderDirection: desc) {
      id token0 { id symbol } token1 { id symbol }
      feeTier liquidity totalValueLockedUSD volumeUSD txCount createdAtTimestamp
    }
  }
`;

// ─── Endpoint → query/schema mapping ─────────────────────────────────────────

function poolQueryForEndpoint(endpoint: DexEndpoint): string {
  return endpoint === "PANCAKE_V2" || endpoint === "UNISWAP_V2"
    ? V2_POOLS_QUERY
    : V3_POOLS_QUERY;
}

function poolTypeFor(endpoint: DexEndpoint): string {
  if (endpoint.endsWith("_V2")) return "V2";
  if (endpoint.endsWith("_V3")) return "V3";
  return "V4";
}

function dexNameFor(endpoint: DexEndpoint): string {
  return endpoint; // "PANCAKE_V2", "UNISWAP_V3", etc.
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeAggToken(t: AggToken) {
  const bondingTrades = parseInt(t.bondingBuysCount) + parseInt(t.bondingSellsCount);
  const dexTrades     = parseInt(t.dexTradesCount);
  return {
    address:             t.id,
    name:                t.name   ?? null,
    symbol:              t.symbol ?? null,
    decimals:            parseInt(t.decimals),
    platforms:           t.launchPlatform ? [t.launchPlatform] : [],
    bondingPhase:        !t.graduated,
    bondingCurve:        null as string | null,
    pairAddress:         null as string | null,
    currentPriceBNB:     t.currentPriceBNB,
    currentPriceUSD:     t.currentPriceUSD,
    currentMarketCapBNB: t.currentMarketCapBNB,
    currentMarketCapUSD: t.currentMarketCapUSD,
    currentLiquidityBNB: t.currentLiquidityBNB,
    totalVolumeBNB:      t.bondingVolumeBNB,
    dexVolumeBNB:        t.dexVolumeBNB,
    tradeCount:          bondingTrades + dexTrades,
    createdAtTimestamp:  parseInt(t.createdAtTimestamp),
    source:              "aggregator" as const,
  };
}

function normalizeMainToken(t: MainToken) {
  return {
    address:             t.id,
    name:                t.name   ?? null,
    symbol:              t.symbol ?? null,
    decimals:            parseInt(t.decimals),
    platforms:           ["1MEME"],
    bondingPhase:        !t.migration,
    bondingCurve:        null as string | null,
    pairAddress:         t.migration?.pair ?? null,
    currentPriceBNB:     null as string | null,
    currentPriceUSD:     null as string | null,
    currentMarketCapBNB: null as string | null,
    currentMarketCapUSD: null as string | null,
    currentLiquidityBNB: null as string | null,
    totalVolumeBNB:      t.raisedBNB,
    tradeCount:          parseInt(t.buysCount) + parseInt(t.sellsCount),
    createdAtTimestamp:  0, // main subgraph exposes block number, not unix timestamp
    source:              "main" as const,
  };
}

function normalizeV2Pool(p: V2Pair, endpoint: DexEndpoint) {
  return {
    address:            p.id,
    dex:                dexNameFor(endpoint),
    poolType:           "V2",
    feeTier:            null as number | null,
    token0:             { address: p.token0.id, symbol: p.token0.symbol ?? null },
    token1:             { address: p.token1.id, symbol: p.token1.symbol ?? null },
    liquidity:          p.reserveUSD,
    volumeUSD:          p.volumeUSD,
    txCount:            parseInt(p.txCount),
    createdAtTimestamp: parseInt(p.createdAtTimestamp),
  };
}

function normalizeV3Pool(p: V3Pool, endpoint: DexEndpoint) {
  return {
    address:            p.id,
    dex:                dexNameFor(endpoint),
    poolType:           poolTypeFor(endpoint),
    feeTier:            p.feeTier ? parseInt(p.feeTier) : null,
    token0:             { address: p.token0.id, symbol: p.token0.symbol ?? null },
    token1:             { address: p.token1.id, symbol: p.token1.symbol ?? null },
    liquidity:          p.liquidity,
    volumeUSD:          p.volumeUSD,
    txCount:            parseInt(p.txCount),
    createdAtTimestamp: parseInt(p.createdAtTimestamp),
  };
}

function normalizeDexV2Token(t: DexV2Token, platform: string) {
  return {
    address:             t.id,
    name:                t.name   ?? null,
    symbol:              t.symbol ?? null,
    decimals:            parseInt(t.decimals),
    platforms:           [platform],
    bondingPhase:        false,
    bondingCurve:        null as string | null,
    pairAddress:         null as string | null,
    currentPriceBNB:     null as string | null,
    currentPriceUSD:     null as string | null,
    currentMarketCapBNB: null as string | null,
    currentMarketCapUSD: null as string | null,
    currentLiquidityBNB: null as string | null,
    totalVolumeBNB:      null as string | null,
    tradeCount:          parseInt(t.txCount),
    createdAtTimestamp:  0,
    source:              "dex" as const,
  };
}

function normalizeDexV3Token(t: DexV3Token, platform: string) {
  return {
    address:             t.id,
    name:                t.name   ?? null,
    symbol:              t.symbol ?? null,
    decimals:            parseInt(t.decimals),
    platforms:           [platform],
    bondingPhase:        false,
    bondingCurve:        null as string | null,
    pairAddress:         null as string | null,
    currentPriceBNB:     null as string | null,
    currentPriceUSD:     null as string | null,
    currentMarketCapBNB: null as string | null,
    currentMarketCapUSD: null as string | null,
    currentLiquidityBNB: null as string | null,
    totalVolumeBNB:      null as string | null,
    tradeCount:          parseInt(t.txCount),
    createdAtTimestamp:  0,
    source:              "dex" as const,
  };
}

function normalizeBondingTrade(t: AggBondingTrade) {
  return {
    id:          t.id,
    token:       t.token.id,
    tokenName:   t.token.name   ?? null,
    tokenSymbol: t.token.symbol ?? null,
    trader:      t.trader,
    tradeType:   t.type === "BUY" ? "buy" : "sell",
    bnbAmount:   t.bnbAmount,
    tokenAmount: t.tokenAmount,
    platform:    t.platform,
    timestamp:   parseInt(t.timestamp),
    txHash:      t.txHash,
  };
}

function normalizeMainTrade(t: MainTrade) {
  return {
    id:          t.id,
    token:       t.token.id,
    tokenName:   t.token.name   ?? null,
    tokenSymbol: t.token.symbol ?? null,
    trader:      t.trader,
    tradeType:   t.type === "BUY" ? "buy" : "sell",
    bnbAmount:   t.bnbAmount,
    tokenAmount: t.tokenAmount,
    platform:    "1MEME",
    timestamp:   parseInt(t.timestamp),
    txHash:      t.txHash,
  };
}

function normalizeSwap(s: AggSwap) {
  return {
    id:            s.id,
    user:          s.user,
    adapterId:     s.adapterId,
    adapterName:   s.adapterName,
    tokenIn:       { address: s.tokenIn.id,  symbol: s.tokenIn.symbol  ?? null },
    tokenOut:      { address: s.tokenOut.id, symbol: s.tokenOut.symbol ?? null },
    grossAmountIn: s.grossAmountIn,
    feeCharged:    s.feeCharged,
    amountOut:     s.amountOut,
    timestamp:     parseInt(s.timestamp),
    txHash:        s.txHash,
  };
}

// ─── Sort fields ──────────────────────────────────────────────────────────────

const TOKEN_ORDER_MAP: Record<string, string> = {
  createdAtTimestamp:  "createdAtTimestamp",
  totalVolumeBNB:      "bondingVolumeBNB",
  tradeCount:          "bondingBuysCount",
  currentMarketCapBNB: "currentMarketCapBNB",
  currentLiquidityBNB: "currentLiquidityBNB",
};

const MAIN_ORDER_MAP: Record<string, string> = {
  createdAtTimestamp:  "createdAtBlock",
  totalVolumeBNB:      "raisedBNB",
  tradeCount:          "buysCount",
  currentMarketCapBNB: "raisedBNB",
  currentLiquidityBNB: "raisedBNB",
};

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class DexService {

  // ── GET /dex/tokens ──────────────────────────────────────────────────────────
  //
  // Routing by platform filter:
  //   1MEME                        → MAIN subgraph (launchpad token schema)
  //   FOURMEME | FLAPSH            → AGGREGATOR subgraph
  //   PANCAKESWAP-V2/V3/V4         → respective PancakeSwap subgraph
  //   UNISWAP-V2/V3/V4             → respective Uniswap subgraph
  //   (none)                       → MAIN + AGGREGATOR merged (bonding-curve platforms only)

  async listTokens(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const platform = query["platform"]?.toUpperCase();
    const bonding  = query["bondingPhase"];
    const search   = query["search"];

    if (platform && !ALL_PLATFORMS.includes(platform)) {
      throw new BadRequestException(
        `platform must be one of: ${ALL_PLATFORMS.join(", ")}`,
      );
    }

    const ALLOWED_ORDER = Object.keys(TOKEN_ORDER_MAP) as (keyof typeof TOKEN_ORDER_MAP)[];
    const orderKey  = parseOrderBy(query, ALLOWED_ORDER, "createdAtTimestamp");
    const orderDir  = parseOrderDir(query).toLowerCase() as "asc" | "desc";

    const dexEndpoint = platform ? DEX_PLATFORM_TO_ENDPOINT[platform] : undefined;
    const useMain     = !platform || platform === "1MEME";
    const useAgg      = !platform || platform === "FOURMEME" || platform === "FLAPSH";
    const useDex      = !!dexEndpoint;

    // ── DEX protocol subgraph query ──────────────────────────────────────────
    if (useDex) {
      const ep   = dexEndpoint!;
      const isV2 = ep === "PANCAKE_V2" || ep === "UNISWAP_V2";
      const dexWhere: Record<string, unknown> = {};
      if (search) dexWhere["symbol_contains_nocase"] = search;

      if (isV2) {
        const data = await dexFetchFrom<{ tokens: DexV2Token[] }>(ep, V2_TOKENS_QUERY, {
          first: limit, skip: offset,
          where: Object.keys(dexWhere).length ? dexWhere : undefined,
        }).catch(() => ({ tokens: [] as DexV2Token[] }));
        const rows  = data.tokens.map(t => normalizeDexV2Token(t, platform!));
        // Use sentinel total: if we got a full page, signal that more may exist
        const total = rows.length < limit ? offset + rows.length : offset + limit + 1;
        return paginated(rows, total, page, limit);
      } else {
        const data = await dexFetchFrom<{ tokens: DexV3Token[] }>(ep, V3_TOKENS_QUERY, {
          first: limit, skip: offset,
          where: Object.keys(dexWhere).length ? dexWhere : undefined,
        }).catch(() => ({ tokens: [] as DexV3Token[] }));
        const rows  = data.tokens.map(t => normalizeDexV3Token(t, platform!));
        const total = rows.length < limit ? offset + rows.length : offset + limit + 1;
        return paginated(rows, total, page, limit);
      }
    }

    // ── MAIN + AGGREGATOR merge ───────────────────────────────────────────────
    const mainWhere: Record<string, unknown> = {};
    if (search)             mainWhere["symbol_contains_nocase"] = search;
    if (bonding === "true") mainWhere["migration"]               = null;

    const aggWhere: Record<string, unknown> = {};
    if (platform === "FOURMEME" || platform === "FLAPSH") aggWhere["launchPlatform"] = platform;
    if (bonding === "true")  aggWhere["graduated"]             = false;
    if (bonding === "false") aggWhere["graduated"]             = true;
    if (search)              aggWhere["symbol_contains_nocase"] = search;

    // Fetch enough items to satisfy the requested page. Capped at 1000 per source.
    const fetchLimit = Math.min(Math.max(200, offset + limit), 1000);

    const [mainResult, aggResult] = await Promise.all([
      useMain ? mainFetch<{ tokens: MainToken[] }>(MAIN_TOKENS_QUERY, {
        first: fetchLimit, skip: 0,
        orderBy:        MAIN_ORDER_MAP[orderKey] ?? "createdAtBlock",
        orderDirection: orderDir,
        where: Object.keys(mainWhere).length ? mainWhere : undefined,
      }).catch(() => ({ tokens: [] as MainToken[] })) : Promise.resolve({ tokens: [] as MainToken[] }),

      useAgg ? dexFetch<{ tokens: AggToken[] }>(AGG_TOKENS_QUERY, {
        first: fetchLimit, skip: 0,
        orderBy:        TOKEN_ORDER_MAP[orderKey] ?? "createdAtTimestamp",
        orderDirection: orderDir,
        where: Object.keys(aggWhere).length ? aggWhere : undefined,
      }).catch(() => ({ tokens: [] as AggToken[] })) : Promise.resolve({ tokens: [] as AggToken[] }),
    ]);

    let mainTokens = mainResult.tokens.map(normalizeMainToken);
    if (bonding === "false") mainTokens = mainTokens.filter(t => !t.bondingPhase);

    const aggTokens = aggResult.tokens.map(normalizeAggToken);

    // Deduplicate by address — aggregator wins if present in both
    const seen = new Set(aggTokens.map(t => t.address));
    const merged = [
      ...aggTokens,
      ...mainTokens.filter(t => !seen.has(t.address)),
    ].sort((a, b) => b.createdAtTimestamp - a.createdAtTimestamp);

    const total = merged.length;
    const rows  = merged.slice(offset, offset + limit);
    return paginated(rows, total, page, limit);
  }

  // ── GET /dex/tokens/:address ─────────────────────────────────────────────────
  //
  // 1. Try AGGREGATOR (FOURMEME/FLAPSH tokens)
  // 2. Try MAIN (1MEME tokens)
  // 3. Try all DEX protocol subgraphs in parallel

  async getToken(address: string) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");
    const addr = normalizeAddress(address);

    const [aggResult, mainResult] = await Promise.allSettled([
      dexFetch<{ token: AggToken | null }>(AGG_TOKEN_QUERY, { id: addr }),
      mainFetch<{ token: MainToken | null }>(MAIN_TOKEN_QUERY, { id: addr }),
    ]);

    const aggToken  = aggResult.status  === "fulfilled" ? aggResult.value.token  : null;
    const mainToken = mainResult.status === "fulfilled" ? mainResult.value.token : null;

    if (aggToken)  return { data: normalizeAggToken(aggToken) };
    if (mainToken) return { data: normalizeMainToken(mainToken) };

    // Fall back to DEX protocol subgraphs
    const dexResults = await Promise.allSettled(
      Object.entries(DEX_PLATFORM_TO_ENDPOINT).map(async ([platform, ep]) => {
        const isV2 = ep === "PANCAKE_V2" || ep === "UNISWAP_V2";
        if (isV2) {
          const { token } = await dexFetchFrom<{ token: DexV2Token | null }>(ep, V2_TOKEN_QUERY, { id: addr });
          return token ? normalizeDexV2Token(token, platform) : null;
        } else {
          const { token } = await dexFetchFrom<{ token: DexV3Token | null }>(ep, V3_TOKEN_QUERY, { id: addr });
          return token ? normalizeDexV3Token(token, platform) : null;
        }
      }),
    );

    for (const r of dexResults) {
      if (r.status === "fulfilled" && r.value) return { data: r.value };
    }

    throw new NotFoundException(`Token ${address} not found`);
  }

  // ── GET /dex/tokens/:address/pools ───────────────────────────────────────────
  //
  // Routes to the appropriate DEX subgraph(s) based on ?dex= filter.
  // When no filter is set, queries all 6 DEX subgraphs in parallel.

  async getTokenPools(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");
    const addr = normalizeAddress(address).toLowerCase();
    const { page, limit, offset } = parsePagination(query);
    const dexFilter = query["dex"]?.toUpperCase();

    if (dexFilter && !DEX_PROTOCOL_ENDPOINTS.includes(dexFilter as DexEndpoint)) {
      throw new BadRequestException(
        `dex must be one of: ${DEX_PROTOCOL_ENDPOINTS.join(", ")}`,
      );
    }

    const endpoints: DexEndpoint[] = dexFilter
      ? [dexFilter as DexEndpoint]
      : DEX_PROTOCOL_ENDPOINTS;

    type NormPool = ReturnType<typeof normalizeV2Pool>;
    const results = await Promise.allSettled(
      endpoints.map(async (ep): Promise<NormPool[]> => {
        const isV2 = ep === "PANCAKE_V2" || ep === "UNISWAP_V2";
        const gql  = poolQueryForEndpoint(ep);

        if (isV2) {
          const data = await dexFetchFrom<{ t0: V2Pair[]; t1: V2Pair[] }>(ep, gql, {
            addr, first: 50,
          });
          return [...(data.t0 ?? []), ...(data.t1 ?? [])].map(p => normalizeV2Pool(p, ep));
        } else {
          const data = await dexFetchFrom<{ t0: V3Pool[]; t1: V3Pool[] }>(ep, gql, {
            addr, first: 50,
          });
          return [...(data.t0 ?? []), ...(data.t1 ?? [])].map(p => normalizeV3Pool(p, ep));
        }
      }),
    );

    const allPools = results
      .flatMap(r => r.status === "fulfilled" ? r.value : [])
      .sort((a, b) => parseFloat(b.volumeUSD) - parseFloat(a.volumeUSD));

    const total = allPools.length;
    const rows  = allPools.slice(offset, offset + limit);
    return paginated(rows, total, page, limit);
  }

  // ── GET /dex/tokens/:address/trades ──────────────────────────────────────────
  //
  // Bonding trades:
  //   ONEMEME tokens → MAIN subgraph (trades entity)
  //   FOURMEME/FLAPSH tokens → AGGREGATOR subgraph (bondingTrades entity)
  //   No source filter → queries both
  // DEX swaps → AGGREGATOR (Aggregator Swapped events)

  async getTokenTrades(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");
    const addr = normalizeAddress(address);
    const { page, limit, offset } = parsePagination(query);
    const source = query["source"];

    if (source && source !== "bonding" && source !== "dex") {
      throw new BadRequestException('source must be "bonding" or "dex"');
    }

    const fetchBonding = !source || source === "bonding";
    const fetchDex     = !source || source === "dex";

    const [mainTradesResult, aggBondingResult] = await Promise.all([
      fetchBonding
        ? mainFetch<{ trades: MainTrade[] }>(MAIN_TRADES_QUERY, {
            first: 200, skip: 0, where: { token: addr },
          }).catch(() => ({ trades: [] as MainTrade[] }))
        : Promise.resolve({ trades: [] as MainTrade[] }),

      fetchBonding
        ? dexFetch<{ bondingTrades: AggBondingTrade[] }>(AGG_BONDING_TRADES_QUERY, {
            first: 200, skip: 0, where: { token: addr },
          }).catch(() => ({ bondingTrades: [] as AggBondingTrade[] }))
        : Promise.resolve({ bondingTrades: [] as AggBondingTrade[] }),

      // intentionally unused slot — swaps queried separately below
      Promise.resolve(null),
    ]);

    // Query swaps as tokenIn and tokenOut separately — AND-ing both in one where
    // clause would require the token to be both sides of the swap simultaneously.
    const [swapsInResult, swapsOutResult] = fetchDex
      ? await Promise.all([
          dexFetch<{ swaps: AggSwap[] }>(AGG_SWAPS_QUERY, {
            first: 200, skip: 0, where: { tokenIn: addr },
          }).catch(() => ({ swaps: [] as AggSwap[] })),
          dexFetch<{ swaps: AggSwap[] }>(AGG_SWAPS_QUERY, {
            first: 200, skip: 0, where: { tokenOut: addr },
          }).catch(() => ({ swaps: [] as AggSwap[] })),
        ])
      : [{ swaps: [] as AggSwap[] }, { swaps: [] as AggSwap[] }];

    const mainTrades = mainTradesResult.trades.map(t => ({
      ...normalizeMainTrade(t), source: "bonding" as const,
    }));
    const aggBonding = aggBondingResult.bondingTrades.map(t => ({
      ...normalizeBondingTrade(t), source: "bonding" as const,
    }));

    // Merge tokenIn + tokenOut swap results, deduplicate by id
    const seenSwapId = new Set(swapsInResult.swaps.map(s => s.id));
    const aggSwaps = [
      ...swapsInResult.swaps,
      ...swapsOutResult.swaps.filter(s => !seenSwapId.has(s.id)),
    ].map(s => ({ ...normalizeSwap(s), source: "dex" as const }));

    // Merge bonding trades — deduplicate by txHash (aggregator may re-index 1MEME too)
    const seenTx = new Set(aggBonding.map(t => t.txHash));
    const allBonding = [...aggBonding, ...mainTrades.filter(t => !seenTx.has(t.txHash))];

    const merged = [...allBonding, ...aggSwaps]
      .sort((a, b) => b.timestamp - a.timestamp);

    const total = merged.length;
    const rows  = merged.slice(offset, offset + limit);
    return paginated(rows, total, page, limit);
  }

  // ── GET /dex/swaps ───────────────────────────────────────────────────────────
  // OneMEMEAggregator swap events — always from AGGREGATOR subgraph.

  async listSwaps(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const user     = query["user"];
    const adapter  = query["adapter"];
    const tokenIn  = query["tokenIn"];
    const tokenOut = query["tokenOut"];
    const from     = query["from"] ? parseInt(query["from"], 10) : null;
    const to       = query["to"]   ? parseInt(query["to"],   10) : null;

    if (user     && !isAddress(user))     throw new BadRequestException("Invalid user address");
    if (tokenIn  && !isAddress(tokenIn))  throw new BadRequestException("Invalid tokenIn address");
    if (tokenOut && !isAddress(tokenOut)) throw new BadRequestException("Invalid tokenOut address");
    if (from !== null && isNaN(from)) throw new BadRequestException("from must be a unix timestamp");
    if (to   !== null && isNaN(to))   throw new BadRequestException("to must be a unix timestamp");

    if (adapter && !(adapter.toUpperCase() in ADAPTER_IDS)) {
      throw new BadRequestException(`Invalid adapter. Allowed: ${ADAPTER_NAMES.join(", ")}`);
    }

    const where: Record<string, unknown> = {};
    if (user)          where["user"]          = normalizeAddress(user);
    if (tokenIn)       where["tokenIn"]       = normalizeAddress(tokenIn);
    if (tokenOut)      where["tokenOut"]      = normalizeAddress(tokenOut);
    if (adapter)       where["adapterName"]   = adapter.toUpperCase();
    if (from !== null) where["timestamp_gte"] = from.toString();
    if (to   !== null) where["timestamp_lte"] = to.toString();

    const whereArg = Object.keys(where).length ? where : undefined;

    const [{ swaps }, total] = await Promise.all([
      dexFetch<{ swaps: AggSwap[] }>(AGG_SWAPS_QUERY, {
        first: limit, skip: offset, where: whereArg,
      }),
      dexCount("AGGREGATOR", "swaps", AGG_SWAPS_COUNT_QUERY, { where: whereArg }),
    ]);

    return paginated(swaps.map(normalizeSwap), total, page, limit);
  }

  // ── GET /dex/stats ───────────────────────────────────────────────────────────
  // Always from AGGREGATOR subgraph.

  async stats() {
    const { globalState, protocol } = await dexFetch<{
      globalState: AggGlobalState | null;
      protocol:    AggProtocol    | null;
    }>(AGG_GLOBAL_QUERY);

    return {
      data: {
        bnbPriceUSD:    globalState?.bnbPriceUSD ?? null,
        lastUpdated:    globalState ? parseInt(globalState.lastUpdated) : null,
        totalSwaps:     protocol ? parseInt(protocol.totalSwaps) : 0,
        totalVolumeBNB: protocol?.totalVolumeBNB ?? "0",
        totalFeesBNB:   protocol?.totalFeesBNB   ?? "0",
        uniqueUsers:    protocol ? parseInt(protocol.uniqueUsers) : 0,
      },
    };
  }

  // ── GET /dex/adapters ────────────────────────────────────────────────────────

  adapters() {
    const entries = ADAPTER_NAMES.map(name => ({
      name,
      id:       ADAPTER_IDS[name],
      category: name === "ONEMEME_BC" || name === "FOURMEME" || name === "FLAPSH"
        ? "bonding-curve"
        : name.includes("V2") ? "amm-v2"
        : name.includes("V3") ? "amm-v3"
        : "amm-v4",
    }));

    return { data: entries };
  }
}
