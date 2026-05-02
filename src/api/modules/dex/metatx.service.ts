import { Injectable, BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import {
  ADAPTER_IDS,
  ADAPTER_NAMES,
  AdapterName,
  MetaTxOrder,
  PermitData,
  SwapStep,
  BatchMetaTxOrder,
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
  getUserNonce,
  getOrderDigest,
  getBatchOrderDigest,
  relayMetaTx,
  relayBatchMetaTx,
  aggregatorAddress,
  metaTxAddress,
} from "./dex-rpc";
import type { Hex } from "viem";
import { isAddress, normalizeAddress } from "../../helpers";

// ─── Constants ────────────────────────────────────────────────────────────────

const WBNB_BSC  = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const NATIVE_BNB = "0x0000000000000000000000000000000000000000";

function isNative(addr: string): boolean {
  return addr.toLowerCase() === NATIVE_BNB;
}

/** Replace the zero address with WBNB so all downstream routing uses a real ERC-20. */
function toWbnbIfNative(addr: Hex): Hex {
  return isNative(addr) ? (WBNB_BSC as Hex) : addr;
}

// ─── Input validation helpers ─────────────────────────────────────────────────

function requireAddress(val: unknown, name: string): Hex {
  if (typeof val !== "string" || !isAddress(val)) {
    throw new BadRequestException(`${name} must be a valid EVM address`);
  }
  return normalizeAddress(val) as Hex;
}

function requireBigInt(val: unknown, name: string): bigint {
  if (typeof val !== "string" && typeof val !== "number") {
    throw new BadRequestException(`${name} must be a numeric string (wei)`);
  }
  try {
    const n = BigInt(val);
    if (n < 0n) throw new Error();
    return n;
  } catch {
    throw new BadRequestException(`${name} must be a non-negative integer (wei)`);
  }
}

function requireAdapter(val: unknown): AdapterName {
  if (typeof val !== "string" || !(val.toUpperCase() in ADAPTER_IDS)) {
    throw new BadRequestException(
      `adapter must be one of: ${ADAPTER_NAMES.join(", ")}`,
    );
  }
  return val.toUpperCase() as AdapterName;
}

function parsePermitType(val: unknown): 0 | 1 | 2 {
  const n = parseInt(String(val ?? "0"), 10);
  if (n !== 0 && n !== 1 && n !== 2) {
    throw new BadRequestException("permitType must be 0 (NONE), 1 (EIP-2612), or 2 (Permit2)");
  }
  return n as 0 | 1 | 2;
}

// ─── adapterData builder ──────────────────────────────────────────────────────

/**
 * Builds the ABI-encoded adapterData bytes matching what each on-chain adapter decodes.
 *
 * Encoding per adapter (from OneMEMELaunchpad-Core adapter contracts):
 *   ONEMEME_BC             abi.encode(address token, uint256 deadline)
 *   FOURMEME               abi.encode(address token)
 *   FLAPSH                 0x  (adapter derives everything from tokenIn/tokenOut)
 *   PANCAKE_V2/UNISWAP_V2  abi.encode(address[] path, uint256 deadline)
 *   PANCAKE_V3/UNISWAP_V3  single: abi.encode(false, abi.encode(uint24 fee, uint160 sqrtLimit))
 *                          multi:  abi.encode(true, abi.encodePacked(tok0,fee0,tok1,...))
 *   PANCAKE_V4/UNISWAP_V4  single: abi.encode(false, PoolKey, bool zeroForOne, bytes hookData, uint256 deadline)
 *                          multi:  abi.encode(true, PathKey[], uint256 deadline)
 */
function buildAdapterData(
  adapterName: AdapterName,
  tokenIn:     Hex,
  tokenOut:    Hex,
  body:        Record<string, unknown>,
  deadline:    bigint,
): Hex {
  // ── Bonding-curve adapters ────────────────────────────────────────────────
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

  // ── V2 adapters ───────────────────────────────────────────────────────────
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

  // ── V3 adapters ───────────────────────────────────────────────────────────
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

  // ── V4 adapters ───────────────────────────────────────────────────────────
  if (adapterName === "PANCAKE_V4" || adapterName === "UNISWAP_V4") {
    const rawPath = body["path"];
    const rawFees = body["fees"];
    const rawTickSpacings = body["tickSpacing"];
    const rawHooks        = body["hooks"];

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

    const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Hex;

    if (hopCount === 1) {
      const fee        = fees[0]!;
      const tickSpacing = tickSpacings[0] || defaultTickSpacing(fee);
      const hooks      = hooksArr[0] ?? ZERO_ADDR;
      return encodeV4SingleHopAdapterData(tokenIn, tokenOut, fee, tickSpacing, hooks, "0x", deadline);
    } else {
      return encodeV4MultiHopAdapterData(tokens, fees, tickSpacings, hooksArr, deadline);
    }
  }

  // Should never be reached — requireAdapter() validates adapter names
  throw new BadRequestException(`Unknown adapter: ${adapterName}`);
}

// ─── Batch helpers ────────────────────────────────────────────────────────────

function parseSteps(raw: unknown, prefix: string): SwapStep[] {
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

function validatePathContinuity(steps: SwapStep[]): void {
  for (let i = 0; i < steps.length - 1; i++) {
    if (steps[i]!.tokenOut.toLowerCase() !== steps[i + 1]!.tokenIn.toLowerCase()) {
      throw new BadRequestException(
        `steps[${i}].tokenOut (${steps[i]!.tokenOut}) must equal steps[${i + 1}].tokenIn (${steps[i + 1]!.tokenIn})`,
      );
    }
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class MetaTxService {

  /**
   * GET /dex/quote
   * On-chain quote simulation — returns expected output before building swap calldata.
   *
   * Supported adapters:
   *   PANCAKE_V2, UNISWAP_V2  — calls router.getAmountsOut()
   *   PANCAKE_V3, UNISWAP_V3  — calls QuoterV2.quoteExactInput()
   *   ONEMEME_BC              — calls BondingCurve.getAmountOut / getAmountOutSell
   *   FOURMEME                — calls TokenManagerHelper3.tryBuy / trySell
   *   FLAPSH                  — calls Portal.previewBuy / previewSell
   *   PANCAKE_V4, UNISWAP_V4  — calls V4 Quoter (single-hop and multi-hop)
   *
   * Query params: adapter, tokenIn, amountIn, tokenOut, path? (comma-separated), fees? (comma-separated), slippage? (bps, default 100)
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

    const slippageBps = BigInt(query["slippage"] ?? "100");
    if (slippageBps < 0n || slippageBps > 5000n) {
      throw new BadRequestException("slippage must be between 0 and 5000 basis points");
    }

    // Parse optional path and fees from comma-separated query params
    const rawPath        = query["path"]?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
    const rawFees        = query["fees"]?.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) ?? [];
    // V4: tickSpacing and hooks are per-hop arrays (comma-separated); 0 = auto-derive from fee
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
        // Determine side: if tokenIn is WBNB → buy, else → sell
        const WBNB = WBNB_BSC;
        const isBuy = tokenIn.toLowerCase() === WBNB;
        const token = isBuy ? tokenOut : tokenIn;
        if (isBuy) {
          const r  = await quoteBcBuy(token, amountIn);
          amountOut = r.amountOut;
          fee       = r.fee;
        } else {
          const r  = await quoteBcSell(token, amountIn);
          amountOut = r.amountOut;
          fee       = r.fee;
        }
        quotedBy = "OneMEME BondingCurve";

      } else if (adapter === "FOURMEME") {
        const WBNB = WBNB_BSC;
        const isBuy = tokenIn.toLowerCase() === WBNB;
        const token = isBuy ? tokenOut : tokenIn;
        if (isBuy) {
          const r = await quoteFourMemeBuy(token, amountIn);
          amountOut = r.amountOut;
          fee       = r.fee;
        } else {
          const r = await quoteFourMemeSell(token, amountIn);
          amountOut = r.amountOut;
          fee       = r.fee;
        }
        quotedBy = "FourMEME TokenManagerHelper3";

      } else if (adapter === "FLAPSH") {
        const WBNB = WBNB_BSC;
        const isBuy = tokenIn.toLowerCase() === WBNB;
        const token = isBuy ? tokenOut : tokenIn;
        if (isBuy) {
          amountOut = await quoteFlapShBuy(token, amountIn);
        } else {
          amountOut = await quoteFlapShSell(token, amountIn);
        }
        quotedBy = "Flap.SH Portal";

      } else if (adapter === "PANCAKE_V4" || adapter === "UNISWAP_V4") {
        // V4: each hop needs a fee tier; tickSpacing auto-derived, hooks default zero address.
        const hopCount = path.length - 1;
        if (rawFees.length !== hopCount) {
          throw new BadRequestException(
            `V4 quote requires ${hopCount} fee tier(s) for ${path.length} tokens — ` +
            `provide via ?fees=3000 (single-hop) or ?fees=500,3000 (multi-hop)`,
          );
        }

        // Validate any explicitly provided hooks addresses
        rawHooksArr.forEach((h, i) => {
          if (!isAddress(h)) throw new BadRequestException(`hooks[${i}] is not a valid EVM address`);
        });

        const label = adapter === "PANCAKE_V4" ? "PancakeSwap V4 Quoter" : "Uniswap V4 Quoter";

        if (hopCount === 1) {
          // Single-hop: use quoteExactInputSingle with a PoolKey
          const fee   = rawFees[0]!;
          const ts    = rawTickSpacings[0] || defaultTickSpacing(fee);
          const hooks = (rawHooksArr[0] ?? "0x0000000000000000000000000000000000000000") as Hex;
          amountOut   = await quoteV4(adapter, tokenIn, tokenOut, amountIn, fee, ts, hooks);
        } else {
          // Multi-hop: use quoteExactInput with PathKey[]
          amountOut = await quoteV4Multi(
            adapter, path, amountIn, rawFees, rawTickSpacings, rawHooksArr as Hex[],
          );
        }
        quotedBy = label;

      } else {
        // requireAdapter() guards against unknown adapters; this branch is unreachable
        throw new BadRequestException(`On-chain quote is not supported for ${adapter}.`);
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) throw err;
      const msg = String(err);
      // RPC node errors / timeouts are infrastructure failures — surface as 503
      if (
        msg.includes("not configured") ||
        msg.includes("timeout") || msg.includes("TIMEOUT") ||
        msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") ||
        msg.includes("fetch failed")
      ) {
        throw new ServiceUnavailableException(`Quote unavailable: ${msg}`);
      }
      throw new BadRequestException(`Quote simulation failed: ${msg}`);
    }

    // Aggregator 1% fee (taken from amountIn by the contract — informational)
    const aggregatorFee = amountIn / 100n;

    // Slippage-adjusted minimum output
    const minOut = (amountOut * (10_000n - slippageBps)) / 10_000n;

    const isV4     = adapter === "PANCAKE_V4" || adapter === "UNISWAP_V4";
    const ZERO     = "0x0000000000000000000000000000000000000000";
    const hopCount = path.length - 1;

    return {
      data: {
        adapter,
        tokenIn:       nativeIn  ? NATIVE_BNB : tokenIn,
        tokenOut:      nativeOut ? NATIVE_BNB : tokenOut,
        nativeIn,
        nativeOut,
        // nativeIn: caller must send msg.value = amountIn
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
        // V4-specific: per-hop arrays (null for non-V4)
        tickSpacing:   isV4
          ? rawFees.map((f, i) => rawTickSpacings[i] || defaultTickSpacing(f))
          : null,
        hooks:         isV4
          ? Array.from({ length: hopCount }, (_, i) => rawHooksArr[i] ?? ZERO)
          : null,
      },
    };
  }

  /**
   * POST /dex/swap
   * Builds calldata for a direct (non-gasless) OneMEMEAggregator.swap() call.
   * The user broadcasts the transaction themselves — no relayer involved.
   *
   * Body:
   *   adapter      — adapter name (PANCAKE_V2, ONEMEME_BC, etc.)
   *   tokenIn      — input token address
   *   amountIn     — gross input amount in wei (string)
   *   tokenOut     — output token address
   *   minOut       — minimum acceptable output in wei (string)
   *   to           — recipient address
   *   deadline     — unix timestamp (seconds)
   *   path?        — (V2/V3) ordered token address array
   *   fees?        — (V3 only) fee tier per hop
   *   adapterData? — (V4) raw hex adapterData
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

    const nativeIn  = isNative(rawTokenIn);
    const nativeOut = isNative(rawTokenOut);
    const tokenIn   = toWbnbIfNative(rawTokenIn);
    const tokenOut  = toWbnbIfNative(rawTokenOut);

    const adapterId   = ADAPTER_IDS[adapter];
    const adapterData = buildAdapterData(adapter, tokenIn, tokenOut, body, deadline);

    const feeEstimate = amountIn / 100n;
    const netAmountIn = amountIn - feeEstimate;

    const calldata = buildSwapCalldata(
      adapterId, tokenIn, amountIn, tokenOut, minOut, to, deadline, adapterData,
    );

    return {
      data: {
        to:          aggregatorAddress(),
        calldata,
        // nativeIn: caller must send this as msg.value; nativeOut: WBNB arrives, caller unwraps
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
   * POST /dex/metatx/digest
   * Computes the EIP-712 digest the user must sign for a gasless meta-transaction.
   * Also returns the current nonce and MetaTxOrder struct for convenience.
   *
   * The caller signs `digest` with their private key and passes the signature
   * to POST /dex/metatx/relay.
   *
   * Body:
   *   user         — signer address
   *   adapter      — adapter name
   *   tokenIn      — input token address
   *   grossAmountIn — total amount the user approves (before relayer fee)
   *   tokenOut     — output token address
   *   minUserOut   — minimum tokens the user must receive
   *   recipient    — address that receives tokenOut
   *   deadline     — meta-tx deadline (unix seconds, for the meta-tx layer)
   *   swapDeadline — inner swap deadline (unix seconds, for the adapter)
   *   relayerFee   — BNB fee paid to the relayer (subtracted from grossAmountIn)
   *   path?        — (V2/V3) token path
   *   fees?        — (V3) fee tiers
   *   adapterData? — (V4) raw hex
   */
  async buildDigest(body: Record<string, unknown>) {
    const user          = requireAddress(body["user"],      "user");
    const adapter       = requireAdapter(body["adapter"]);
    const tokenIn       = requireAddress(body["tokenIn"],   "tokenIn");
    const tokenOut      = requireAddress(body["tokenOut"],  "tokenOut");
    const grossAmountIn = requireBigInt(body["grossAmountIn"], "grossAmountIn");
    const minUserOut    = requireBigInt(body["minUserOut"],    "minUserOut");
    const recipient     = requireAddress(body["recipient"], "recipient");
    const deadline      = requireBigInt(body["deadline"],   "deadline");
    const swapDeadline  = requireBigInt(body["swapDeadline"], "swapDeadline");
    const relayerFee    = requireBigInt(body["relayerFee"], "relayerFee");

    if (grossAmountIn === 0n) throw new BadRequestException("grossAmountIn must be greater than 0");
    if (relayerFee >= grossAmountIn) throw new BadRequestException("relayerFee must be less than grossAmountIn");

    const adapterId   = ADAPTER_IDS[adapter];
    // Use swapDeadline as the inner-swap deadline passed into adapter data
    const adapterData = buildAdapterData(adapter, tokenIn, tokenOut, body, swapDeadline);

    let nonce: bigint;
    try {
      nonce = await getUserNonce(user);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("METATX_ADDRESS")) {
        throw new ServiceUnavailableException("METATX_ADDRESS is not configured");
      }
      throw err;
    }

    const order: MetaTxOrder = {
      user,
      nonce,
      deadline,
      adapterId,
      tokenIn,
      grossAmountIn,
      tokenOut,
      minUserOut,
      recipient,
      swapDeadline,
      adapterData,
      relayerFee,
    };

    let digest: Hex;
    try {
      digest = await getOrderDigest(order);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("METATX_ADDRESS")) {
        throw new ServiceUnavailableException("METATX_ADDRESS is not configured");
      }
      throw err;
    }

    return {
      data: {
        digest,
        metaTxContract: metaTxAddress(),
        order: {
          ...order,
          nonce:         order.nonce.toString(),
          deadline:      order.deadline.toString(),
          grossAmountIn: order.grossAmountIn.toString(),
          minUserOut:    order.minUserOut.toString(),
          swapDeadline:  order.swapDeadline.toString(),
          relayerFee:    order.relayerFee.toString(),
        },
        // Net amounts informational — aggregator takes 1% on top
        aggregatorFeeEstimate: (grossAmountIn / 100n).toString(),
      },
    };
  }

  /**
   * POST /dex/metatx/relay
   * Submits a signed MetaTxOrder on-chain via the RELAYER_PRIVATE_KEY account.
   * The relayer pays gas; the user pays relayerFee from their token balance.
   *
   * Body:
   *   order      — MetaTxOrder object (same shape returned by /dex/metatx/digest)
   *   sig        — EIP-712 signature hex from the user (over the digest)
   *   permitType — 0 (NONE) | 1 (EIP-2612) | 2 (Permit2), default 0
   *   permitData — hex-encoded permit calldata (required for permitType 1 or 2)
   */
  async relay(body: Record<string, unknown>) {
    if (!process.env.RELAYER_PRIVATE_KEY) {
      throw new BadRequestException("Meta-tx relay is not enabled on this node (RELAYER_PRIVATE_KEY not set)");
    }

    const rawOrder = body["order"];
    if (!rawOrder || typeof rawOrder !== "object") {
      throw new BadRequestException("order is required");
    }
    const o = rawOrder as Record<string, unknown>;

    const order: MetaTxOrder = {
      user:          requireAddress(o["user"],       "order.user"),
      nonce:         requireBigInt(o["nonce"],        "order.nonce"),
      deadline:      requireBigInt(o["deadline"],     "order.deadline"),
      adapterId:     (() => {
        const v = o["adapterId"];
        if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
          throw new BadRequestException("order.adapterId must be a 32-byte hex string");
        }
        return v as Hex;
      })(),
      tokenIn:       requireAddress(o["tokenIn"],     "order.tokenIn"),
      grossAmountIn: requireBigInt(o["grossAmountIn"], "order.grossAmountIn"),
      tokenOut:      requireAddress(o["tokenOut"],    "order.tokenOut"),
      minUserOut:    requireBigInt(o["minUserOut"],   "order.minUserOut"),
      recipient:     requireAddress(o["recipient"],   "order.recipient"),
      swapDeadline:  requireBigInt(o["swapDeadline"], "order.swapDeadline"),
      adapterData:   (() => {
        const v = o["adapterData"];
        if (typeof v !== "string" || !/^0x[0-9a-fA-F]*$/.test(v)) {
          throw new BadRequestException("order.adapterData must be a hex string");
        }
        return v as Hex;
      })(),
      relayerFee:    requireBigInt(o["relayerFee"],   "order.relayerFee"),
    };

    const sig = body["sig"];
    if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) {
      throw new BadRequestException("sig must be a 65-byte hex signature (0x + 130 hex chars)");
    }

    const permitType = parsePermitType(body["permitType"]);
    const rawPermitData = body["permitData"] ?? "0x";
    if (typeof rawPermitData !== "string" || !/^0x[0-9a-fA-F]*$/.test(rawPermitData)) {
      throw new BadRequestException("permitData must be a hex string");
    }

    const permit: PermitData = { permitType, data: rawPermitData as Hex };

    // Verify deadline not expired
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (order.deadline < nowSec) {
      throw new BadRequestException("Meta-tx deadline has expired");
    }

    let txHash: Hex;
    try {
      txHash = await relayMetaTx(order, sig as Hex, permit);
    } catch (err: unknown) {
      const msg = String(err);
      // Distinguish on-chain reverts (user error) from infra failures
      if (
        msg.includes("timeout") || msg.includes("TIMEOUT") ||
        msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") ||
        msg.includes("fetch failed")
      ) {
        throw new ServiceUnavailableException(`Relay RPC unavailable: ${msg}`);
      }
      // Contract reverts and invalid signature errors are user-facing 400s
      throw new BadRequestException(`Relay failed: ${msg}`);
    }

    return {
      data: {
        txHash,
        status: "submitted",
      },
    };
  }

  /**
   * GET /dex/route
   * Returns a routed swap plan — single-step for direct pairs, two-step when a bridge
   * hop is needed (e.g. USDC → WBNB → 1MEME token).
   *
   * Bridge logic: if the target adapter is a bonding-curve adapter (ONEMEME_BC, FOURMEME,
   * FLAPSH) and tokenIn is not WBNB, we prepend a PANCAKE_V3 (fee 500) bridge step,
   * falling back to PANCAKE_V2.
   *
   * Each step includes pre-encoded adapterData ready to pass into POST /dex/batch-swap.
   */
  async getRoute(query: Record<string, string | undefined>) {
    const adapter      = requireAdapter(query["adapter"]);
    const rawTokenIn   = requireAddress(query["tokenIn"],  "tokenIn");
    const rawTokenOut  = requireAddress(query["tokenOut"], "tokenOut");
    const amountIn     = requireBigInt(query["amountIn"],  "amountIn");

    if (amountIn === 0n) throw new BadRequestException("amountIn must be greater than 0");
    if (isNative(rawTokenIn) && isNative(rawTokenOut)) {
      throw new BadRequestException("tokenIn and tokenOut cannot both be native BNB");
    }

    const nativeIn  = isNative(rawTokenIn);
    const nativeOut = isNative(rawTokenOut);
    const tokenIn   = toWbnbIfNative(rawTokenIn);
    const tokenOut  = toWbnbIfNative(rawTokenOut);

    const slippageBps = BigInt(query["slippage"] ?? "100");
    if (slippageBps > 5000n) {
      throw new BadRequestException("slippage must be between 0 and 5000 basis points");
    }

    const nowSec   = BigInt(Math.floor(Date.now() / 1000));
    const deadline = nowSec + 1800n;
    const WBNB     = WBNB_BSC as `0x${string}`;

    const isBcAdapter  = adapter === "ONEMEME_BC" || adapter === "FOURMEME" || adapter === "FLAPSH";
    const needsBridge  = isBcAdapter && tokenIn.toLowerCase() !== WBNB_BSC;
    const aggregatorFee = amountIn / 100n;

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
          const r     = isBuy ? await quoteBcBuy(token, amountIn) : await quoteBcSell(token, amountIn);
          amountOut   = r.amountOut;
        } else if (adapter === "FOURMEME") {
          const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
          const token = isBuy ? tokenOut : tokenIn;
          const r     = isBuy ? await quoteFourMemeBuy(token, amountIn) : await quoteFourMemeSell(token, amountIn);
          amountOut   = r.amountOut;
        } else if (adapter === "FLAPSH") {
          const isBuy = tokenIn.toLowerCase() === WBNB_BSC;
          const token = isBuy ? tokenOut : tokenIn;
          amountOut   = isBuy ? await quoteFlapShBuy(token, amountIn) : await quoteFlapShSell(token, amountIn);
        } else if (adapter === "PANCAKE_V2" || adapter === "UNISWAP_V2") {
          amountOut = await quoteV2(adapter, [tokenIn, tokenOut], amountIn);
        } else if (adapter === "PANCAKE_V3" || adapter === "UNISWAP_V3") {
          const rawFees = query["fees"]?.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) ?? [];
          if (rawFees.length === 0) throw new BadRequestException("V3 route requires ?fees= query param (e.g. ?fees=500)");
          amountOut = await quoteV3(adapter, buildV3PackedPath([tokenIn, tokenOut], rawFees), amountIn);
        } else {
          throw new BadRequestException("V4 routing: use GET /dex/quote and build batch steps manually");
        }
      } catch (err) { wrapQuoteError(err, "Quote"); }

      const minOut      = (amountOut! * (10_000n - slippageBps)) / 10_000n;
      const rawFees     = query["fees"]?.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) ?? [];
      const adapterBody = rawFees.length ? { fees: rawFees } : {};
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
          }],
          amountIn:      amountIn.toString(),
          minFinalOut:   minOut.toString(),
          aggregatorFee: aggregatorFee.toString(),
          slippageBps:   slippageBps.toString(),
        },
      };
    }

    // ── Two-step bridge route: tokenIn → WBNB → tokenOut ─────────────────────
    let bridgeAmountOut: bigint;
    let bridgeAdapter:   "PANCAKE_V3" | "PANCAKE_V2";
    let step1Data:       `0x${string}`;

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

    const finalMinOut  = (finalAmountOut! * (10_000n - slippageBps)) / 10_000n;
    const step2Data    = buildAdapterData(adapter, WBNB, tokenOut, {}, deadline);

    return {
      data: {
        singleStep: false,
        nativeIn,
        nativeOut,
        value:      nativeIn ? amountIn.toString() : "0",
        steps: [
          {
            adapter:   bridgeAdapter!,
            adapterId: ADAPTER_IDS[bridgeAdapter!],
            tokenIn,
            tokenOut:  WBNB,
            amountIn:  amountIn.toString(),
            amountOut: bridgeAmountOut!.toString(),
            minOut:    bridgeMinOut.toString(),
            adapterData: step1Data!,
          },
          {
            adapter,
            adapterId: ADAPTER_IDS[adapter],
            tokenIn:   WBNB,
            tokenOut,
            amountIn:  wbnbIn.toString(),
            amountOut: finalAmountOut!.toString(),
            minOut:    finalMinOut.toString(),
            adapterData: step2Data,
          },
        ],
        amountIn:      amountIn.toString(),
        minFinalOut:   finalMinOut.toString(),
        aggregatorFee: aggregatorFee.toString(),
        slippageBps:   slippageBps.toString(),
      },
    };
  }

  /**
   * POST /dex/batch-swap
   * Builds ABI-encoded calldata for OneMEMEAggregator.batchSwap().
   * Use steps returned by GET /dex/route (or build manually from /dex/quote outputs).
   *
   * Body: { steps[], amountIn, minFinalOut, to, deadline }
   * Returns: { to, calldata, steps, amountIn, feeEstimate, minFinalOut, deadline }
   */
  async buildBatchSwap(body: Record<string, unknown>) {
    const steps       = parseSteps(body["steps"], "steps");
    const amountIn    = requireBigInt(body["amountIn"],    "amountIn");
    const minFinalOut = requireBigInt(body["minFinalOut"], "minFinalOut");
    const to          = requireAddress(body["to"],         "to");
    const deadline    = requireBigInt(body["deadline"],    "deadline");

    if (amountIn === 0n) throw new BadRequestException("amountIn must be greater than 0");

    // Normalize native BNB in first/last step; inner hops must already use WBNB
    const nativeIn  = isNative(steps[0]!.tokenIn);
    const nativeOut = isNative(steps[steps.length - 1]!.tokenOut);
    if (nativeIn)  steps[0]!.tokenIn                     = WBNB_BSC as Hex;
    if (nativeOut) steps[steps.length - 1]!.tokenOut     = WBNB_BSC as Hex;

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

  /**
   * POST /dex/metatx/batch-digest
   * Computes the EIP-712 digest the user must sign for a gasless multi-hop swap.
   *
   * Flow:
   *   1. GET /dex/route → get steps[]
   *   2. POST /dex/metatx/batch-digest → get digest + BatchMetaTxOrder
   *   3. User signs digest
   *   4. POST /dex/metatx/batch-relay with { order, sig }
   *
   * Body: { user, steps[], grossAmountIn, minFinalOut, recipient, deadline, swapDeadline, relayerFee }
   */
  async buildBatchDigest(body: Record<string, unknown>) {
    const user          = requireAddress(body["user"],          "user");
    const grossAmountIn = requireBigInt(body["grossAmountIn"],  "grossAmountIn");
    const minFinalOut   = requireBigInt(body["minFinalOut"],    "minFinalOut");
    const recipient     = requireAddress(body["recipient"],     "recipient");
    const deadline      = requireBigInt(body["deadline"],       "deadline");
    const swapDeadline  = requireBigInt(body["swapDeadline"],   "swapDeadline");
    const relayerFee    = requireBigInt(body["relayerFee"],     "relayerFee");

    if (grossAmountIn === 0n) throw new BadRequestException("grossAmountIn must be greater than 0");
    if (relayerFee >= grossAmountIn) throw new BadRequestException("relayerFee must be less than grossAmountIn");

    const steps = parseSteps(body["steps"], "steps");
    if (isNative(steps[0]!.tokenIn))                     steps[0]!.tokenIn                 = WBNB_BSC as Hex;
    if (isNative(steps[steps.length - 1]!.tokenOut))     steps[steps.length - 1]!.tokenOut = WBNB_BSC as Hex;
    validatePathContinuity(steps);

    let nonce: bigint;
    try {
      nonce = await getUserNonce(user);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("METATX_ADDRESS")) throw new ServiceUnavailableException("METATX_ADDRESS is not configured");
      throw err;
    }

    const order: BatchMetaTxOrder = {
      user, nonce, deadline, steps, grossAmountIn, minFinalOut, recipient, swapDeadline, relayerFee,
    };

    let digest: `0x${string}`;
    try {
      digest = await getBatchOrderDigest(order);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("METATX_ADDRESS")) throw new ServiceUnavailableException("METATX_ADDRESS is not configured");
      throw err;
    }

    return {
      data: {
        digest,
        metaTxContract: metaTxAddress(),
        order: {
          ...order,
          nonce:         order.nonce.toString(),
          deadline:      order.deadline.toString(),
          grossAmountIn: order.grossAmountIn.toString(),
          minFinalOut:   order.minFinalOut.toString(),
          swapDeadline:  order.swapDeadline.toString(),
          relayerFee:    order.relayerFee.toString(),
          steps:         order.steps.map(s => ({ ...s, minOut: s.minOut.toString() })),
        },
        aggregatorFeeEstimate: (grossAmountIn / 100n).toString(),
      },
    };
  }

  /**
   * POST /dex/metatx/batch-relay
   * Submits a signed BatchMetaTxOrder to OneMEMEMetaTx.batchExecuteMetaTx().
   * The RELAYER_PRIVATE_KEY account pays gas.
   *
   * Body: { order: BatchMetaTxOrder, sig: "0x...", permitType?: 0|1|2, permitData?: "0x..." }
   */
  async relayBatch(body: Record<string, unknown>) {
    if (!process.env.RELAYER_PRIVATE_KEY) {
      throw new BadRequestException("Meta-tx relay is not enabled on this node (RELAYER_PRIVATE_KEY not set)");
    }

    const rawOrder = body["order"];
    if (!rawOrder || typeof rawOrder !== "object") throw new BadRequestException("order is required");
    const o = rawOrder as Record<string, unknown>;

    const steps = parseSteps(o["steps"], "order.steps");
    if (isNative(steps[0]!.tokenIn))                     steps[0]!.tokenIn                 = WBNB_BSC as Hex;
    if (isNative(steps[steps.length - 1]!.tokenOut))     steps[steps.length - 1]!.tokenOut = WBNB_BSC as Hex;
    validatePathContinuity(steps);

    const order: BatchMetaTxOrder = {
      user:          requireAddress(o["user"],          "order.user"),
      nonce:         requireBigInt(o["nonce"],          "order.nonce"),
      deadline:      requireBigInt(o["deadline"],       "order.deadline"),
      steps,
      grossAmountIn: requireBigInt(o["grossAmountIn"],  "order.grossAmountIn"),
      minFinalOut:   requireBigInt(o["minFinalOut"],    "order.minFinalOut"),
      recipient:     requireAddress(o["recipient"],     "order.recipient"),
      swapDeadline:  requireBigInt(o["swapDeadline"],   "order.swapDeadline"),
      relayerFee:    requireBigInt(o["relayerFee"],     "order.relayerFee"),
    };

    const sig = body["sig"];
    if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) {
      throw new BadRequestException("sig must be a 65-byte hex signature (0x + 130 hex chars)");
    }

    const permitType    = parsePermitType(body["permitType"]);
    const rawPermitData = body["permitData"] ?? "0x";
    if (typeof rawPermitData !== "string" || !/^0x[0-9a-fA-F]*$/.test(rawPermitData)) {
      throw new BadRequestException("permitData must be a hex string");
    }

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (order.deadline < nowSec) throw new BadRequestException("Meta-tx deadline has expired");

    let txHash: `0x${string}`;
    try {
      txHash = await relayBatchMetaTx(order, sig as `0x${string}`, {
        permitType,
        data: rawPermitData as `0x${string}`,
      });
    } catch (err: unknown) {
      const msg = String(err);
      if (
        msg.includes("timeout") || msg.includes("TIMEOUT") ||
        msg.includes("ECONNREFUSED") || msg.includes("fetch failed")
      ) throw new ServiceUnavailableException(`Relay RPC unavailable: ${msg}`);
      throw new BadRequestException(`Relay failed: ${msg}`);
    }

    return { data: { txHash, status: "submitted" } };
  }

  /**
   * GET /dex/metatx/nonce/:user
   * Returns the current nonce for a user on the MetaTx contract.
   */
  async getNonce(user: string) {
    if (!isAddress(user)) throw new BadRequestException("Invalid user address");
    const addr = normalizeAddress(user) as Hex;

    let nonce: bigint;
    try {
      nonce = await getUserNonce(addr);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("METATX_ADDRESS")) throw new BadRequestException("METATX_ADDRESS is not configured");
      throw err;
    }

    return { data: { user: addr, nonce: nonce.toString() } };
  }
}
