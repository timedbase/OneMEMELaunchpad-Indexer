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
  platforms:           string[];
  currentPriceBNB:     string | null;
  currentPriceUSD:     string | null;
  currentMarketCapBNB: string | null;
  currentMarketCapUSD: string | null;
  currentLiquidityBNB: string | null;
  totalVolumeBNB:      string;
  tradeCount:          string;
  bondingPhase:        boolean;
  bondingCurve:        string | null;
  pairAddress:         string | null;
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
      id name symbol decimals platforms
      currentPriceBNB currentPriceUSD currentMarketCapBNB currentMarketCapUSD currentLiquidityBNB
      totalVolumeBNB tradeCount bondingPhase bondingCurve pairAddress createdAtTimestamp
    }
  }
`;

const AGG_TOKEN_QUERY = /* GraphQL */ `
  query AggToken($id: ID!) {
    token(id: $id) {
      id name symbol decimals platforms
      currentPriceBNB currentPriceUSD currentMarketCapBNB currentMarketCapUSD currentLiquidityBNB
      totalVolumeBNB tradeCount bondingPhase bondingCurve pairAddress createdAtTimestamp
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
  return {
    address:             t.id,
    name:                t.name   ?? null,
    symbol:              t.symbol ?? null,
    decimals:            parseInt(t.decimals),
    platforms:           t.platforms,
    bondingPhase:        t.bondingPhase,
    bondingCurve:        t.bondingCurve ?? null,
    pairAddress:         t.pairAddress  ?? null,
    currentPriceBNB:     t.currentPriceBNB     ?? null,
    currentPriceUSD:     t.currentPriceUSD     ?? null,
    currentMarketCapBNB: t.currentMarketCapBNB ?? null,
    currentMarketCapUSD: t.currentMarketCapUSD ?? null,
    currentLiquidityBNB: t.currentLiquidityBNB ?? null,
    totalVolumeBNB:      t.totalVolumeBNB,
    tradeCount:          parseInt(t.tradeCount),
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
    platforms:           ["ONEMEME"],
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
    createdAtTimestamp:  parseInt(t.createdAtBlock),
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
    platform:    "ONEMEME",
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
  totalVolumeBNB:      "totalVolumeBNB",
  tradeCount:          "tradeCount",
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
  // Routing:
  //   platform=ONEMEME            → MAIN subgraph (launchpad token schema)
  //   platform=FOURMEME|FLAPSH    → AGGREGATOR subgraph
  //   no filter                   → both subgraphs, merged by createdAtTimestamp desc

  async listTokens(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const platform = query["platform"]?.toUpperCase();
    const bonding  = query["bondingPhase"];
    const search   = query["search"];

    const ALLOWED_ORDER = Object.keys(TOKEN_ORDER_MAP) as (keyof typeof TOKEN_ORDER_MAP)[];
    const orderKey  = parseOrderBy(query, ALLOWED_ORDER, "createdAtTimestamp");
    const orderDir  = parseOrderDir(query).toLowerCase() as "asc" | "desc";

    const useMain = !platform || platform === "ONEMEME";
    const useAgg  = !platform || platform === "FOURMEME" || platform === "FLAPSH";

    const mainWhere:  Record<string, unknown> = {};
    if (search)             mainWhere["symbol_contains_nocase"] = search;
    if (bonding === "true") mainWhere["migration"] = null;
    // MAIN subgraph has no bondingPhase=false filter (need migration != null)
    // handled by post-filter below

    const aggWhere: Record<string, unknown> = {};
    if (platform)           aggWhere["platforms_contains"]     = [platform];
    if (bonding === "true") aggWhere["bondingPhase"]            = true;
    if (bonding === "false") aggWhere["bondingPhase"]           = false;
    if (search)             aggWhere["symbol_contains_nocase"]  = search;

    const [mainResult, aggResult] = await Promise.all([
      useMain ? mainFetch<{ tokens: MainToken[] }>(MAIN_TOKENS_QUERY, {
        first: 200, skip: 0,
        orderBy: MAIN_ORDER_MAP[orderKey] ?? "createdAtBlock",
        orderDirection: orderDir,
        where: Object.keys(mainWhere).length ? mainWhere : undefined,
      }).catch(() => ({ tokens: [] as MainToken[] })) : Promise.resolve({ tokens: [] as MainToken[] }),

      useAgg ? dexFetch<{ tokens: AggToken[] }>(AGG_TOKENS_QUERY, {
        first: 200, skip: 0,
        orderBy: TOKEN_ORDER_MAP[orderKey] ?? "createdAtTimestamp",
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
  // Tries AGGREGATOR first (covers FOURMEME/FLAPSH). Falls back to MAIN (1MEME).

  async getToken(address: string) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");
    const addr = normalizeAddress(address);

    const [aggResult, mainResult] = await Promise.allSettled([
      dexFetch<{ token: AggToken | null }>(AGG_TOKEN_QUERY, { id: addr }),
      mainFetch<{ token: MainToken | null }>(MAIN_TOKEN_QUERY, { id: addr }),
    ]);

    const aggToken  = aggResult.status  === "fulfilled" ? aggResult.value.token   : null;
    const mainToken = mainResult.status === "fulfilled" ? mainResult.value.token  : null;

    if (aggToken)  return { data: normalizeAggToken(aggToken) };
    if (mainToken) return { data: normalizeMainToken(mainToken) };

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

    const [mainTradesResult, aggBondingResult, aggSwapsResult] = await Promise.all([
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

      fetchDex
        ? dexFetch<{ swaps: AggSwap[] }>(AGG_SWAPS_QUERY, {
            first: 200, skip: 0,
            where: { tokenIn_in: [addr], tokenOut_in: [addr] },
          }).catch(() => ({ swaps: [] as AggSwap[] }))
        : Promise.resolve({ swaps: [] as AggSwap[] }),
    ]);

    const mainTrades = mainTradesResult.trades.map(t => ({
      ...normalizeMainTrade(t), source: "bonding" as const,
    }));
    const aggBonding = aggBondingResult.bondingTrades.map(t => ({
      ...normalizeBondingTrade(t), source: "bonding" as const,
    }));
    const aggSwaps   = aggSwapsResult.swaps.map(s => ({
      ...normalizeSwap(s), source: "dex" as const,
    }));

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
