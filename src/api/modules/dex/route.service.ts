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
 */

import { Injectable, BadRequestException, ServiceUnavailableException, Logger } from "@nestjs/common";
import { dexFetchFrom } from "./dex-subgraph";
import {
  AdapterName,
  FourMemeRouteInfo,
  OneDexStep,
  buildV2Step,
  buildV3Step,
  buildBcBuyStep,
  buildBcSellStep,
  buildFlapShStep,
  buildFourMemeBuyStep,
  buildFourMemeSellStep,
  buildWbnbUnwrapStep,
  buildOneDexCalldata,
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
  oneDexAddress,
} from "./dex-rpc";
import { WBNB, KNOWN_TOKENS, HUB_TOKENS, feeOnInput as isFeeOnInput } from "./tokens";
import { SecurityService } from "./security.service";
import type { Hex } from "viem";
import { isAddress, normalizeAddress } from "../../helpers";

// ─── Constants ────────────────────────────────────────────────────────────────

const NATIVE_BNB = "0x0000000000000000000000000000000000000000";
const ZERO_ADDR  = "0x0000000000000000000000000000000000000000" as Hex;

// Bonding-curve adapters — require WBNB as one side; no fee tier needed.
const BC_ADAPTERS: AdapterName[] = ["ONEMEME_BC", "FOURMEME", "FLAPSH"];

// Protocol fee charged by OneMEMEAggregator on every swap (0.5% = 200 divisor).
const AGGREGATOR_FEE_DIVISOR = 200n;

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

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function isNative(addr: string): boolean {
  return addr.toLowerCase() === NATIVE_BNB;
}

export function toWbnbIfNative(addr: Hex): Hex {
  return isNative(addr) ? (WBNB as Hex) : addr;
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

// ─── Internal route candidate type ───────────────────────────────────────────

interface StepData {
  adapter:      AdapterName;
  tokenIn:      Hex;
  tokenOut:     Hex;
  amountIn:     string;
  amountOut:    string;
  minOut:       string;
  fees:         number[] | null;
  tickSpacing:  number[] | null;
  hooks:        string[] | null;
  taxBps?:      number | null;
  fourMemeInfo?: FourMemeRouteInfo;
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

  constructor(private readonly security: SecurityService) {}

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

    // OneDex.execute() identifies native BNB by tokenIn/tokenOut == address(0).
    // Internal routing uses WBNB for quoting; calldata restores address(0) for native BNB.
    const ctTokenIn  = nativeIn  ? (NATIVE_BNB as Hex) : tokenIn;
    const ctTokenOut = nativeOut ? (NATIVE_BNB as Hex) : tokenOut;

    // Determine where OneDex deducts its fee — from input (known-safe tokens) or output (FOT).
    const feeOnInputFlag = isFeeOnInput(ctTokenIn);
    const oneDex         = oneDexAddress();
    const oneDexSteps    = this.buildOneDexSteps(steps, nativeIn, oneDex, deadline);
    const calldata       = buildOneDexCalldata(ctTokenIn, amountIn, ctTokenOut, minOut, to, deadline, feeOnInputFlag, oneDexSteps);

    const gasLimit = (100_000n + BigInt(oneDexSteps.length) * 150_000n).toString();

    return {
      data: {
        to:          oneDex,
        calldata,
        value:       nativeIn ? amountIn.toString() : "0",
        gasLimit,
        nativeIn,
        nativeOut,
        singleStep:  !isMulti,
        tokenIn:     nativeIn  ? NATIVE_BNB : tokenIn,
        tokenOut:    nativeOut ? NATIVE_BNB : tokenOut,
        amountIn:    amountIn.toString(),
        feeEstimate: feeEstimate.toString(),
        netAmountIn: (amountIn - feeEstimate).toString(),
        minOut:      route.data.minFinalOut,
        slippageBps: slippageBps.toString(),
        deadline:    deadline.toString(),
        steps,
        sources:     route.data.sources,
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
    const isWbnbIn  = tokenIn.toLowerCase()  === WBNB;
    const isWbnbOut = tokenOut.toLowerCase() === WBNB;

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
      const step1 = await this.bestSingleHop(tokenIn, WBNB as Hex, amountIn, netAmountIn, slippageBps, deadline);
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
      .map(hub => this.tryTwoHopRoute(hub as Hex, tokenIn, tokenOut, amountIn, netAmountIn, slippageBps, deadline));

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
    let fourMemeInfo: FourMemeRouteInfo | undefined;

    if (adapter === "PANCAKE_V2" || adapter === "UNISWAP_V2") {
      // getAmountsOut() ignores transfer tax. We query GoPlus for both sides of the
      // pair (skipping well-known safe tokens) and apply:
      //   • sell (tokenIn tax): (1-sellTax)^3 — worst-case 3 taxed transfers on the
      //     sell path: user→aggregator, aggregator→adapter, adapter→pair via router.
      //   • buy (tokenOut tax): (1-buyTax)^1 — pair sends tokens directly to
      //     recipient via swapExactTokensForETHSupportingFeeOnTransferTokens; one hit.
      // Both corrections are applied independently so token→token pairs are covered.
      // GoPlus tax values > 10000 bps (>100%) are clamped — they indicate honeypots
      // or data errors that would produce a negative amountOut without capping.
      const skipIn  = KNOWN_TOKENS.has(tokenIn.toLowerCase());
      const skipOut = KNOWN_TOKENS.has(tokenOut.toLowerCase());
      const ZERO_TAX = { buyBps: 0n, sellBps: 0n };

      const [rawAmountOut, inTaxInfo, outTaxInfo] = await Promise.all([
        quoteV2(adapter, [tokenIn, tokenOut], quoteAmountIn),
        skipIn  ? Promise.resolve(ZERO_TAX) : this.security.getTokenTaxBps(tokenIn),
        skipOut ? Promise.resolve(ZERO_TAX) : this.security.getTokenTaxBps(tokenOut),
      ]);

      const sellTaxBps = inTaxInfo.sellBps  > 10_000n ? 10_000n : inTaxInfo.sellBps;
      const buyTaxBps  = outTaxInfo.buyBps  > 10_000n ? 10_000n : outTaxInfo.buyBps;

      // Apply (1-sellTax)^3 in three sequential steps to stay within safe bigint range.
      let taxedAmountOut = rawAmountOut;
      if (sellTaxBps > 0n) {
        const f = 10_000n - sellTaxBps;
        taxedAmountOut = (taxedAmountOut * f) / 10_000n;
        taxedAmountOut = (taxedAmountOut * f) / 10_000n;
        taxedAmountOut = (taxedAmountOut * f) / 10_000n;
      }
      if (buyTaxBps > 0n) {
        taxedAmountOut = (taxedAmountOut * (10_000n - buyTaxBps)) / 10_000n;
      }

      if (taxedAmountOut <= 0n) throw new Error(`${adapter} returned zero output`);
      const minOut     = (taxedAmountOut * (10_000n - slippageBps)) / 10_000n;
      const topTaxBps  = sellTaxBps > buyTaxBps ? sellTaxBps : buyTaxBps;

      return {
        finalAmountOut: taxedAmountOut,
        minFinalOut:    minOut,
        steps: [{
          adapter,
          tokenIn,
          tokenOut,
          amountIn:    amountIn.toString(),
          amountOut:   taxedAmountOut.toString(),
          minOut:      minOut.toString(),
          fees:        null,
          tickSpacing: null,
          hooks:       null,
          taxBps:      topTaxBps > 0n ? Number(topTaxBps) : null,
        }],
      };

    } else if (adapter === "PANCAKE_V3" || adapter === "UNISWAP_V3") {
      const fee = fees[0]!;
      amountOut = await quoteV3(adapter, buildV3PackedPath([tokenIn, tokenOut], [fee]), quoteAmountIn);

    } else if (adapter === "PANCAKE_V4" || adapter === "UNISWAP_V4") {
      const fee = fees[0]!;
      const ts  = tickSpacings[0] ?? defaultTickSpacing(fee);
      amountOut = await quoteV4(adapter, tokenIn, tokenOut, quoteAmountIn, fee, ts, ZERO_ADDR);

    } else if (adapter === "ONEMEME_BC") {
      const isBuy = tokenIn.toLowerCase() === WBNB;
      const token = isBuy ? tokenOut : tokenIn;
      amountOut   = (isBuy ? await quoteBcBuy(token, quoteAmountIn) : await quoteBcSell(token, quoteAmountIn)).amountOut;

    } else if (adapter === "FOURMEME") {
      const isBuy  = tokenIn.toLowerCase() === WBNB;
      const token  = isBuy ? tokenOut : tokenIn;
      const result = isBuy ? await quoteFourMemeBuy(token, quoteAmountIn) : await quoteFourMemeSell(token, quoteAmountIn);
      amountOut    = result.amountOut;
      fourMemeInfo = result.routeInfo;

    } else {
      // FLAPSH
      const isBuy = tokenIn.toLowerCase() === WBNB;
      const token = isBuy ? tokenOut : tokenIn;
      amountOut   = isBuy ? await quoteFlapShBuy(token, quoteAmountIn) : await quoteFlapShSell(token, quoteAmountIn);
    }

    if (amountOut === 0n) throw new Error(`${adapter} returned zero output`);

    const minOut = (amountOut * (10_000n - slippageBps)) / 10_000n;
    const isV4   = adapter === "PANCAKE_V4" || adapter === "UNISWAP_V4";

    return {
      finalAmountOut: amountOut,
      minFinalOut:    minOut,
      steps: [{
        adapter,
        tokenIn,
        tokenOut,
        amountIn:    amountIn.toString(),
        amountOut:   amountOut.toString(),
        minOut:      minOut.toString(),
        fees:        fees.length ? fees : null,
        tickSpacing: isV4 && tickSpacings.length ? tickSpacings : null,
        hooks:       null,
        ...(fourMemeInfo ? { fourMemeInfo } : {}),
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
    const bridgeAmountOut = step1.finalAmountOut;
    let finalAmountOut: bigint;
    let fourMemeInfo: FourMemeRouteInfo | undefined;

    if (bcAdapter === "ONEMEME_BC") {
      finalAmountOut = (await quoteBcBuy(tokenOut, bridgeAmountOut)).amountOut;
    } else if (bcAdapter === "FOURMEME") {
      const result   = await quoteFourMemeBuy(tokenOut, bridgeAmountOut);
      finalAmountOut = result.amountOut;
      fourMemeInfo   = result.routeInfo;
    } else {
      finalAmountOut = await quoteFlapShBuy(tokenOut, bridgeAmountOut);
    }

    if (finalAmountOut === 0n) throw new Error(`${bcAdapter} returned zero output for bridge step2`);

    const finalMinOut = (finalAmountOut * (10_000n - slippageBps)) / 10_000n;

    return {
      finalAmountOut,
      minFinalOut: finalMinOut,
      steps: [
        step1.steps[0]!,
        {
          adapter:  bcAdapter,
          tokenIn:  WBNB as Hex,
          tokenOut,
          amountIn:  bridgeAmountOut.toString(),
          amountOut: finalAmountOut.toString(),
          minOut:    finalMinOut.toString(),
          fees:      null,
          tickSpacing: null,
          hooks:     null,
          ...(fourMemeInfo ? { fourMemeInfo } : {}),
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

  /**
   * Converts route StepData[] into concrete OneDexStep[] for calldata encoding.
   *
   * Rules:
   *   • V2/V3 steps always use ERC20 token addresses (WBNB, never address(0)).
   *   • BC/FourMeme buy (tokenIn == WBNB): if this is a bridge step (i > 0), insert
   *     a WBNB unwrap before the buy so the contract has native BNB to forward.
   *   • FlapSH first-step buy with nativeIn: pass address(0) so FlapSH reads msg.value.
   *   • FlapSH bridge buy (i > 0): pass WBNB — FlapSH pulls ERC20 from OneDex.
   */
  private buildOneDexSteps(
    steps:    StepData[],
    nativeIn: boolean,
    oneDex:   Hex,
    deadline: bigint,
  ): OneDexStep[] {
    const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Hex;
    const result: OneDexStep[] = [];

    for (let i = 0; i < steps.length; i++) {
      const s         = steps[i]!;
      const stepAmtIn = BigInt(s.amountIn);
      const stepMin   = BigInt(s.minOut);
      const tIn       = s.tokenIn;
      const tOut      = s.tokenOut;

      if (s.adapter === "PANCAKE_V2" || s.adapter === "UNISWAP_V2") {
        result.push(buildV2Step(s.adapter, tIn, tOut, stepAmtIn, stepMin, oneDex, deadline));

      } else if (s.adapter === "PANCAKE_V3" || s.adapter === "UNISWAP_V3") {
        const fee = s.fees![0]!;
        result.push(buildV3Step(s.adapter, tIn, tOut, fee, stepAmtIn, stepMin, oneDex));

      } else if (s.adapter === "ONEMEME_BC") {
        const isBuy = tIn.toLowerCase() === WBNB.toLowerCase();
        if (isBuy) {
          // Unwrap WBNB → native BNB unless this is the first step and the user sent native BNB.
          // Covers: bridge routes (i > 0) AND direct WBNB-in buys (!nativeIn).
          if (i > 0 || !nativeIn) result.push(buildWbnbUnwrapStep(tIn, stepAmtIn));
          result.push(buildBcBuyStep(tOut, stepAmtIn, stepMin, deadline));
        } else {
          result.push(buildBcSellStep(tIn, stepAmtIn, stepMin, deadline));
        }

      } else if (s.adapter === "FOURMEME") {
        const isBuy = tIn.toLowerCase() === WBNB.toLowerCase();
        if (isBuy) {
          if (i > 0 || !nativeIn) result.push(buildWbnbUnwrapStep(tIn, stepAmtIn));
          result.push(buildFourMemeBuyStep(tOut, stepAmtIn, stepMin, oneDex, s.fourMemeInfo!));
        } else {
          result.push(buildFourMemeSellStep(tIn, stepAmtIn, stepMin, s.fourMemeInfo!));
        }

      } else if (s.adapter === "FLAPSH") {
        // Direct native-BNB-in buy (first step): pass address(0) so FlapSH uses msg.value.
        // Bridge buy (i > 0): tIn is WBNB — FlapSH pulls ERC20 from OneDex.
        const flapShTokenIn = (i === 0 && nativeIn) ? ZERO_ADDR : tIn;
        result.push(buildFlapShStep(flapShTokenIn, tOut, stepAmtIn, stepMin));
      }
    }

    return result;
  }
}
