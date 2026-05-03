/**
 * DEX Route Service — aggregation layer for optimal price routing.
 *
 * Responsible for:
 *   • On-chain quotes (single adapter)
 *   • Route finding — when no adapter is specified, quotes all relevant
 *     liquidity sources in parallel and returns the best price
 *   • Calldata building for direct (non-gasless) swap and batch-swap transactions
 *
 * This service has no knowledge of meta-transactions, relayers, or EIP-712.
 * Those concerns belong to MetaTxService which sits above this layer.
 */

import { Injectable, BadRequestException, ServiceUnavailableException, Logger } from "@nestjs/common";
import { dexFetchFrom } from "./dex-subgraph";
import {
  ADAPTER_IDS,
  ADAPTER_NAMES,
  AdapterName,
  SwapStep,
  encodeV2AdapterData,
  encodeV3SingleHopAdapterData,
  encodeV3MultiHopAdapterData,
  encodeV4SingleHopAdapterData,
  encodeV4MultiHopAdapterData,
  encodeOneMemeAdapterData,
  encodeFourMemeAdapterData,
  encodeFlapShAdapterData,
  buildSwapCalldata,
  buildBatchSwapCalldata,
  buildV3PackedPath,
  quoteV2,
  quoteV3,
  quoteV4,
  quoteV4Multi,
  quoteBcBuy,
  quoteBcSell,
  quoteFourMemeBuy,
  quoteFourMemeSell,
  quoteFlapShBuy,
  quoteFlapShSell,
  defaultTickSpacing,
  aggregatorAddress,
} from "./dex-rpc";
import type { Hex } from "viem";
import { isAddress, normalizeAddress } from "../../helpers";

// ─── Constants ────────────────────────────────────────────────────────────────

const WBNB_BSC   = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const NATIVE_BNB = "0x0000000000000000000000000000000000000000";
const ZERO_ADDR  = "0x0000000000000000000000000000000000000000" as Hex;

// Bonding-curve adapters — require WBNB as one side; no fee tier needed.
const BC_ADAPTERS: AdapterName[] = ["ONEMEME_BC", "FOURMEME", "FLAPSH"];

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
  if (typeof val === "number") {
    if (!Number.isInteger(val)) {
      throw new BadRequestException(`${name} must be an integer (wei), not a float`);
    }
  } else if (typeof val !== "string") {
    throw new BadRequestException(`${name} must be a numeric string (wei)`);
  }
  try {
    const n = BigInt(val as string | number);
    if (n < 0n) throw new Error();
    return n;
  } catch {
    throw new BadRequestException(`${name} must be a non-negative integer (wei)`);
  }
}

export function requireAdapter(val: unknown): AdapterName {
  if (typeof val !== "string" || !(val.toUpperCase() in ADAPTER_IDS)) {
    throw new BadRequestException(
      `adapter must be one of: ${ADAPTER_NAMES.join(", ")}`,
    );
  }
  return val.toUpperCase() as AdapterName;
}

/**
 * Builds the ABI-encoded adapterData bytes for each adapter type.
 * Exported so MetaTxService can encode adapter data when building EIP-712 orders.
 */
export function buildAdapterData(
  adapterName: AdapterName,
  tokenIn:     Hex,
  tokenOut:    Hex,
  body:        Record<string, unknown>,
  deadline:    bigint,
): Hex {
  if (adapterName === "ONEMEME_BC") {
    const token = tokenIn.toLowerCase() === WBNB_BSC ? tokenOut : tokenIn;
    return encodeOneMemeAdapterData(token, deadline);
  }

  if (adapterName === "FOURMEME") {
    const token = tokenIn.toLowerCase() === WBNB_BSC ? tokenOut : tokenIn;
    return encodeFourMemeAdapterData(token);
  }

  if (adapterName === "FLAPSH") {
    return encodeFlapShAdapterData();
  }

  if (adapterName === "PANCAKE_V2" || adapterName === "UNISWAP_V2") {
    const rawPath = body["path"];
    let path: Hex[];
    if (Array.isArray(rawPath) && rawPath.length >= 2) {
      rawPath.forEach((p, i) => {
        if (!isAddress(String(p))) throw new BadRequestException(`path[${i}] is not a valid address`);
      });
      path = rawPath.map(p => normalizeAddress(String(p)) as Hex);
    } else {
      path = [tokenIn, tokenOut];
    }
    return encodeV2AdapterData(path, deadline);
  }

  if (adapterName === "PANCAKE_V3" || adapterName === "UNISWAP_V3") {
    const rawPath = body["path"];
    const rawFees = body["fees"];

    let tokens: Hex[];
    if (Array.isArray(rawPath) && rawPath.length >= 2) {
      rawPath.forEach((p, i) => {
        if (!isAddress(String(p))) throw new BadRequestException(`path[${i}] is not a valid address`);
      });
      tokens = rawPath.map(p => normalizeAddress(String(p)) as Hex);
    } else {
      tokens = [tokenIn, tokenOut];
    }

    const hopCount = tokens.length - 1;
    if (!Array.isArray(rawFees) || rawFees.length !== hopCount) {
      throw new BadRequestException(
        hopCount === 1
          ? "V3 swaps require a fees array (e.g. [500] for 0.05%)"
          : `V3 fees must have ${hopCount} element(s) for ${tokens.length} tokens`,
      );
    }
    const fees = rawFees.map((f, i) => {
      const n = parseInt(String(f), 10);
      if (isNaN(n) || n <= 0) throw new BadRequestException(`fees[${i}] must be a positive integer`);
      return n;
    });

    return hopCount === 1
      ? encodeV3SingleHopAdapterData(fees[0]!)
      : encodeV3MultiHopAdapterData(tokens, fees);
  }

  if (adapterName === "PANCAKE_V4" || adapterName === "UNISWAP_V4") {
    const rawPath        = body["path"];
    const rawFees        = body["fees"];
    const rawTickSpacings = body["tickSpacing"];
    const rawHooks       = body["hooks"];

    let tokens: Hex[];
    if (Array.isArray(rawPath) && rawPath.length >= 2) {
      rawPath.forEach((p, i) => {
        if (!isAddress(String(p))) throw new BadRequestException(`path[${i}] is not a valid address`);
      });
      tokens = rawPath.map(p => normalizeAddress(String(p)) as Hex);
    } else {
      tokens = [tokenIn, tokenOut];
    }

    const hopCount = tokens.length - 1;
    if (!Array.isArray(rawFees) || rawFees.length !== hopCount) {
      throw new BadRequestException(`V4 swaps require ${hopCount} fee tier(s) in fees array`);
    }
    const fees = rawFees.map((f, i) => {
      const n = parseInt(String(f), 10);
      if (isNaN(n) || n <= 0) throw new BadRequestException(`fees[${i}] must be a positive integer`);
      return n;
    });

    const tickSpacings: number[] = Array.isArray(rawTickSpacings)
      ? rawTickSpacings.map(s => parseInt(String(s), 10) || 0)
      : [];
    const hooksArr: Hex[] = Array.isArray(rawHooks)
      ? rawHooks.map((h, i) => {
          if (!isAddress(String(h))) throw new BadRequestException(`hooks[${i}] is not a valid address`);
          return normalizeAddress(String(h)) as Hex;
        })
      : [];

    if (hopCount === 1) {
      const fee        = fees[0]!;
      const tickSpacing = tickSpacings[0] || defaultTickSpacing(fee);
      const hooks      = hooksArr[0] ?? ZERO_ADDR;
      return encodeV4SingleHopAdapterData(tokenIn, tokenOut, fee, tickSpacing, hooks, "0x", deadline);
    } else {
      return encodeV4MultiHopAdapterData(tokens, fees, tickSpacings, hooksArr, deadline);
    }
  }

  throw new BadRequestException(`Unknown adapter: ${adapterName}`);
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
   * Live on-chain quote for a specific adapter. Returns expected output,
   * slippage-adjusted minimum, and suggested calldata parameters.
   */
  async getQuote(query: Record<string, string | undefined>) {
    const adapter       = requireAdapter(query["adapter"]);
    const rawTokenIn    = requireAddress(query["tokenIn"],  "tokenIn");
    const rawTokenOut   = requireAddress(query["tokenOut"], "tokenOut");
    const amountIn      = requireBigInt(query["amountIn"],  "amountIn");

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

    const rawPath         = query["path"]?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
    const rawFees         = query["fees"]?.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) ?? [];
    const rawTickSpacings = query["tickSpacing"]?.split(",").map(s => parseInt(s.trim(), 10) || 0) ?? [];
    const rawHooksArr     = query["hooks"]?.split(",").map(s => s.trim()).filter(Boolean) ?? [];

    const path: Hex[] = rawPath.length >= 2
      ? rawPath.map((p, i) => {
          if (!isAddress(p)) throw new BadRequestException(`path[${i}] is not a valid address`);
          return toWbnbIfNative(normalizeAddress(p) as Hex);
        })
      : [tokenIn, tokenOut];

    let amountOut: bigint;
    let fee:       bigint | null = null;
    let quotedBy:  string;

    try {
      if (adapter === "PANCAKE_V2" || adapter === "UNISWAP_V2") {
        amountOut = await quoteV2(adapter, path, amountIn);
        quotedBy  = adapter === "PANCAKE_V2" ? "PancakeSwap V2 Router" : "Uniswap V2 Router";

      } else if (adapter === "PANCAKE_V3" || adapter === "UNISWAP_V3") {
        if (rawFees.length !== path.length - 1) {
          throw new BadRequestException(
            `V3 quote requires ${path.length - 1} fee tier(s) — provide via ?fees=500 (comma-separated for multi-hop)`,
          );
        }
        const packedPath = buildV3PackedPath(path, rawFees);
        amountOut = await quoteV3(adapter, packedPath, amountIn);
        quotedBy  = adapter === "PANCAKE_V3" ? "PancakeSwap V3 QuoterV2" : "Uniswap V3 QuoterV2";

      } else if (adapter === "ONEMEME_BC") {
        const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
        const token = isBuy ? tokenOut : tokenIn;
        const r = isBuy ? await quoteBcBuy(token, amountIn) : await quoteBcSell(token, amountIn);
        amountOut = r.amountOut;
        fee       = r.fee;
        quotedBy  = "OneMEME BondingCurve";

      } else if (adapter === "FOURMEME") {
        const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
        const token = isBuy ? tokenOut : tokenIn;
        const r = isBuy ? await quoteFourMemeBuy(token, amountIn) : await quoteFourMemeSell(token, amountIn);
        amountOut = r.amountOut;
        fee       = r.fee;
        quotedBy  = "FourMEME TokenManagerHelper3";

      } else if (adapter === "FLAPSH") {
        const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
        const token = isBuy ? tokenOut : tokenIn;
        amountOut = isBuy ? await quoteFlapShBuy(token, amountIn) : await quoteFlapShSell(token, amountIn);
        quotedBy  = "Flap.SH Portal";

      } else if (adapter === "PANCAKE_V4" || adapter === "UNISWAP_V4") {
        const hopCount = path.length - 1;
        if (rawFees.length !== hopCount) {
          throw new BadRequestException(
            `V4 quote requires ${hopCount} fee tier(s) for ${path.length} tokens — ` +
            `provide via ?fees=3000 (single-hop) or ?fees=500,3000 (multi-hop)`,
          );
        }
        rawHooksArr.forEach((h, i) => {
          if (!isAddress(h)) throw new BadRequestException(`hooks[${i}] is not a valid EVM address`);
        });

        const label = adapter === "PANCAKE_V4" ? "PancakeSwap V4 Quoter" : "Uniswap V4 Quoter";
        if (hopCount === 1) {
          const f  = rawFees[0]!;
          const ts = rawTickSpacings[0] || defaultTickSpacing(f);
          const hk = (rawHooksArr[0] ?? ZERO_ADDR) as Hex;
          amountOut = await quoteV4(adapter, tokenIn, tokenOut, amountIn, f, ts, hk);
        } else {
          amountOut = await quoteV4Multi(adapter, path, amountIn, rawFees, rawTickSpacings, rawHooksArr as Hex[]);
        }
        quotedBy = label;

      } else {
        throw new BadRequestException(`On-chain quote is not supported for ${adapter}`);
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) throw err;
      const msg = String(err);
      if (
        msg.includes("not configured") || msg.includes("timeout") || msg.includes("TIMEOUT") ||
        msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("fetch failed")
      ) {
        throw new ServiceUnavailableException(`Quote unavailable: ${msg}`);
      }
      throw new BadRequestException(`Quote simulation failed: ${msg}`);
    }

    const aggregatorFee = amountIn / 100n;
    const minOut        = (amountOut * (10_000n - slippageBps)) / 10_000n;
    const isV4          = adapter === "PANCAKE_V4" || adapter === "UNISWAP_V4";
    const hopCount      = path.length - 1;

    return {
      data: {
        adapter,
        tokenIn:       nativeIn  ? NATIVE_BNB : tokenIn,
        tokenOut:      nativeOut ? NATIVE_BNB : tokenOut,
        nativeIn,
        nativeOut,
        value:         nativeIn ? amountIn.toString() : "0",
        amountIn:      amountIn.toString(),
        amountOut:     amountOut.toString(),
        minOut:        minOut.toString(),
        aggregatorFee: aggregatorFee.toString(),
        bondingFee:    fee?.toString() ?? null,
        slippageBps:   slippageBps.toString(),
        quotedBy,
        path,
        fees:          rawFees.length ? rawFees : null,
        tickSpacing:   isV4
          ? rawFees.map((f, i) => rawTickSpacings[i] || defaultTickSpacing(f))
          : null,
        hooks:         isV4
          ? Array.from({ length: hopCount }, (_, i) => rawHooksArr[i] ?? ZERO_ADDR)
          : null,
      },
    };
  }

  // ── Route ──────────────────────────────────────────────────────────────────

  /**
   * GET /dex/route
   *
   * Aggregation mode (no adapter param): quotes all relevant liquidity sources
   * — V2, V3 (common fee tiers), and bonding-curve adapters when applicable —
   * in parallel and returns the route with the best output. The `sources` field
   * in the response shows every source that was tried with its quoted amount.
   *
   * Specific adapter mode (adapter param provided): routes through that single
   * adapter. For bonding-curve adapters with a non-WBNB tokenIn, automatically
   * prepends a PANCAKE_V3 (fee 500, fallback PANCAKE_V2) bridge hop to WBNB.
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

    const nowSec       = BigInt(Math.floor(Date.now() / 1000));
    const deadline     = nowSec + 1800n;
    const aggregatorFee = amountIn / 100n;

    // ── Aggregation mode: no adapter specified ─────────────────────────────
    if (!query["adapter"]) {
      return this.aggregateRoute(
        tokenIn, tokenOut, amountIn, slippageBps, deadline,
        nativeIn, nativeOut, aggregatorFee,
      );
    }

    // ── Specific adapter mode ──────────────────────────────────────────────
    const adapter      = requireAdapter(query["adapter"]);
    const isBcAdapter  = BC_ADAPTERS.includes(adapter);
    const needsBridge  = isBcAdapter && tokenIn.toLowerCase() !== WBNB_BSC;
    const WBNB         = WBNB_BSC as Hex;

    const rawFees         = query["fees"]?.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) ?? [];
    const rawTickSpacings = query["tickSpacing"]?.split(",").map(s => parseInt(s.trim(), 10) || 0) ?? [];
    const rawHooksArr     = query["hooks"]?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
    const rawPath         = query["path"]?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
    const path: Hex[]     = rawPath.length >= 2
      ? rawPath.map(p => toWbnbIfNative(normalizeAddress(p) as Hex))
      : [tokenIn, tokenOut];

    const wrapQuoteError = (err: unknown, label: string): never => {
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) throw err;
      const msg = String(err);
      if (
        msg.includes("not configured") || msg.includes("timeout") ||
        msg.includes("ECONNREFUSED") || msg.includes("fetch failed")
      ) throw new ServiceUnavailableException(`${label} unavailable: ${msg}`);
      throw new BadRequestException(`${label} failed: ${msg}`);
    };

    if (!needsBridge) {
      let amountOut: bigint;
      try {
        if (adapter === "ONEMEME_BC") {
          const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
          const token = isBuy ? tokenOut : tokenIn;
          amountOut = (isBuy ? await quoteBcBuy(token, amountIn) : await quoteBcSell(token, amountIn)).amountOut;
        } else if (adapter === "FOURMEME") {
          const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
          const token = isBuy ? tokenOut : tokenIn;
          amountOut = (isBuy ? await quoteFourMemeBuy(token, amountIn) : await quoteFourMemeSell(token, amountIn)).amountOut;
        } else if (adapter === "FLAPSH") {
          const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
          const token = isBuy ? tokenOut : tokenIn;
          amountOut = isBuy ? await quoteFlapShBuy(token, amountIn) : await quoteFlapShSell(token, amountIn);
        } else if (adapter === "PANCAKE_V2" || adapter === "UNISWAP_V2") {
          amountOut = await quoteV2(adapter, path, amountIn);
        } else if (adapter === "PANCAKE_V3" || adapter === "UNISWAP_V3") {
          if (rawFees.length === 0) throw new BadRequestException("V3 route requires ?fees= query param (e.g. ?fees=500)");
          amountOut = await quoteV3(adapter, buildV3PackedPath(path, rawFees), amountIn);
        } else {
          // PANCAKE_V4 or UNISWAP_V4
          const hopCount = path.length - 1;
          if (rawFees.length !== hopCount) {
            throw new BadRequestException(
              `V4 route requires ${hopCount} fee tier(s) — provide via ?fees=3000` +
              (hopCount > 1 ? " (comma-separated for multi-hop)" : ""),
            );
          }
          if (hopCount === 1) {
            const f  = rawFees[0]!;
            const ts = rawTickSpacings[0] || defaultTickSpacing(f);
            const hk = (rawHooksArr[0] ?? ZERO_ADDR) as Hex;
            amountOut = await quoteV4(adapter, tokenIn, tokenOut, amountIn, f, ts, hk);
          } else {
            amountOut = await quoteV4Multi(adapter, path, amountIn, rawFees, rawTickSpacings, rawHooksArr as Hex[]);
          }
        }
      } catch (err) { wrapQuoteError(err, "Quote"); }

      const minOut      = (amountOut! * (10_000n - slippageBps)) / 10_000n;
      const isV4        = adapter === "PANCAKE_V4" || adapter === "UNISWAP_V4";
      const adapterBody: Record<string, unknown> = {
        ...(rawFees.length      > 0 && { fees:        rawFees        }),
        ...(rawPath.length     >= 2 && { path:        rawPath        }),
        ...(isV4 && rawTickSpacings.length > 0 && { tickSpacing: rawTickSpacings }),
        ...(isV4 && rawHooksArr.length     > 0 && { hooks:       rawHooksArr     }),
      };
      const adapterData = buildAdapterData(adapter, tokenIn, tokenOut, adapterBody, deadline);

      return {
        data: {
          singleStep: true,
          nativeIn,
          nativeOut,
          value:      nativeIn ? amountIn.toString() : "0",
          steps: [{
            adapter,
            adapterId:   ADAPTER_IDS[adapter],
            tokenIn,
            tokenOut,
            amountIn:    amountIn.toString(),
            amountOut:   amountOut!.toString(),
            minOut:      minOut.toString(),
            adapterData,
            fees:        rawFees.length ? rawFees : null,
            tickSpacing: isV4 && rawFees.length
              ? rawFees.map((f, i) => rawTickSpacings[i] || defaultTickSpacing(f))
              : null,
            hooks: isV4
              ? Array.from({ length: path.length - 1 }, (_, i) =>
                  rawHooksArr[i] ?? ZERO_ADDR)
              : null,
          }],
          amountIn:      amountIn.toString(),
          minFinalOut:   minOut.toString(),
          aggregatorFee: aggregatorFee.toString(),
          slippageBps:   slippageBps.toString(),
        },
      };
    }

    // ── Two-step bridge route: tokenIn → WBNB → tokenOut (BC adapter) ─────
    let bridgeAmountOut: bigint;
    let bridgeAdapter:   "PANCAKE_V3" | "PANCAKE_V2" = "PANCAKE_V2";
    let step1Data:       Hex;

    try {
      bridgeAmountOut = await quoteV3("PANCAKE_V3", buildV3PackedPath([tokenIn, WBNB], [500]), amountIn);
      bridgeAdapter   = "PANCAKE_V3";
      step1Data       = encodeV3SingleHopAdapterData(500);
    } catch {
      try {
        bridgeAmountOut = await quoteV2("PANCAKE_V2", [tokenIn, WBNB], amountIn);
        bridgeAdapter   = "PANCAKE_V2";
        step1Data       = encodeV2AdapterData([tokenIn, WBNB], deadline);
      } catch (err2) {
        wrapQuoteError(
          new BadRequestException(`No PANCAKE_V3/V2 bridge path from tokenIn to WBNB: ${String(err2)}`),
          "Bridge quote",
        );
      }
    }

    const bridgeMinOut = (bridgeAmountOut! * (10_000n - slippageBps)) / 10_000n;
    const wbnbIn       = bridgeAmountOut!;

    let finalAmountOut: bigint;
    try {
      if (adapter === "ONEMEME_BC") {
        finalAmountOut = (await quoteBcBuy(tokenOut, wbnbIn)).amountOut;
      } else if (adapter === "FOURMEME") {
        finalAmountOut = (await quoteFourMemeBuy(tokenOut, wbnbIn)).amountOut;
      } else {
        finalAmountOut = await quoteFlapShBuy(tokenOut, wbnbIn);
      }
    } catch (err) { wrapQuoteError(err, "BC quote"); }

    const finalMinOut = (finalAmountOut! * (10_000n - slippageBps)) / 10_000n;
    const step2Data   = buildAdapterData(adapter, WBNB, tokenOut, {}, deadline);

    return {
      data: {
        singleStep: false,
        nativeIn,
        nativeOut,
        value: nativeIn ? amountIn.toString() : "0",
        steps: [
          {
            adapter:     bridgeAdapter!,
            adapterId:   ADAPTER_IDS[bridgeAdapter!],
            tokenIn,
            tokenOut:    WBNB,
            amountIn:    amountIn.toString(),
            amountOut:   bridgeAmountOut!.toString(),
            minOut:      bridgeMinOut.toString(),
            adapterData: step1Data!,
            fees:        bridgeAdapter === "PANCAKE_V3" ? [500] : null,
            tickSpacing: null,
            hooks:       null,
          },
          {
            adapter,
            adapterId:   ADAPTER_IDS[adapter],
            tokenIn:     WBNB,
            tokenOut,
            amountIn:    wbnbIn.toString(),
            amountOut:   finalAmountOut!.toString(),
            minOut:      finalMinOut.toString(),
            adapterData: step2Data,
            fees:        null,
            tickSpacing: null,
            hooks:       null,
          },
        ],
        amountIn:      amountIn.toString(),
        minFinalOut:   finalMinOut.toString(),
        aggregatorFee: aggregatorFee.toString(),
        slippageBps:   slippageBps.toString(),
      },
    };
  }

  // ── Swap calldata builders ─────────────────────────────────────────────────

  /**
   * POST /dex/swap
   * Builds calldata for a direct OneMEMEAggregator.swap() call.
   * The caller broadcasts the transaction — no relayer involved.
   */
  async buildSwap(body: Record<string, unknown>) {
    const adapter      = requireAdapter(body["adapter"]);
    const rawTokenIn   = requireAddress(body["tokenIn"],  "tokenIn");
    const rawTokenOut  = requireAddress(body["tokenOut"], "tokenOut");
    const amountIn     = requireBigInt(body["amountIn"],  "amountIn");
    const minOut       = requireBigInt(body["minOut"],    "minOut");
    const to           = requireAddress(body["to"], "to");
    const deadline     = requireBigInt(body["deadline"], "deadline");

    if (amountIn === 0n) throw new BadRequestException("amountIn must be greater than 0");
    if (isNative(rawTokenIn) && isNative(rawTokenOut)) {
      throw new BadRequestException("tokenIn and tokenOut cannot both be native BNB");
    }
    if (deadline <= BigInt(Math.floor(Date.now() / 1000))) {
      throw new BadRequestException("deadline has already passed");
    }

    const nativeIn  = isNative(rawTokenIn);
    const nativeOut = isNative(rawTokenOut);
    const tokenIn   = toWbnbIfNative(rawTokenIn);
    const tokenOut  = toWbnbIfNative(rawTokenOut);

    const adapterId   = ADAPTER_IDS[adapter];
    const adapterData = buildAdapterData(adapter, tokenIn, tokenOut, body, deadline);
    const feeEstimate = amountIn / 100n;
    const netAmountIn = amountIn - feeEstimate;
    const calldata    = buildSwapCalldata(adapterId, tokenIn, amountIn, tokenOut, minOut, to, deadline, adapterData);

    return {
      data: {
        to:          aggregatorAddress(),
        calldata,
        value:       nativeIn ? amountIn.toString() : "0",
        nativeIn,
        nativeOut,
        adapter,
        adapterId,
        tokenIn:       nativeIn  ? NATIVE_BNB : tokenIn,
        tokenOut:      nativeOut ? NATIVE_BNB : tokenOut,
        amountIn:      amountIn.toString(),
        feeEstimate:   feeEstimate.toString(),
        netAmountIn:   netAmountIn.toString(),
        minOut:        minOut.toString(),
        deadline:      deadline.toString(),
        adapterData,
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

    const feeEstimate = amountIn / 100n;
    const calldata    = buildBatchSwapCalldata(steps, amountIn, minFinalOut, to, deadline);

    return {
      data: {
        to:          aggregatorAddress(),
        calldata,
        nativeIn,
        nativeOut,
        value:       nativeIn ? amountIn.toString() : "0",
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
    } catch {
      return [];
    }
  }

  /**
   * Quotes all relevant liquidity sources in parallel and returns the route
   * with the highest final output amount.
   *
   * V2 and bonding-curve adapters are always tried (no pool discovery needed).
   * V3/V4 pools are discovered from their subgraphs first — only pools that
   * actually exist with liquidity are quoted, using their real fee tiers and
   * (for V4) tick spacings. No hardcoded fee tier probing.
   * BC adapters are only included when one side of the pair is WBNB.
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

    // Discover V3/V4 pools in parallel while queuing V2/BC as fixed candidates
    const [pancakeV3, uniswapV3, pancakeV4, uniswapV4] = await Promise.all([
      this.discoverPools("PANCAKE_V3", tokenIn, tokenOut),
      this.discoverPools("UNISWAP_V3", tokenIn, tokenOut),
      this.discoverPools("PANCAKE_V4", tokenIn, tokenOut),
      this.discoverPools("UNISWAP_V4", tokenIn, tokenOut),
    ]);

    type Candidate = { adapter: AdapterName; fees: number[]; tickSpacings: number[] };

    const candidates: Candidate[] = [
      // V2 — always try; quote call fails gracefully if no pool
      { adapter: "PANCAKE_V2", fees: [], tickSpacings: [] },
      { adapter: "UNISWAP_V2", fees: [], tickSpacings: [] },
      // V3 — only discovered pools with real fee tiers
      ...pancakeV3.map(p => ({ adapter: "PANCAKE_V3" as AdapterName, fees: [p.feeTier], tickSpacings: [] })),
      ...uniswapV3.map(p => ({ adapter: "UNISWAP_V3" as AdapterName, fees: [p.feeTier], tickSpacings: [] })),
      // V4 — discovered pools with real fee tiers + tick spacings
      ...pancakeV4.map(p => ({ adapter: "PANCAKE_V4" as AdapterName, fees: [p.feeTier], tickSpacings: [p.tickSpacing] })),
      ...uniswapV4.map(p => ({ adapter: "UNISWAP_V4" as AdapterName, fees: [p.feeTier], tickSpacings: [p.tickSpacing] })),
      // BC adapters — only when one side is WBNB
      ...(isWbnbIn || isWbnbOut
        ? BC_ADAPTERS.map(a => ({ adapter: a, fees: [], tickSpacings: [] }))
        : []),
    ];

    const results = await Promise.allSettled(
      candidates.map(c =>
        this.trySingleStepRoute(c.adapter, c.fees, c.tickSpacings, tokenIn, tokenOut, amountIn, slippageBps, deadline),
      ),
    );

    const successful = results
      .filter((r): r is PromiseFulfilledResult<RouteCandidate> => r.status === "fulfilled")
      .map(r => r.value)
      .sort((a, b) => (b.finalAmountOut > a.finalAmountOut ? 1 : -1));

    if (successful.length === 0) {
      throw new ServiceUnavailableException(
        "No route found — no liquidity source returned a valid quote for this pair",
      );
    }

    const best = successful[0]!;

    return {
      data: {
        singleStep:    true,
        nativeIn,
        nativeOut,
        value:         nativeIn ? amountIn.toString() : "0",
        steps:         best.steps,
        amountIn:      amountIn.toString(),
        minFinalOut:   best.minFinalOut.toString(),
        aggregatorFee: aggregatorFee.toString(),
        slippageBps:   slippageBps.toString(),
        sources: successful.map(r => ({
          adapter:   r.steps[0]!.adapter,
          fees:      r.steps[0]!.fees,
          amountOut: r.steps[r.steps.length - 1]!.amountOut,
        })),
      },
    };
  }

  /**
   * Attempts a single-step quote + adapterData encoding for one candidate.
   * Throws if the source has no liquidity — caller uses Promise.allSettled.
   */
  private async trySingleStepRoute(
    adapter:      AdapterName,
    fees:         number[],
    tickSpacings: number[],
    tokenIn:      Hex,
    tokenOut:     Hex,
    amountIn:     bigint,
    slippageBps:  bigint,
    deadline:     bigint,
  ): Promise<RouteCandidate> {
    let amountOut: bigint;
    let adapterData: Hex;

    if (adapter === "PANCAKE_V2" || adapter === "UNISWAP_V2") {
      amountOut   = await quoteV2(adapter, [tokenIn, tokenOut], amountIn);
      adapterData = encodeV2AdapterData([tokenIn, tokenOut], deadline);

    } else if (adapter === "PANCAKE_V3" || adapter === "UNISWAP_V3") {
      const fee   = fees[0]!;
      amountOut   = await quoteV3(adapter, buildV3PackedPath([tokenIn, tokenOut], [fee]), amountIn);
      adapterData = encodeV3SingleHopAdapterData(fee);

    } else if (adapter === "PANCAKE_V4" || adapter === "UNISWAP_V4") {
      const fee = fees[0]!;
      const ts  = tickSpacings[0] ?? defaultTickSpacing(fee);
      amountOut   = await quoteV4(adapter, tokenIn, tokenOut, amountIn, fee, ts, ZERO_ADDR);
      adapterData = encodeV4SingleHopAdapterData(tokenIn, tokenOut, fee, ts, ZERO_ADDR, "0x", deadline);

    } else if (adapter === "ONEMEME_BC") {
      const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
      const token = isBuy ? tokenOut : tokenIn;
      amountOut   = (isBuy ? await quoteBcBuy(token, amountIn) : await quoteBcSell(token, amountIn)).amountOut;
      adapterData = encodeOneMemeAdapterData(token, deadline);

    } else if (adapter === "FOURMEME") {
      const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
      const token = isBuy ? tokenOut : tokenIn;
      amountOut   = (isBuy ? await quoteFourMemeBuy(token, amountIn) : await quoteFourMemeSell(token, amountIn)).amountOut;
      adapterData = encodeFourMemeAdapterData(token);

    } else {
      // FLAPSH
      const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
      const token = isBuy ? tokenOut : tokenIn;
      amountOut   = isBuy ? await quoteFlapShBuy(token, amountIn) : await quoteFlapShSell(token, amountIn);
      adapterData = encodeFlapShAdapterData();
    }

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
}
