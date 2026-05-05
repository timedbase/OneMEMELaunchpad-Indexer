/**
 * DEX Route Service — aggregation layer for optimal price routing.
 *
 * Responsible for:
 *   • Route finding — discovers all liquidity sources in parallel and
 *     returns the best price; bridge routes are built automatically
 *     when bonding-curve adapters need WBNB as an intermediate token
 *   • Calldata building for direct (non-gasless) swap and batch-swap transactions
 *
 * Adapter selection is 100% internal — no public endpoint accepts an adapter name.
 * This service has no knowledge of meta-transactions, relayers, or EIP-712.
 * Those concerns belong to MetaTxService which sits above this layer.
 */

import { Injectable, BadRequestException, ServiceUnavailableException, Logger } from "@nestjs/common";
import { dexFetchFrom } from "./dex-subgraph";
import {
  ADAPTER_IDS,
  AdapterName,
  SwapStep,
  encodeV2AdapterData,
  encodeV3SingleHopAdapterData,
  encodeV4SingleHopAdapterData,
  encodeOneMemeAdapterData,
  encodeFourMemeAdapterData,
  encodeFlapShAdapterData,
  buildSwapCalldata,
  buildBatchSwapCalldata,
  buildV3PackedPath,
  quoteV2,
  quoteV3,
  quoteV4,
  quoteBcBuy,
  quoteBcSell,
  quoteFourMemeBuy,
  quoteFourMemeSell,
  quoteFlapShBuy,
  quoteFlapShSell,
  defaultTickSpacing,
  aggregatorAddress,
  batchAggregatorAddress,
} from "./dex-rpc";
import type { Hex } from "viem";
import { isAddress, normalizeAddress } from "../../helpers";

// ─── Constants ────────────────────────────────────────────────────────────────

const WBNB_BSC   = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const NATIVE_BNB = "0x0000000000000000000000000000000000000000";
const ZERO_ADDR  = "0x0000000000000000000000000000000000000000" as Hex;

// Bonding-curve adapters — require WBNB as one side; no fee tier needed.
const BC_ADAPTERS: AdapterName[] = ["ONEMEME_BC", "FOURMEME", "FLAPSH"];

// Protocol fee charged by OneMEMEAggregator on every swap (0.5% = 200 divisor).
const AGGREGATOR_FEE_DIVISOR = 200n;

// Well-known intermediate tokens used for two-hop routing when no direct pair exists.
// For each hub, the router tries tokenIn→hub→tokenOut across all discovered pools.
const HUB_TOKENS: Hex[] = [
  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
  "0x55d398326f99059ff775485246999027b3197955", // USDT (BSC)
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC (BSC)
  "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", // BTCB
];

// Pool pair discovery query — works for V3 and V4 subgraphs.
// V4 subgraphs expose tickSpacing explicitly; V3 subgraphs do not (derived from fee).
const PAIR_POOLS_QUERY = /* GraphQL */ `
  query PairPools($addr0: String!, $addr1: String!, $first: Int!) {
    ab: pools(
      first: $first
      where: { token0: $addr0, token1: $addr1 }
      orderBy: liquidity
      orderDirection: desc
    ) { feeTier tickSpacing liquidity }
    ba: pools(
      first: $first
      where: { token0: $addr1, token1: $addr0 }
      orderBy: liquidity
      orderDirection: desc
    ) { feeTier tickSpacing liquidity }
  }
`;

interface DiscoveredPool {
  feeTier:     number;
  tickSpacing: number; // derived from fee when not present in subgraph
}

// ─── Shared helpers (exported for MetaTxService) ──────────────────────────────

export function isNative(addr: string): boolean {
  return addr.toLowerCase() === NATIVE_BNB;
}

export function toWbnbIfNative(addr: Hex): Hex {
  return isNative(addr) ? (WBNB_BSC as Hex) : addr;
}

export function requireAddress(val: unknown, name: string): Hex {
  if (typeof val !== "string" || !isAddress(val)) {
    throw new BadRequestException(`${name} must be a valid EVM address`);
  }
  return normalizeAddress(val) as Hex;
}

export function requireBigInt(val: unknown, name: string): bigint {
  // Only accept strings — JavaScript numbers cannot represent uint256 values
  // larger than Number.MAX_SAFE_INTEGER (≈9e15) without silent precision loss.
  if (typeof val !== "string") {
    throw new BadRequestException(`${name} must be a numeric string (wei), e.g. "1000000000000000000"`);
  }
  try {
    const n = BigInt(val);
    if (n < 0n) throw new Error();
    return n;
  } catch {
    throw new BadRequestException(`${name} must be a non-negative integer string (wei)`);
  }
}

export function parseSteps(raw: unknown, prefix: string): SwapStep[] {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new BadRequestException(`${prefix} must be an array of at least 2 swap steps`);
  }
  return raw.map((s, idx) => {
    if (!s || typeof s !== "object") {
      throw new BadRequestException(`${prefix}[${idx}] must be an object`);
    }
    const step = s as Record<string, unknown>;
    const adapterId = (() => {
      const v = step["adapterId"];
      if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
        throw new BadRequestException(`${prefix}[${idx}].adapterId must be a 32-byte hex string`);
      }
      return v as Hex;
    })();
    const adapterData = (() => {
      const v = step["adapterData"] ?? "0x";
      if (typeof v !== "string" || !/^0x[0-9a-fA-F]*$/.test(v)) {
        throw new BadRequestException(`${prefix}[${idx}].adapterData must be a hex string`);
      }
      return v as Hex;
    })();
    return {
      adapterId,
      tokenIn:     requireAddress(step["tokenIn"],  `${prefix}[${idx}].tokenIn`),
      tokenOut:    requireAddress(step["tokenOut"], `${prefix}[${idx}].tokenOut`),
      minOut:      requireBigInt(step["minOut"],    `${prefix}[${idx}].minOut`),
      adapterData,
    };
  });
}

export function validatePathContinuity(steps: SwapStep[]): void {
  for (let i = 0; i < steps.length - 1; i++) {
    if (steps[i]!.tokenOut.toLowerCase() !== steps[i + 1]!.tokenIn.toLowerCase()) {
      throw new BadRequestException(
        `steps[${i}].tokenOut (${steps[i]!.tokenOut}) must equal steps[${i + 1}].tokenIn (${steps[i + 1]!.tokenIn})`,
      );
    }
  }
}

// ─── Internal route candidate type ───────────────────────────────────────────

interface StepData {
  adapter:     AdapterName;
  adapterId:   Hex;
  tokenIn:     Hex;
  tokenOut:    Hex;
  amountIn:    string;
  amountOut:   string;
  minOut:      string;
  adapterData: Hex;
  fees:        number[] | null;
  tickSpacing: number[] | null;
  hooks:       string[] | null;
}

interface RouteCandidate {
  steps:          StepData[];
  finalAmountOut: bigint;
  minFinalOut:    bigint;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class RouteService {
  private readonly logger = new Logger(RouteService.name);

  // ── Quote ──────────────────────────────────────────────────────────────────

  /**
   * GET /dex/quote
   *
   * Aggregates all liquidity sources for the pair and returns the best on-chain
   * quote. V3/V4 pools are discovered from their subgraphs first. `sources[]`
   * lists every source that returned a valid price, sorted best-first.
   */
  async getQuote(query: Record<string, string | undefined>) {
    const rawTokenIn  = requireAddress(query["tokenIn"],  "tokenIn");
    const rawTokenOut = requireAddress(query["tokenOut"], "tokenOut");
    const amountIn    = requireBigInt(query["amountIn"],  "amountIn");

    if (amountIn === 0n) throw new BadRequestException("amountIn must be greater than 0");
    if (isNative(rawTokenIn) && isNative(rawTokenOut)) {
      throw new BadRequestException("tokenIn and tokenOut cannot both be native BNB");
    }

    const nativeIn  = isNative(rawTokenIn);
    const nativeOut = isNative(rawTokenOut);
    const tokenIn   = toWbnbIfNative(rawTokenIn);
    const tokenOut  = toWbnbIfNative(rawTokenOut);

    let slippageBps: bigint;
    try { slippageBps = BigInt(query["slippage"] ?? "100"); }
    catch { throw new BadRequestException("slippage must be a numeric basis-point value (e.g. 100 for 1%)"); }
    if (slippageBps < 0n || slippageBps > 5000n) {
      throw new BadRequestException("slippage must be between 0 and 5000 basis points");
    }

    const aggregatorFee = amountIn / AGGREGATOR_FEE_DIVISOR;
    const nowSec        = BigInt(Math.floor(Date.now() / 1000));
    const deadline      = nowSec + 1800n;
    const result        = await this.aggregateRoute(
      tokenIn, tokenOut, amountIn, slippageBps, deadline, nativeIn, nativeOut, aggregatorFee,
    );

    const steps     = result.data.steps;
    const firstStep = steps[0]!;
    const lastStep  = steps[steps.length - 1]!;
    const isMulti   = steps.length > 1;
    const path      = isMulti
      ? [...steps.map(s => s.tokenIn as string), lastStep.tokenOut as string]
      : [tokenIn as string, tokenOut as string];

    return {
      data: {
        adapter:       isMulti ? steps.map(s => s.adapter).join("→") : firstStep.adapter,
        tokenIn:       nativeIn  ? NATIVE_BNB : tokenIn,
        tokenOut:      nativeOut ? NATIVE_BNB : tokenOut,
        nativeIn,
        nativeOut,
        value:         nativeIn ? amountIn.toString() : "0",
        amountIn:      amountIn.toString(),
        amountOut:     lastStep.amountOut,
        minOut:        lastStep.minOut,
        aggregatorFee: aggregatorFee.toString(),
        bondingFee:    null,
        slippageBps:   slippageBps.toString(),
        quotedBy:      "aggregation",
        path,
        fees:          firstStep.fees,
        tickSpacing:   firstStep.tickSpacing,
        hooks:         firstStep.hooks,
        sources:       result.data.sources,
      },
    };
  }

  // ── Route ──────────────────────────────────────────────────────────────────

  /**
   * GET /dex/route
   *
   * Aggregates all relevant liquidity sources — V2, V3 (discovered pools),
   * V4 (discovered pools), and bonding-curve adapters when applicable — in
   * parallel and returns the route with the best output. When neither tokenIn
   * nor tokenOut is WBNB and a bonding-curve adapter wins, a two-step bridge
   * route (tokenIn→WBNB→tokenOut) is returned automatically.
   *
   * The `sources[]` field shows every source that was tried with its quoted
   * output, sorted best-first.
   */
  async getRoute(query: Record<string, string | undefined>) {
    const rawTokenIn  = requireAddress(query["tokenIn"],  "tokenIn");
    const rawTokenOut = requireAddress(query["tokenOut"], "tokenOut");
    const amountIn    = requireBigInt(query["amountIn"],  "amountIn");

    if (amountIn === 0n) throw new BadRequestException("amountIn must be greater than 0");
    if (isNative(rawTokenIn) && isNative(rawTokenOut)) {
      throw new BadRequestException("tokenIn and tokenOut cannot both be native BNB");
    }

    const nativeIn  = isNative(rawTokenIn);
    const nativeOut = isNative(rawTokenOut);
    const tokenIn   = toWbnbIfNative(rawTokenIn);
    const tokenOut  = toWbnbIfNative(rawTokenOut);

    let slippageBps: bigint;
    try { slippageBps = BigInt(query["slippage"] ?? "100"); }
    catch { throw new BadRequestException("slippage must be a numeric basis-point value (e.g. 100 for 1%)"); }
    if (slippageBps < 0n || slippageBps > 5000n) {
      throw new BadRequestException("slippage must be between 0 and 5000 basis points");
    }

    const nowSec        = BigInt(Math.floor(Date.now() / 1000));
    const deadline      = nowSec + 1800n;
    const aggregatorFee = amountIn / AGGREGATOR_FEE_DIVISOR;

    return this.aggregateRoute(
      tokenIn, tokenOut, amountIn, slippageBps, deadline,
      nativeIn, nativeOut, aggregatorFee,
    );
  }

  // ── Swap calldata builders ─────────────────────────────────────────────────

  /**
   * POST /dex/swap
   * Builds calldata for a direct OneMEMEAggregator.swap() call (single step) or
   * OneMEMEAggregator.batchSwap() call (multi-step bridge route).
   * The caller broadcasts the transaction — no relayer involved.
   *
   * Aggregates all sources, picks the best, computes minOut from slippage.
   * When the best route is a two-step bridge (tokenIn→WBNB→tokenOut),
   * batchSwap calldata is returned automatically.
   */
  async buildSwap(body: Record<string, unknown>) {
    const rawTokenIn  = requireAddress(body["tokenIn"],  "tokenIn");
    const rawTokenOut = requireAddress(body["tokenOut"], "tokenOut");
    const amountIn    = requireBigInt(body["amountIn"],  "amountIn");
    const to          = requireAddress(body["to"],       "to");
    const deadline    = requireBigInt(body["deadline"],  "deadline");

    if (amountIn === 0n) throw new BadRequestException("amountIn must be greater than 0");
    if (isNative(rawTokenIn) && isNative(rawTokenOut)) {
      throw new BadRequestException("tokenIn and tokenOut cannot both be native BNB");
    }
    if (deadline <= BigInt(Math.floor(Date.now() / 1000))) {
      throw new BadRequestException("deadline has already passed");
    }

    const nativeIn    = isNative(rawTokenIn);
    const nativeOut   = isNative(rawTokenOut);
    const tokenIn     = toWbnbIfNative(rawTokenIn);
    const tokenOut    = toWbnbIfNative(rawTokenOut);
    const feeEstimate = amountIn / AGGREGATOR_FEE_DIVISOR;

    let slippageBps: bigint;
    try { slippageBps = BigInt(String(body["slippage"] ?? "100")); }
    catch { throw new BadRequestException("slippage must be a numeric basis-point value (e.g. 100 for 1%)"); }
    if (slippageBps < 0n || slippageBps > 5000n) {
      throw new BadRequestException("slippage must be between 0 and 5000 basis points");
    }

    const route   = await this.aggregateRoute(
      tokenIn, tokenOut, amountIn, slippageBps, deadline, nativeIn, nativeOut, feeEstimate,
    );
    const steps   = route.data.steps;
    const minOut  = BigInt(route.data.minFinalOut);
    const isMulti = steps.length > 1;

    // The aggregator contract identifies native BNB by tokenIn/tokenOut == address(0).
    // Internal routing uses WBNB for quoting; the calldata must restore address(0)
    // so the contract uses msg.value rather than calling WBNB.transferFrom.
    const ctTokenIn  = nativeIn  ? (NATIVE_BNB as Hex) : tokenIn;
    const ctTokenOut = nativeOut ? (NATIVE_BNB as Hex) : tokenOut;

    // When all steps use the same V2 adapter, collapse to a single swap() call with a
    // multi-hop path array. The V2 router handles the hops internally — no batchSwap
    // contract required. Cross-adapter routes (e.g. V3 + BC) use batchSwap.
    const v2Adapter = steps[0]!.adapter;
    const collapseToV2 = isMulti &&
      (v2Adapter === "PANCAKE_V2" || v2Adapter === "UNISWAP_V2") &&
      steps.every(s => s.adapter === v2Adapter);

    let calldata: Hex;
    let useAggregator: boolean;

    if (!isMulti || collapseToV2) {
      useAggregator = true;
      if (!isMulti) {
        const step = steps[0]!;
        calldata = buildSwapCalldata(step.adapterId, ctTokenIn, amountIn, ctTokenOut, minOut, to, deadline, step.adapterData);
      } else {
        // Full V2 path: [tokenIn, intermediate..., tokenOut] using WBNB addresses.
        const fullPath: Hex[] = [tokenIn, ...steps.slice(1).map(s => s.tokenIn as Hex), tokenOut];
        const adapterData = encodeV2AdapterData(fullPath, deadline);
        calldata = buildSwapCalldata(steps[0]!.adapterId, ctTokenIn, amountIn, ctTokenOut, minOut, to, deadline, adapterData);
      }
    } else {
      useAggregator = false;
      const lastIdx   = steps.length - 1;
      const swapSteps: SwapStep[] = steps.map((s, i) => ({
        adapterId:   s.adapterId,
        tokenIn:     i === 0       && nativeIn  ? (NATIVE_BNB as Hex) : s.tokenIn,
        tokenOut:    i === lastIdx && nativeOut ? (NATIVE_BNB as Hex) : s.tokenOut,
        minOut:      BigInt(s.minOut),
        adapterData: s.adapterData,
      }));
      calldata = buildBatchSwapCalldata(swapSteps, amountIn, minOut, to, deadline);
    }

    // Conservative per-step gas budget covering ERC20 transfers + V2/V3 swap overhead.
    const gasLimit = (!isMulti || collapseToV2)
      ? "250000"
      : (100_000n + BigInt(steps.length) * 150_000n).toString();

    return {
      data: {
        to:          useAggregator ? aggregatorAddress() : batchAggregatorAddress(),
        calldata,
        value:       nativeIn ? amountIn.toString() : "0",
        gasLimit,
        nativeIn,
        nativeOut,
        singleStep:  !isMulti || collapseToV2,
        tokenIn:     nativeIn  ? NATIVE_BNB : tokenIn,
        tokenOut:    nativeOut ? NATIVE_BNB : tokenOut,
        amountIn:    amountIn.toString(),
        feeEstimate: feeEstimate.toString(),
        netAmountIn: (amountIn - feeEstimate).toString(),
        minOut:      route.data.minFinalOut,
        slippageBps: slippageBps.toString(),
        deadline:    deadline.toString(),
        steps:       steps,
        sources:     route.data.sources,
      },
    };
  }

  /**
   * POST /dex/batch-swap
   * Builds calldata for OneMEMEAggregator.batchSwap().
   * Chains multiple adapter hops atomically in one transaction.
   */
  async buildBatchSwap(body: Record<string, unknown>) {
    const steps       = parseSteps(body["steps"], "steps");
    const amountIn    = requireBigInt(body["amountIn"],    "amountIn");
    const minFinalOut = requireBigInt(body["minFinalOut"], "minFinalOut");
    const to          = requireAddress(body["to"],         "to");
    const deadline    = requireBigInt(body["deadline"],    "deadline");

    if (amountIn === 0n) throw new BadRequestException("amountIn must be greater than 0");
    if (deadline <= BigInt(Math.floor(Date.now() / 1000))) {
      throw new BadRequestException("deadline has already passed");
    }

    const nativeIn  = isNative(steps[0]!.tokenIn);
    const nativeOut = isNative(steps[steps.length - 1]!.tokenOut);
    if (nativeIn)  steps[0]!.tokenIn                 = WBNB_BSC as Hex;
    if (nativeOut) steps[steps.length - 1]!.tokenOut = WBNB_BSC as Hex;

    validatePathContinuity(steps);

    const feeEstimate = amountIn / AGGREGATOR_FEE_DIVISOR;
    const calldata    = buildBatchSwapCalldata(steps, amountIn, minFinalOut, to, deadline);
    const gasLimit    = (100_000n + BigInt(steps.length) * 150_000n).toString();

    return {
      data: {
        to:          batchAggregatorAddress(),
        calldata,
        nativeIn,
        nativeOut,
        value:       nativeIn ? amountIn.toString() : "0",
        gasLimit,
        steps:       steps.map(s => ({ ...s, minOut: s.minOut.toString() })),
        amountIn:    amountIn.toString(),
        feeEstimate: feeEstimate.toString(),
        minFinalOut: minFinalOut.toString(),
        deadline:    deadline.toString(),
      },
    };
  }

  // ── Private: aggregated routing ────────────────────────────────────────────

  /**
   * Discovers real pools for a token pair from a V3 or V4 DEX subgraph.
   * Returns fee tier + tick spacing for each pool that has liquidity.
   * V3 subgraphs don't expose tickSpacing — it is derived from fee tier.
   * V4 subgraphs expose it explicitly; falls back to derivation if absent.
   */
  private async discoverPools(
    adapter: "PANCAKE_V3" | "PANCAKE_V4" | "UNISWAP_V3" | "UNISWAP_V4",
    tokenIn: Hex,
    tokenOut: Hex,
  ): Promise<DiscoveredPool[]> {
    try {
      const addr0 = tokenIn.toLowerCase();
      const addr1 = tokenOut.toLowerCase();
      const data  = await dexFetchFrom<{
        ab: { feeTier: string; tickSpacing?: string | null; liquidity: string }[];
        ba: { feeTier: string; tickSpacing?: string | null; liquidity: string }[];
      }>(adapter, PAIR_POOLS_QUERY, { addr0, addr1, first: 5 });

      const seen   = new Set<number>();
      const pools: DiscoveredPool[] = [];

      for (const p of [...(data.ab ?? []), ...(data.ba ?? [])]) {
        const fee = parseInt(p.feeTier);
        if (isNaN(fee) || seen.has(fee)) continue;
        if (BigInt(p.liquidity ?? "0") === 0n) continue;
        seen.add(fee);
        pools.push({
          feeTier:     fee,
          tickSpacing: p.tickSpacing ? parseInt(p.tickSpacing) : defaultTickSpacing(fee),
        });
      }

      return pools;
    } catch (err) {
      this.logger.debug(`Pool discovery failed for ${adapter} (${tokenIn}/${tokenOut}): ${String(err)}`);
      return [];
    }
  }

  /**
   * Discovers all AMM candidates for a pair across V2/V3/V4 on both PancakeSwap
   * and Uniswap. Always includes V2 (quote fails gracefully if no pool).
   * V3/V4 candidates are real pools with liquidity from their subgraphs.
   * Does NOT include BC adapters — the caller adds those as needed.
   */
  private async discoverCandidates(
    tokenIn:  Hex,
    tokenOut: Hex,
  ): Promise<{ adapter: AdapterName; fees: number[]; tickSpacings: number[] }[]> {
    // V4 (PANCAKE_V4, UNISWAP_V4) disabled — re-enable when contracts are stable
    const [pancakeV3, uniswapV3] = await Promise.all([
      this.discoverPools("PANCAKE_V3", tokenIn, tokenOut),
      this.discoverPools("UNISWAP_V3", tokenIn, tokenOut),
    ]);
    return [
      { adapter: "PANCAKE_V2" as AdapterName, fees: [], tickSpacings: [] },
      { adapter: "UNISWAP_V2" as AdapterName, fees: [], tickSpacings: [] },
      ...pancakeV3.map(p => ({ adapter: "PANCAKE_V3" as AdapterName, fees: [p.feeTier], tickSpacings: [] })),
      ...uniswapV3.map(p => ({ adapter: "UNISWAP_V3" as AdapterName, fees: [p.feeTier], tickSpacings: [] })),
    ];
  }

  /**
   * Quotes all relevant liquidity sources in parallel and returns the route
   * with the highest final output amount.
   *
   * V2 and bonding-curve adapters are always tried (no pool discovery needed).
   * V3/V4 pools are discovered from their subgraphs first — only pools that
   * actually exist with liquidity are quoted, using their real fee tiers and
   * (for V4) tick spacings. No hardcoded fee tier probing.
   * BC adapters are included when one side is WBNB (direct) or when neither
   * side is WBNB (bridge route: tokenIn→WBNB via V3/V2, then WBNB→tokenOut
   * via BC adapter). Hub-token two-hop routes are tried for all HUB_TOKENS
   * that differ from both tokenIn and tokenOut.
   */
  private async aggregateRoute(
    tokenIn:       Hex,
    tokenOut:      Hex,
    amountIn:      bigint,
    slippageBps:   bigint,
    deadline:      bigint,
    nativeIn:      boolean,
    nativeOut:     boolean,
    aggregatorFee: bigint,
  ) {
    const isWbnbIn  = tokenIn.toLowerCase()  === WBNB_BSC;
    const isWbnbOut = tokenOut.toLowerCase() === WBNB_BSC;

    // The aggregator deducts its fee from the gross input before calling the adapter.
    // Quote with netAmountIn so that amountOut/minOut reflect the adapter's actual input,
    // preserving the full slippage tolerance for real price movement rather than burning
    // half of it on the known fee deduction.
    const netAmountIn = amountIn - aggregatorFee;

    // Discover single-step AMM candidates for the direct tokenIn/tokenOut pair
    const candidates = await this.discoverCandidates(tokenIn, tokenOut);

    // Add BC adapters for direct pairs when one side is WBNB
    if (isWbnbIn || isWbnbOut) {
      for (const a of BC_ADAPTERS) candidates.push({ adapter: a, fees: [], tickSpacings: [] });
    }

    const singleStepTasks = candidates.map(c =>
      this.trySingleStepRoute(c.adapter, c.fees, c.tickSpacings, tokenIn, tokenOut, amountIn, slippageBps, deadline, netAmountIn),
    );

    // When neither side is WBNB, build bridge routes: tokenIn→WBNB (best AMM) then WBNB→tokenOut (BC adapter).
    // Step 1 is computed once across all BC adapters to avoid redundant pool discovery.
    // bestSingleHop quotes step1 with netAmountIn so step2 sees the accurate WBNB amount.
    const bridgeTasks: Promise<RouteCandidate>[] = [];
    if (!isWbnbIn && !isWbnbOut) {
      const step1 = await this.bestSingleHop(tokenIn, WBNB_BSC as Hex, amountIn, netAmountIn, slippageBps, deadline);
      if (step1) {
        for (const bcAdapter of BC_ADAPTERS) {
          bridgeTasks.push(this.tryBcStep2(bcAdapter, step1, tokenOut, slippageBps, deadline));
        }
      }
    }

    // Two-hop routes through each hub token (tokenIn → hub → tokenOut).
    // Hop1 quotes with netAmountIn; hop2 uses hop1's output (already net-accurate).
    const hubTasks = HUB_TOKENS
      .filter(h => h.toLowerCase() !== tokenIn.toLowerCase() && h.toLowerCase() !== tokenOut.toLowerCase())
      .map(hub => this.tryTwoHopRoute(hub, tokenIn, tokenOut, amountIn, netAmountIn, slippageBps, deadline));

    const results = await Promise.allSettled([...singleStepTasks, ...bridgeTasks, ...hubTasks]);

    const successful = results
      .filter((r): r is PromiseFulfilledResult<RouteCandidate> => r.status === "fulfilled")
      .map(r => r.value)
      .sort((a, b) => (b.finalAmountOut > a.finalAmountOut ? 1 : -1));

    if (successful.length === 0) {
      throw new ServiceUnavailableException(
        "No route found — no liquidity source returned a valid quote for this pair",
      );
    }

    // Prefer single-step routes: a multi-hop route only wins when it beats the
    // best direct route by > 50 bps. This prevents a momentary V2 pool imbalance
    // from choosing a two-hop path whose on-chain price then fails slippage checks.
    const singleSteps = successful.filter(r => r.steps.length === 1);
    const bestSingle  = singleSteps[0];
    const bestMulti   = successful.filter(r => r.steps.length > 1)[0];
    const MULTI_HOP_EDGE = 50n; // basis points a multi-hop must exceed single-step by

    const best = (() => {
      if (!bestSingle) return successful[0]!;
      if (!bestMulti)  return bestSingle;
      const edge = (bestSingle.finalAmountOut * MULTI_HOP_EDGE) / 10_000n;
      return bestMulti.finalAmountOut > bestSingle.finalAmountOut + edge ? bestMulti : bestSingle;
    })();

    return {
      data: {
        singleStep:    best.steps.length === 1,
        nativeIn,
        nativeOut,
        value:         nativeIn ? amountIn.toString() : "0",
        steps:         best.steps,
        amountIn:      amountIn.toString(),
        minFinalOut:   best.minFinalOut.toString(),
        aggregatorFee: aggregatorFee.toString(),
        slippageBps:   slippageBps.toString(),
        sources: successful.map(r => ({
          adapter:   r.steps.length > 1
            ? r.steps.map(s => s.adapter).join("→")
            : r.steps[0]!.adapter,
          fees:      r.steps[0]!.fees,
          amountOut: r.steps[r.steps.length - 1]!.amountOut,
        })),
      },
    };
  }

  /**
   * Attempts a single-step quote + adapterData encoding for one candidate.
   * Throws if the source has no liquidity — caller uses Promise.allSettled.
   *
   * `quoteAmountIn` is the amount used for price simulation (defaults to `amountIn`).
   * Pass `netAmountIn = amountIn - aggregatorFee` here so that `amountOut` and
   * `minOut` reflect what the adapter will actually receive on-chain, not the
   * gross input. `amountIn` in the returned StepData always stays as the full
   * gross amount (what the contract records in the Swapped event).
   */
  private async trySingleStepRoute(
    adapter:        AdapterName,
    fees:           number[],
    tickSpacings:   number[],
    tokenIn:        Hex,
    tokenOut:       Hex,
    amountIn:       bigint,
    slippageBps:    bigint,
    deadline:       bigint,
    quoteAmountIn:  bigint = amountIn,
  ): Promise<RouteCandidate> {
    let amountOut: bigint;
    let adapterData: Hex;

    if (adapter === "PANCAKE_V2" || adapter === "UNISWAP_V2") {
      amountOut   = await quoteV2(adapter, [tokenIn, tokenOut], quoteAmountIn);
      adapterData = encodeV2AdapterData([tokenIn, tokenOut], deadline);

    } else if (adapter === "PANCAKE_V3" || adapter === "UNISWAP_V3") {
      const fee   = fees[0]!;
      amountOut   = await quoteV3(adapter, buildV3PackedPath([tokenIn, tokenOut], [fee]), quoteAmountIn);
      adapterData = encodeV3SingleHopAdapterData(fee);

    } else if (adapter === "PANCAKE_V4" || adapter === "UNISWAP_V4") {
      const fee = fees[0]!;
      const ts  = tickSpacings[0] ?? defaultTickSpacing(fee);
      amountOut   = await quoteV4(adapter, tokenIn, tokenOut, quoteAmountIn, fee, ts, ZERO_ADDR);
      adapterData = encodeV4SingleHopAdapterData(tokenIn, tokenOut, fee, ts, ZERO_ADDR, "0x", deadline);

    } else if (adapter === "ONEMEME_BC") {
      const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
      const token = isBuy ? tokenOut : tokenIn;
      amountOut   = (isBuy ? await quoteBcBuy(token, quoteAmountIn) : await quoteBcSell(token, quoteAmountIn)).amountOut;
      adapterData = encodeOneMemeAdapterData(token, deadline);

    } else if (adapter === "FOURMEME") {
      const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
      const token = isBuy ? tokenOut : tokenIn;
      amountOut   = (isBuy ? await quoteFourMemeBuy(token, quoteAmountIn) : await quoteFourMemeSell(token, quoteAmountIn)).amountOut;
      adapterData = encodeFourMemeAdapterData(token);

    } else {
      // FLAPSH
      const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
      const token = isBuy ? tokenOut : tokenIn;
      amountOut   = isBuy ? await quoteFlapShBuy(token, quoteAmountIn) : await quoteFlapShSell(token, quoteAmountIn);
      adapterData = encodeFlapShAdapterData();
    }

    if (amountOut === 0n) throw new Error(`${adapter} returned zero output`);

    const minOut = (amountOut * (10_000n - slippageBps)) / 10_000n;
    const isV4   = adapter === "PANCAKE_V4" || adapter === "UNISWAP_V4";

    return {
      finalAmountOut: amountOut,
      minFinalOut:    minOut,
      steps: [{
        adapter,
        adapterId:   ADAPTER_IDS[adapter],
        tokenIn,
        tokenOut,
        amountIn:    amountIn.toString(),
        amountOut:   amountOut.toString(),
        minOut:      minOut.toString(),
        adapterData,
        fees:        fees.length ? fees : null,
        tickSpacing: isV4 && tickSpacings.length ? tickSpacings : null,
        hooks:       null,
      }],
    };
  }

  /**
   * Returns the best single-hop route from tokenIn to tokenOut across all AMM
   * pools. Used to compute the step1 amount before trying BC bridge routes.
   * `quoteAmountIn` should be `netAmountIn` (after fee) so step2 is anchored
   * to what the adapter actually receives. Returns null if no source has liquidity.
   */
  private async bestSingleHop(
    tokenIn:       Hex,
    tokenOut:      Hex,
    amountIn:      bigint,
    quoteAmountIn: bigint,
    slippageBps:   bigint,
    deadline:      bigint,
  ): Promise<RouteCandidate | null> {
    const candidates = await this.discoverCandidates(tokenIn, tokenOut);
    const results    = await Promise.allSettled(
      candidates.map(c =>
        this.trySingleStepRoute(c.adapter, c.fees, c.tickSpacings, tokenIn, tokenOut, amountIn, slippageBps, deadline, quoteAmountIn),
      ),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<RouteCandidate> => r.status === "fulfilled")
      .map(r => r.value)
      .sort((a, b) => (b.finalAmountOut > a.finalAmountOut ? 1 : -1))[0] ?? null;
  }

  /**
   * Builds the second step of a cross-platform bridge route: WBNB → tokenOut
   * via a bonding-curve adapter. step1 is the already-computed first hop
   * (tokenIn → WBNB). Throws if the BC adapter returns zero output.
   */
  private async tryBcStep2(
    bcAdapter:   AdapterName,
    step1:       RouteCandidate,
    tokenOut:    Hex,
    slippageBps: bigint,
    deadline:    bigint,
  ): Promise<RouteCandidate> {
    const WBNB            = WBNB_BSC as Hex;
    const bridgeAmountOut = step1.finalAmountOut;
    let finalAmountOut: bigint;
    let step2Data: Hex;

    if (bcAdapter === "ONEMEME_BC") {
      finalAmountOut = (await quoteBcBuy(tokenOut, bridgeAmountOut)).amountOut;
      step2Data      = encodeOneMemeAdapterData(tokenOut, deadline);
    } else if (bcAdapter === "FOURMEME") {
      finalAmountOut = (await quoteFourMemeBuy(tokenOut, bridgeAmountOut)).amountOut;
      step2Data      = encodeFourMemeAdapterData(tokenOut);
    } else {
      finalAmountOut = await quoteFlapShBuy(tokenOut, bridgeAmountOut);
      step2Data      = encodeFlapShAdapterData();
    }

    if (finalAmountOut === 0n) throw new Error(`${bcAdapter} returned zero output for bridge step2`);

    const finalMinOut = (finalAmountOut * (10_000n - slippageBps)) / 10_000n;

    return {
      finalAmountOut,
      minFinalOut: finalMinOut,
      steps: [
        step1.steps[0]!,
        {
          adapter:     bcAdapter,
          adapterId:   ADAPTER_IDS[bcAdapter],
          tokenIn:     WBNB,
          tokenOut,
          amountIn:    bridgeAmountOut.toString(),
          amountOut:   finalAmountOut.toString(),
          minOut:      finalMinOut.toString(),
          adapterData: step2Data,
          fees:        null,
          tickSpacing: null,
          hooks:       null,
        },
      ],
    };
  }

  /**
   * Attempts a two-hop route: tokenIn → hub → tokenOut, where each hop picks
   * the best available AMM pool across V2/V3/V4 on PancakeSwap and Uniswap.
   * Both hops are discovered and quoted in parallel; hop2 uses hop1's output
   * as its amountIn (sequential, not combinatorial). Throws if either hop has
   * no valid pool — caller uses Promise.allSettled.
   *
   * `quoteAmountIn` is the net amount (after aggregator fee) used for hop1
   * so that hop2's input reflects what the adapter actually receives on-chain.
   */
  private async tryTwoHopRoute(
    hub:           Hex,
    tokenIn:       Hex,
    tokenOut:      Hex,
    amountIn:      bigint,
    quoteAmountIn: bigint,
    slippageBps:   bigint,
    deadline:      bigint,
  ): Promise<RouteCandidate> {
    // Discover AMM candidates for both hops in parallel
    const [hop1Candidates, hop2Candidates] = await Promise.all([
      this.discoverCandidates(tokenIn, hub),
      this.discoverCandidates(hub, tokenOut),
    ]);

    // Quote all hop1 candidates in parallel; pick the one with the best output
    const hop1Results = await Promise.allSettled(
      hop1Candidates.map(c =>
        this.trySingleStepRoute(c.adapter, c.fees, c.tickSpacings, tokenIn, hub, amountIn, slippageBps, deadline, quoteAmountIn),
      ),
    );
    const hop1Best = hop1Results
      .filter((r): r is PromiseFulfilledResult<RouteCandidate> => r.status === "fulfilled")
      .map(r => r.value)
      .sort((a, b) => (b.finalAmountOut > a.finalAmountOut ? 1 : -1))[0];

    if (!hop1Best) throw new Error(`No liquidity for ${tokenIn}→${hub}`);

    // Quote all hop2 candidates using hop1 output as input
    const hop2Results = await Promise.allSettled(
      hop2Candidates.map(c =>
        this.trySingleStepRoute(c.adapter, c.fees, c.tickSpacings, hub, tokenOut, hop1Best.finalAmountOut, slippageBps, deadline),
      ),
    );
    const hop2Best = hop2Results
      .filter((r): r is PromiseFulfilledResult<RouteCandidate> => r.status === "fulfilled")
      .map(r => r.value)
      .sort((a, b) => (b.finalAmountOut > a.finalAmountOut ? 1 : -1))[0];

    if (!hop2Best) throw new Error(`No liquidity for ${hub}→${tokenOut}`);

    return {
      finalAmountOut: hop2Best.finalAmountOut,
      minFinalOut:    hop2Best.minFinalOut,
      steps:          [hop1Best.steps[0]!, hop2Best.steps[0]!],
    };
  }
}
