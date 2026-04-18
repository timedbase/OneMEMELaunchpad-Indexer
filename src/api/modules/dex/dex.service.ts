import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { dexFetch, dexCount } from "./dex-subgraph";
import { ADAPTER_IDS, ADAPTER_NAMES } from "./dex-rpc";
import { isAddress, normalizeAddress, paginated, parsePagination, parseOrderBy, parseOrderDir } from "../../helpers";

// ─── Subgraph field shapes ────────────────────────────────────────────────────
// Field names mirror the OneMEMEAggregator subgraph schema.
// Adjust if your deployed schema uses different names.

interface SubgraphDexToken {
  id:                   string;
  name:                 string | null;
  symbol:               string | null;
  decimals:             string;
  // Platforms this token appears on (subset of: ONEMEME, FOURMEME, FLAPSH, DEX)
  platforms:            string[];
  // Live pricing from the aggregator subgraph
  currentPriceBNB:      string | null;
  currentPriceUSD:      string | null;
  currentMarketCapBNB:  string | null;
  currentMarketCapUSD:  string | null;
  currentLiquidityBNB:  string | null;
  // Aggregate counters
  totalVolumeBNB:       string;
  tradeCount:           string;
  // Bonding-curve phase (1MEME / FourMEME / FlapSH tokens)
  bondingPhase:         boolean;
  bondingCurve:         string | null;
  // Migration / DEX info
  pairAddress:          string | null;
  createdAtTimestamp:   string;
}

interface SubgraphPool {
  id:               string;
  dex:              string;   // PANCAKE_V2, UNISWAP_V3, etc.
  poolType:         string;   // V2, V3, V4
  token0:           { id: string; symbol: string | null };
  token1:           { id: string; symbol: string | null };
  feeTier:          string | null;
  liquidity:        string;
  volumeBNB:        string;
  createdAtTimestamp: string;
}

interface SubgraphBondingTrade {
  id:          string;
  token:       { id: string; name: string | null; symbol: string | null };
  trader:      string;
  type:        "BUY" | "SELL";
  bnbAmount:   string;
  tokenAmount: string;
  platform:    string;   // ONEMEME | FOURMEME | FLAPSH
  timestamp:   string;
  txHash:      string;
}

interface SubgraphSwap {
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

interface SubgraphGlobalState {
  id:          string;
  bnbPriceUSD: string;
  lastUpdated: string;
}

interface SubgraphProtocol {
  id:             string;
  totalSwaps:     string;
  totalVolumeBNB: string;
  totalFeesBNB:   string;
  uniqueUsers:    string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

const DEX_TOKENS_QUERY = /* GraphQL */ `
  query DexTokens($first: Int!, $skip: Int!, $orderBy: Token_orderBy!, $orderDirection: OrderDirection!, $where: Token_filter) {
    tokens(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection, where: $where) {
      id name symbol decimals platforms
      currentPriceBNB currentPriceUSD currentMarketCapBNB currentMarketCapUSD currentLiquidityBNB
      totalVolumeBNB tradeCount bondingPhase bondingCurve pairAddress createdAtTimestamp
    }
  }
`;

const DEX_TOKEN_QUERY = /* GraphQL */ `
  query DexToken($id: ID!) {
    token(id: $id) {
      id name symbol decimals platforms
      currentPriceBNB currentPriceUSD currentMarketCapBNB currentMarketCapUSD currentLiquidityBNB
      totalVolumeBNB tradeCount bondingPhase bondingCurve pairAddress createdAtTimestamp
    }
  }
`;

const DEX_POOLS_QUERY = /* GraphQL */ `
  query DexPools($first: Int!, $skip: Int!, $where: Pool_filter) {
    pools(first: $first, skip: $skip, where: $where, orderBy: volumeBNB, orderDirection: desc) {
      id dex poolType feeTier liquidity volumeBNB createdAtTimestamp
      token0 { id symbol }
      token1 { id symbol }
    }
  }
`;

const DEX_BONDING_TRADES_QUERY = /* GraphQL */ `
  query DexBondingTrades($first: Int!, $skip: Int!, $where: BondingTrade_filter) {
    bondingTrades(first: $first, skip: $skip, where: $where, orderBy: timestamp, orderDirection: desc) {
      id trader type bnbAmount tokenAmount platform timestamp txHash
      token { id name symbol }
    }
  }
`;

const DEX_SWAPS_QUERY = /* GraphQL */ `
  query DexSwaps($first: Int!, $skip: Int!, $where: Swap_filter) {
    swaps(first: $first, skip: $skip, where: $where, orderBy: timestamp, orderDirection: desc) {
      id user adapterId adapterName grossAmountIn feeCharged amountOut timestamp txHash
      tokenIn  { id symbol }
      tokenOut { id symbol }
    }
  }
`;

const DEX_GLOBAL_QUERY = /* GraphQL */ `
  query DexGlobal {
    globalState(id: "global") { id bnbPriceUSD lastUpdated }
    protocol(id: "aggregator")  { id totalSwaps totalVolumeBNB totalFeesBNB uniqueUsers }
  }
`;

const DEX_TOKENS_COUNT_QUERY = /* GraphQL */ `
  query DexTokensCount($first: Int!, $skip: Int!, $where: Token_filter) {
    tokens(first: $first, skip: $skip, where: $where) { id }
  }
`;

const DEX_SWAPS_COUNT_QUERY = /* GraphQL */ `
  query DexSwapsCount($first: Int!, $skip: Int!, $where: Swap_filter) {
    swaps(first: $first, skip: $skip, where: $where) { id }
  }
`;

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeToken(t: SubgraphDexToken) {
  return {
    address:             t.id,
    name:                t.name    ?? null,
    symbol:              t.symbol  ?? null,
    decimals:            parseInt(t.decimals),
    platforms:           t.platforms,
    bondingPhase:        t.bondingPhase,
    bondingCurve:        t.bondingCurve ?? null,
    pairAddress:         t.pairAddress  ?? null,
    currentPriceBNB:     t.currentPriceBNB    ?? null,
    currentPriceUSD:     t.currentPriceUSD    ?? null,
    currentMarketCapBNB: t.currentMarketCapBNB ?? null,
    currentMarketCapUSD: t.currentMarketCapUSD ?? null,
    currentLiquidityBNB: t.currentLiquidityBNB ?? null,
    totalVolumeBNB:      t.totalVolumeBNB,
    tradeCount:          parseInt(t.tradeCount),
    createdAtTimestamp:  parseInt(t.createdAtTimestamp),
  };
}

function normalizePool(p: SubgraphPool) {
  return {
    address:            p.id,
    dex:                p.dex,
    poolType:           p.poolType,
    feeTier:            p.feeTier ? parseInt(p.feeTier) : null,
    token0:             { address: p.token0.id, symbol: p.token0.symbol ?? null },
    token1:             { address: p.token1.id, symbol: p.token1.symbol ?? null },
    liquidity:          p.liquidity,
    volumeBNB:          p.volumeBNB,
    createdAtTimestamp: parseInt(p.createdAtTimestamp),
  };
}

function normalizeBondingTrade(t: SubgraphBondingTrade) {
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

function normalizeSwap(s: SubgraphSwap) {
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

// ─── Valid sort fields ────────────────────────────────────────────────────────

const TOKEN_ORDER_MAP: Record<string, string> = {
  createdAtTimestamp:  "createdAtTimestamp",
  totalVolumeBNB:      "totalVolumeBNB",
  tradeCount:          "tradeCount",
  currentMarketCapBNB: "currentMarketCapBNB",
  currentLiquidityBNB: "currentLiquidityBNB",
};

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class DexService {

  // ── GET /dex/tokens ──────────────────────────────────────────────────────────

  async listTokens(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const platform = query["platform"];
    const bonding  = query["bondingPhase"];
    const search   = query["search"];

    const ALLOWED_ORDER = Object.keys(TOKEN_ORDER_MAP) as (keyof typeof TOKEN_ORDER_MAP)[];
    const orderBy  = TOKEN_ORDER_MAP[parseOrderBy(query, ALLOWED_ORDER, "createdAtTimestamp")] ?? "createdAtTimestamp";
    const orderDir = parseOrderDir(query).toLowerCase() as "asc" | "desc";

    const where: Record<string, unknown> = {};
    if (platform)           where["platforms_contains"]      = [platform];
    if (bonding === "true") where["bondingPhase"]            = true;
    if (bonding === "false") where["bondingPhase"]           = false;
    if (search)             where["symbol_contains_nocase"]  = search;

    const whereArg = Object.keys(where).length ? where : undefined;

    const [{ tokens }, total] = await Promise.all([
      dexFetch<{ tokens: SubgraphDexToken[] }>(DEX_TOKENS_QUERY, {
        first: limit, skip: offset, orderBy, orderDirection: orderDir,
        where: whereArg,
      }),
      dexCount("tokens", DEX_TOKENS_COUNT_QUERY, { where: whereArg }),
    ]);

    return paginated(tokens.map(normalizeToken), total, page, limit);
  }

  // ── GET /dex/tokens/:address ─────────────────────────────────────────────────

  async getToken(address: string) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");
    const addr = normalizeAddress(address);

    const { token } = await dexFetch<{ token: SubgraphDexToken | null }>(DEX_TOKEN_QUERY, { id: addr });
    if (!token) throw new NotFoundException(`Token ${address} not found in aggregator subgraph`);

    return { data: normalizeToken(token) };
  }

  // ── GET /dex/tokens/:address/pools ───────────────────────────────────────────

  async getTokenPools(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");
    const addr = normalizeAddress(address);
    const { page, limit, offset } = parsePagination(query);
    const dexFilter = query["dex"];

    const where: Record<string, unknown> = {};
    if (dexFilter) where["dex"] = dexFilter.toUpperCase();

    // Fetch pools where this token is token0 or token1 then merge
    const [pools0, pools1] = await Promise.all([
      dexFetch<{ pools: SubgraphPool[] }>(DEX_POOLS_QUERY, {
        first: 100, skip: 0, where: { ...where, token0: addr },
      }),
      dexFetch<{ pools: SubgraphPool[] }>(DEX_POOLS_QUERY, {
        first: 100, skip: 0, where: { ...where, token1: addr },
      }),
    ]);

    const allPools = [...pools0.pools, ...pools1.pools]
      .sort((a, b) => parseFloat(b.volumeBNB) - parseFloat(a.volumeBNB));

    const total = allPools.length;
    const rows  = allPools.slice(offset, offset + limit).map(normalizePool);
    return paginated(rows, total, page, limit);
  }

  // ── GET /dex/tokens/:address/trades ──────────────────────────────────────────

  async getTokenTrades(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");
    const addr = normalizeAddress(address);
    const { page, limit, offset } = parsePagination(query);
    const source = query["source"]; // "bonding" | "dex" | undefined (all)

    if (source && source !== "bonding" && source !== "dex") {
      throw new BadRequestException('source must be "bonding" or "dex"');
    }

    const fetchBonding = !source || source === "bonding";
    const fetchDex     = !source || source === "dex";

    const [bondingData, swapData] = await Promise.all([
      fetchBonding
        ? dexFetch<{ bondingTrades: SubgraphBondingTrade[] }>(DEX_BONDING_TRADES_QUERY, {
            first: 200, skip: 0, where: { token: addr },
          })
        : Promise.resolve({ bondingTrades: [] as SubgraphBondingTrade[] }),
      fetchDex
        ? dexFetch<{ swaps: SubgraphSwap[] }>(DEX_SWAPS_QUERY, {
            first: 200, skip: 0,
            where: { tokenIn_in: [addr], tokenOut_in: [addr] },
          })
        : Promise.resolve({ swaps: [] as SubgraphSwap[] }),
    ]);

    const bonding = bondingData.bondingTrades.map(t => ({ ...normalizeBondingTrade(t), source: "bonding" as const }));
    const swaps   = swapData.swaps.map(s => ({ ...normalizeSwap(s), source: "dex" as const }));

    const merged = [...bonding, ...swaps].sort((a, b) => b.timestamp - a.timestamp);
    const total  = merged.length;
    const rows   = merged.slice(offset, offset + limit);

    return paginated(rows, total, page, limit);
  }

  // ── GET /dex/swaps ───────────────────────────────────────────────────────────

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
    if (user)     where["user"]          = normalizeAddress(user);
    if (tokenIn)  where["tokenIn"]       = normalizeAddress(tokenIn);
    if (tokenOut) where["tokenOut"]      = normalizeAddress(tokenOut);
    if (adapter)  where["adapterName"]   = adapter.toUpperCase();
    if (from !== null) where["timestamp_gte"] = from.toString();
    if (to   !== null) where["timestamp_lte"] = to.toString();

    const whereArg = Object.keys(where).length ? where : undefined;

    const [{ swaps }, total] = await Promise.all([
      dexFetch<{ swaps: SubgraphSwap[] }>(DEX_SWAPS_QUERY, {
        first: limit, skip: offset, where: whereArg,
      }),
      dexCount("swaps", DEX_SWAPS_COUNT_QUERY, { where: whereArg }),
    ]);

    return paginated(swaps.map(normalizeSwap), total, page, limit);
  }

  // ── GET /dex/stats ───────────────────────────────────────────────────────────

  async stats() {
    const { globalState, protocol } = await dexFetch<{
      globalState: SubgraphGlobalState | null;
      protocol:    SubgraphProtocol    | null;
    }>(DEX_GLOBAL_QUERY);

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
      category: name.endsWith("_BC") || name === "FOURMEME" || name === "FLAPSH"
        ? "bonding-curve"
        : name.includes("V2") ? "amm-v2"
        : name.includes("V3") ? "amm-v3"
        : "amm-v4",
    }));

    return { data: entries };
  }
}
