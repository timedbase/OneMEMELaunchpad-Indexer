import { Injectable, BadRequestException } from "@nestjs/common";
import {
  ADAPTER_IDS,
  ADAPTER_NAMES,
  AdapterName,
  MetaTxOrder,
  PermitData,
  encodeV2Path,
  encodeV3Path,
  encodeBcAdapterData,
  buildSwapCalldata,
  buildV3PackedPath,
  quoteV2,
  quoteV3,
  quoteV4,
  quoteBcBuy,
  quoteBcSell,
  defaultTickSpacing,
  getUserNonce,
  getOrderDigest,
  relayMetaTx,
  aggregatorAddress,
  metaTxAddress,
} from "./dex-rpc";
import type { Hex } from "viem";
import { isAddress, normalizeAddress } from "../../helpers";

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
 * Builds the ABI-encoded adapterData bytes from the request body.
 *
 * Body shape per adapter category:
 *
 *   Bonding-curve (ONEMEME_BC, FOURMEME, FLAPSH):
 *     {} — no extra fields required
 *
 *   V2 (PANCAKE_V2, UNISWAP_V2):
 *     { path: ["0xTokenA", "0xTokenB", ...] }
 *     Omitting path defaults to direct [tokenIn, tokenOut] single-hop.
 *
 *   V3 (PANCAKE_V3, UNISWAP_V3):
 *     { path: ["0xTokenA", "0xTokenB"], fees: [500] }
 *     fees[i] is the fee tier between path[i] and path[i+1] (in hundredths of a bip).
 */
function buildAdapterData(
  adapterName: AdapterName,
  tokenIn:     Hex,
  tokenOut:    Hex,
  body:        Record<string, unknown>,
): Hex {
  const isBc  = adapterName === "ONEMEME_BC" || adapterName === "FOURMEME" || adapterName === "FLAPSH";
  const isV2  = adapterName === "PANCAKE_V2" || adapterName === "UNISWAP_V2";
  const isV3  = adapterName === "PANCAKE_V3" || adapterName === "UNISWAP_V3";

  if (isBc) {
    return encodeBcAdapterData();
  }

  if (isV2) {
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
    return encodeV2Path(path);
  }

  if (isV3) {
    const rawPath = body["path"];
    const rawFees = body["fees"];

    let tokens: Hex[];
    let fees:   number[];

    if (Array.isArray(rawPath) && rawPath.length >= 2) {
      rawPath.forEach((p, i) => {
        if (!isAddress(String(p))) throw new BadRequestException(`path[${i}] is not a valid address`);
      });
      tokens = rawPath.map(p => normalizeAddress(String(p)) as Hex);
    } else {
      tokens = [tokenIn, tokenOut];
    }

    if (Array.isArray(rawFees) && rawFees.length === tokens.length - 1) {
      fees = rawFees.map((f, i) => {
        const n = parseInt(String(f), 10);
        if (isNaN(n) || n <= 0) throw new BadRequestException(`fees[${i}] must be a positive integer (e.g. 500 = 0.05%)`);
        return n;
      });
    } else if (tokens.length === 2 && !rawFees) {
      throw new BadRequestException("V3 swaps require a fees array (e.g. [500] for 0.05%)");
    } else {
      throw new BadRequestException(`V3 fees must have ${tokens.length - 1} element(s) for ${tokens.length} tokens`);
    }

    return encodeV3Path(tokens, fees);
  }

  // V4 adapters: adapterData format is DEX-specific and not yet standardised here.
  // Pass raw adapterData hex if provided, otherwise fail gracefully.
  const rawData = body["adapterData"];
  if (typeof rawData === "string" && /^0x[0-9a-fA-F]*$/.test(rawData)) {
    return rawData as Hex;
  }
  throw new BadRequestException(
    `${adapterName} requires raw adapterData hex. V4 adapter encoding is not yet auto-built.`,
  );
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
   *   FOURMEME, FLAPSH        — not yet supported (no standard quoter interface)
   *   PANCAKE_V4, UNISWAP_V4  — not yet supported
   *
   * Query params: adapter, tokenIn, amountIn, tokenOut, path? (comma-separated), fees? (comma-separated), slippage? (bps, default 100)
   */
  async getQuote(query: Record<string, string | undefined>) {
    const adapter    = requireAdapter(query["adapter"]);
    const tokenIn    = requireAddress(query["tokenIn"],  "tokenIn");
    const tokenOut   = requireAddress(query["tokenOut"], "tokenOut");
    const amountIn   = requireBigInt(query["amountIn"],  "amountIn");

    if (amountIn === 0n) throw new BadRequestException("amountIn must be greater than 0");

    const slippageBps = BigInt(query["slippage"] ?? "100");
    if (slippageBps < 0n || slippageBps > 5000n) {
      throw new BadRequestException("slippage must be between 0 and 5000 basis points");
    }

    // Parse optional path and fees from comma-separated query params
    const rawPath       = query["path"]?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
    const rawFees       = query["fees"]?.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) ?? [];
    const rawTickSpacing = query["tickSpacing"] ? parseInt(query["tickSpacing"], 10) : null;
    const rawHooks       = query["hooks"] ?? null;

    const path: Hex[] = rawPath.length >= 2
      ? rawPath.map((p, i) => {
          if (!isAddress(p)) throw new BadRequestException(`path[${i}] is not a valid address`);
          return normalizeAddress(p) as Hex;
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
        const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
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

      } else if (adapter === "PANCAKE_V4" || adapter === "UNISWAP_V4") {
        // V4 uses a singleton PoolManager — quotes require a PoolKey (fee + tickSpacing + hooks)
        // rather than a simple path. Only single-hop supported.
        const fee = rawFees[0];
        if (!fee) {
          throw new BadRequestException(
            "V4 quote requires ?fees=<feeTier> (e.g. 3000 for 0.3%). " +
            "Only single-hop V4 quotes are supported.",
          );
        }
        const hooks = (rawHooks ?? "0x0000000000000000000000000000000000000000") as Hex;

        if (rawHooks && !isAddress(rawHooks)) {
          throw new BadRequestException("hooks must be a valid EVM address");
        }

        // Auto-derive tickSpacing from fee if not provided
        const ts = rawTickSpacing || defaultTickSpacing(fee);

        amountOut = await quoteV4(adapter, tokenIn, tokenOut, amountIn, fee, ts, hooks);
        quotedBy  = adapter === "PANCAKE_V4" ? "PancakeSwap V4 Quoter" : "Uniswap V4 Quoter";

      } else {
        throw new BadRequestException(
          `On-chain quote is not supported for ${adapter}.`,
        );
      }
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("not configured") || msg.includes("BadRequestException")) throw err;
      // Surface RPC errors clearly
      throw new BadRequestException(`Quote simulation failed: ${msg}`);
    }

    // Aggregator 1% fee (taken from amountIn by the contract — informational)
    const aggregatorFee = amountIn / 100n;

    // Slippage-adjusted minimum output
    const minOut = (amountOut * (10_000n - slippageBps)) / 10_000n;

    const isV4 = adapter === "PANCAKE_V4" || adapter === "UNISWAP_V4";

    return {
      data: {
        adapter,
        tokenIn,
        tokenOut,
        amountIn:       amountIn.toString(),
        amountOut:      amountOut.toString(),
        minOut:         minOut.toString(),
        aggregatorFee:  aggregatorFee.toString(),
        bondingFee:     fee?.toString() ?? null,
        slippageBps:    slippageBps.toString(),
        quotedBy,
        path,
        fees:           rawFees.length ? rawFees : null,
        // V4-specific fields
        tickSpacing:    isV4 ? (rawTickSpacing || defaultTickSpacing(rawFees[0] ?? 3000)) : null,
        hooks:          isV4 ? (rawHooks ?? "0x0000000000000000000000000000000000000000") : null,
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
    const adapter    = requireAdapter(body["adapter"]);
    const tokenIn    = requireAddress(body["tokenIn"],  "tokenIn");
    const tokenOut   = requireAddress(body["tokenOut"], "tokenOut");
    const amountIn   = requireBigInt(body["amountIn"],  "amountIn");
    const minOut     = requireBigInt(body["minOut"],    "minOut");
    const to         = requireAddress(body["to"], "to");
    const deadline   = requireBigInt(body["deadline"], "deadline");

    if (amountIn === 0n) throw new BadRequestException("amountIn must be greater than 0");

    const adapterId  = ADAPTER_IDS[adapter];
    const adapterData = buildAdapterData(adapter, tokenIn, tokenOut, body);

    // 1% aggregator fee (informational — the contract deducts it)
    const feeEstimate = amountIn / 100n;
    const netAmountIn = amountIn - feeEstimate;

    const calldata = buildSwapCalldata(
      adapterId, tokenIn, amountIn, tokenOut, minOut, to, deadline, adapterData,
    );

    return {
      data: {
        to:          aggregatorAddress(),
        calldata,
        adapter,
        adapterId,
        tokenIn,
        tokenOut,
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
    const adapterData = buildAdapterData(adapter, tokenIn, tokenOut, body);

    let nonce: bigint;
    try {
      nonce = await getUserNonce(user);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("METATX_ADDRESS")) throw new BadRequestException("METATX_ADDRESS is not configured");
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
      if (msg.includes("METATX_ADDRESS")) throw new BadRequestException("METATX_ADDRESS is not configured");
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

    const txHash = await relayMetaTx(order, sig as Hex, permit);

    return {
      data: {
        txHash,
        status: "submitted",
        relayer: `${process.env.RELAYER_PRIVATE_KEY ? "configured" : "missing"}`,
      },
    };
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
