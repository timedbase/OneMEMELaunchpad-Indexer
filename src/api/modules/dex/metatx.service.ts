/**
 * MetaTx Service — gasless swap layer built on top of the DEX route layer.
 *
 * Responsible for:
 *   • EIP-712 digest computation for single and batch swap orders
 *   • On-chain relay via RELAYER_PRIVATE_KEY
 *   • Nonce management
 *
 * This service has no routing or quote logic. Route finding, quote simulation,
 * and calldata building belong to RouteService.
 */

import { Injectable, BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import {
  MetaTxOrder,
  PermitData,
  BatchMetaTxOrder,
  getUserNonce,
  getOrderDigest,
  getBatchOrderDigest,
  relayMetaTx,
  relayBatchMetaTx,
  verifyOrderSignature,
  verifyBatchOrderSignature,
  metaTxAddress,
  permit2Address,
  estimateRelayerFee,
  buildEip2612TypedData,
  buildPermit2TypedData,
  buildMetaTxTypedData,
  buildBatchMetaTxTypedData,
  detectPermitType,
  recoverOrderSigner,
} from "./dex-rpc";
import {
  parseSteps,
  validatePathContinuity,
  requireAddress,
  requireBigInt,
  isNative,
  toWbnbIfNative,
} from "./route.service";
import { isAddress, normalizeAddress } from "../../helpers";
import type { Hex } from "viem";

// ─── Constants ────────────────────────────────────────────────────────────────

const WBNB_BSC = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parsePermitType(val: unknown): 0 | 1 | 2 {
  const n = parseInt(String(val ?? "0"), 10);
  if (n !== 0 && n !== 1 && n !== 2) {
    throw new BadRequestException("permitType must be 0 (NONE), 1 (EIP-2612), or 2 (Permit2)");
  }
  return n as 0 | 1 | 2;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class MetaTxService {

  /**
   * GET /dex/metatx/nonce/:user
   * Returns the current nonce for a user on the OneMEMEMetaTx contract.
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

  /**
   * POST /dex/metatx/verify-sig
   * Debug endpoint: recovers the signer address from an order + signature
   * and compares it to order.user. Use this to diagnose signature failures.
   * Body: { order, sig }
   */
  async verifySig(body: Record<string, unknown>) {
    const rawOrder = body["order"];
    if (!rawOrder || typeof rawOrder !== "object") throw new BadRequestException("order is required");
    const o = rawOrder as Record<string, unknown>;

    const sig = body["sig"];
    if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) {
      throw new BadRequestException("sig must be a 65-byte hex signature (0x + 130 hex chars)");
    }

    // Minimal order parse — only fields needed for digest
    const order: MetaTxOrder = {
      user:          requireAddress(o["user"],         "order.user"),
      nonce:         requireBigInt(o["nonce"],          "order.nonce"),
      deadline:      requireBigInt(o["deadline"],       "order.deadline"),
      adapterId:     (() => { const v = o["adapterId"]; if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new BadRequestException("order.adapterId"); return v as Hex; })(),
      tokenIn:       requireAddress(o["tokenIn"],       "order.tokenIn"),
      grossAmountIn: requireBigInt(o["grossAmountIn"],  "order.grossAmountIn"),
      tokenOut:      requireAddress(o["tokenOut"],      "order.tokenOut"),
      minUserOut:    requireBigInt(o["minUserOut"],      "order.minUserOut"),
      recipient:     requireAddress(o["recipient"],     "order.recipient"),
      swapDeadline:  requireBigInt(o["swapDeadline"],   "order.swapDeadline"),
      adapterData:   (() => { const v = o["adapterData"] ?? "0x"; if (typeof v !== "string") throw new BadRequestException("order.adapterData"); return v as Hex; })(),
      relayerFee:    requireBigInt(o["relayerFee"],     "order.relayerFee"),
      relayerFeeTokenAmount: o["relayerFeeTokenAmount"] !== undefined ? requireBigInt(o["relayerFeeTokenAmount"], "order.relayerFeeTokenAmount") : 0n,
      relayerFeeAdapterId:   (() => { const v = o["relayerFeeAdapterId"] ?? "0x0000000000000000000000000000000000000000000000000000000000000000"; if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new BadRequestException("order.relayerFeeAdapterId"); return v as Hex; })(),
      relayerFeeAdapterData: (() => { const v = o["relayerFeeAdapterData"] ?? "0x"; if (typeof v !== "string") throw new BadRequestException("order.relayerFeeAdapterData"); return v as Hex; })(),
    };

    let recovered: string;
    let digest: string;
    try {
      const imp = await import("./dex-rpc");
      digest    = await imp.getOrderDigest(order);
      recovered = await recoverOrderSigner(order, sig as Hex);
    } catch (err) {
      throw new ServiceUnavailableException(`RPC error: ${String(err)}`);
    }

    return {
      data: {
        digest,
        recovered,
        expected:  order.user,
        match:     recovered.toLowerCase() === order.user.toLowerCase(),
        metaTxContract: metaTxAddress(),
      },
    };
  }

  /**
   * GET /dex/metatx/permit-type
   * Detects which permit mode is available for a token/owner pair and returns
   * the recommended permitType along with current on-chain allowance state.
   *
   * Query: { token, owner, amount }
   */
  async getPermitType(query: Record<string, string | undefined>) {
    const token  = requireAddress(query["token"],  "token");
    const owner  = requireAddress(query["owner"],  "owner");
    const amount = requireBigInt(query["amount"],  "amount");

    const result = await detectPermitType(token, owner, amount);

    return {
      data: {
        token,
        owner,
        amount:            amount.toString(),
        recommended:       result.recommended,
        supportsEip2612:   result.supportsEip2612,
        permit2:           permit2Address(),
        permit2Allowance:  result.permit2Allowance.toString(),
        permit2Ready:      result.permit2Ready,
        metaTxAddress:     metaTxAddress(),
        metaTxAllowance:   result.metaTxAllowance.toString(),
        metaTxReady:       result.metaTxReady,
        options: {
          0: { name: "pre-approve",  available: true,                    ready: result.metaTxReady  },
          1: { name: "eip-2612",     available: result.supportsEip2612,  ready: result.supportsEip2612 },
          2: { name: "permit2",      available: true,                    ready: result.permit2Ready },
        },
      },
    };
  }

  /**
   * GET /dex/metatx/permit-digest
   * Returns the EIP-712 typed data for an EIP-2612 permit signature.
   * The user signs this with eth_signTypedData_v4; the resulting (v, r, s)
   * are encoded as abi.encode(deadline, v, r, s) → permitData for /relay.
   *
   * Query: { token, owner, amount, deadline }
   */
  async buildPermitDigest(query: Record<string, string | undefined>) {
    const token    = requireAddress(query["token"],  "token");
    const owner    = requireAddress(query["owner"],  "owner");
    const amount   = requireBigInt(query["amount"],  "amount");
    const deadline = requireBigInt(query["deadline"], "deadline");

    let result: Awaited<ReturnType<typeof buildEip2612TypedData>>;
    try {
      result = await buildEip2612TypedData(token, owner, metaTxAddress(), amount, deadline);
    } catch (err) {
      throw new BadRequestException(
        `Token does not support EIP-2612 permit or RPC error: ${(err as Error).message}`,
      );
    }

    return {
      data: {
        permitType:   1,
        spender:      metaTxAddress(),
        ...result,
        note: "Sign typedData with eth_signTypedData_v4. Encode result as abi.encode(deadline, v, r, s) for the permitData field in /relay.",
      },
    };
  }

  /**
   * GET /dex/metatx/permit2-digest
   * Returns the EIP-712 typed data for a Permit2 PermitTransferFrom signature.
   * The user must have approved the Permit2 contract once (token.approve(permit2, max)).
   * Sign with eth_signTypedData_v4; encode as abi.encode(nonce, deadline, sig) → permitData.
   *
   * Query: { token, owner, amount, deadline, nonce? }
   */
  async buildPermit2Digest(query: Record<string, string | undefined>) {
    const token    = requireAddress(query["token"],  "token");
    const amount   = requireBigInt(query["amount"],  "amount");
    const deadline = requireBigInt(query["deadline"], "deadline");

    // Permit2 uses a random uint248 nonce (bitmap-based — any unused value works).
    // If the caller supplies one, use it; otherwise generate a random one.
    let nonce: bigint;
    if (query["nonce"] !== undefined) {
      nonce = requireBigInt(query["nonce"], "nonce");
    } else {
      // Random 128-bit nonce — collision probability is negligible.
      const rand = BigInt("0x" + Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, "0")).join(""));
      nonce = rand;
    }

    const result = await buildPermit2TypedData(token, metaTxAddress(), amount, nonce, deadline);

    return {
      data: {
        permitType:   2,
        permit2:      permit2Address(),
        spender:      metaTxAddress(),
        ...result,
        note: "Sign typedData with eth_signTypedData_v4. Encode result as abi.encode(nonce, deadline, signature) for the permitData field in /relay. Requires prior token.approve(permit2, type(uint256).max).",
      },
    };
  }

  /**
   * GET /dex/metatx/relayer-fee
   * Returns a suggested relayerFee (in BNB wei) the user should include in their
   * MetaTxOrder so the relayer at least breaks even on gas, plus a 30% premium.
   *
   * Query: { steps?, tokenOut? }
   *   steps    — number of swap steps (default 1)
   *   tokenOut — output token address; when ERC-20, also returns relayerFeeTokenAmount
   *              and the adapter details needed to convert that token to BNB for the relayer
   */
  async getRelayerFee(query: Record<string, string | undefined>) {
    const rawSteps = query["steps"] ?? "1";
    const steps    = parseInt(rawSteps, 10);
    if (isNaN(steps) || steps < 1 || steps > 10) {
      throw new BadRequestException("steps must be an integer between 1 and 10");
    }

    let tokenOut: Hex | undefined;
    if (query["tokenOut"]) {
      if (!isAddress(query["tokenOut"])) throw new BadRequestException("tokenOut must be a valid EVM address");
      tokenOut = normalizeAddress(query["tokenOut"]) as Hex;
    }

    const nowSec   = BigInt(Math.floor(Date.now() / 1000));
    const deadline = nowSec + 1800n;

    const {
      gasPrice, gasEstimate, relayerFee,
      relayerFeeTokenAmount, relayerFeeAdapterId, relayerFeeAdapterData,
    } = await estimateRelayerFee(steps, tokenOut, deadline);

    return {
      data: {
        steps,
        gasPrice:              gasPrice.toString(),
        gasEstimate:           gasEstimate.toString(),
        relayerFee:            relayerFee.toString(),
        relayerFeeTokenAmount: relayerFeeTokenAmount.toString(),
        relayerFeeAdapterId,
        relayerFeeAdapterData,
        premiumBps:            "3000",
      },
    };
  }

  /**
   * POST /dex/metatx/digest
   * Computes the EIP-712 digest the user must sign for a gasless single-hop swap.
   *
   * `adapterId` and `adapterData` come directly from the GET /dex/route response —
   * they are opaque to this endpoint. Use POST /dex/metatx/batch-digest for multi-hop.
   *
   * Body: { user, adapterId, adapterData, tokenIn, grossAmountIn, tokenOut, minUserOut,
   *         recipient, deadline, swapDeadline, relayerFee,
   *         relayerFeeTokenAmount?, relayerFeeAdapterId?, relayerFeeAdapterData? }
   *
   * For ERC-20 output swaps: set relayerFeeTokenAmount + relayerFeeAdapterId +
   * relayerFeeAdapterData (all from GET /dex/metatx/relayer-fee?tokenOut=...).
   * These fields default to zero/empty for BNB-output swaps.
   */
  async buildDigest(body: Record<string, unknown>) {
    const user          = requireAddress(body["user"],         "user");
    const rawTokenIn    = requireAddress(body["tokenIn"],      "tokenIn");
    const rawTokenOut   = requireAddress(body["tokenOut"],     "tokenOut");
    const grossAmountIn = requireBigInt(body["grossAmountIn"], "grossAmountIn");
    const minUserOut    = requireBigInt(body["minUserOut"],    "minUserOut");
    const recipient     = requireAddress(body["recipient"],    "recipient");
    const deadline      = requireBigInt(body["deadline"],      "deadline");
    const swapDeadline  = requireBigInt(body["swapDeadline"],  "swapDeadline");
    const relayerFee    = requireBigInt(body["relayerFee"],    "relayerFee");

    const rawAdapterId   = body["adapterId"];
    const rawAdapterData = body["adapterData"];

    if (typeof rawAdapterId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(rawAdapterId)) {
      throw new BadRequestException("adapterId must be a 32-byte hex string (from GET /dex/route response)");
    }
    if (typeof rawAdapterData !== "string" || !/^0x[0-9a-fA-F]*$/.test(rawAdapterData)) {
      throw new BadRequestException("adapterData must be a hex string (from GET /dex/route response)");
    }

    const adapterId   = rawAdapterId   as Hex;
    const adapterData = rawAdapterData as Hex;

    // ERC-20 fee fields — default to zero/empty when not provided (BNB-output swaps).
    const relayerFeeTokenAmount = body["relayerFeeTokenAmount"] !== undefined
      ? requireBigInt(body["relayerFeeTokenAmount"], "relayerFeeTokenAmount")
      : 0n;
    const rawRfAdapterId = body["relayerFeeAdapterId"] ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
    if (typeof rawRfAdapterId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(rawRfAdapterId)) {
      throw new BadRequestException("relayerFeeAdapterId must be a 32-byte hex string");
    }
    const rawRfAdapterData = body["relayerFeeAdapterData"] ?? "0x";
    if (typeof rawRfAdapterData !== "string" || !/^0x[0-9a-fA-F]*$/.test(rawRfAdapterData)) {
      throw new BadRequestException("relayerFeeAdapterData must be a hex string");
    }
    const relayerFeeAdapterId   = rawRfAdapterId  as Hex;
    const relayerFeeAdapterData = rawRfAdapterData as Hex;

    if (grossAmountIn === 0n) throw new BadRequestException("grossAmountIn must be greater than 0");
    if (relayerFee >= grossAmountIn) throw new BadRequestException("relayerFee must be less than grossAmountIn");
    if (isNative(rawTokenIn) && isNative(rawTokenOut)) {
      throw new BadRequestException("tokenIn and tokenOut cannot both be native BNB");
    }

    const tokenIn  = toWbnbIfNative(rawTokenIn);
    const tokenOut = toWbnbIfNative(rawTokenOut);

    let nonce: bigint;
    try {
      nonce = await getUserNonce(user);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("METATX_ADDRESS")) throw new ServiceUnavailableException("METATX_ADDRESS is not configured");
      throw err;
    }

    const order: MetaTxOrder = {
      user, nonce, deadline, adapterId, tokenIn, grossAmountIn,
      tokenOut, minUserOut, recipient, swapDeadline, adapterData, relayerFee,
      relayerFeeTokenAmount, relayerFeeAdapterId, relayerFeeAdapterData,
    };

    let digest: Hex;
    try {
      digest = await getOrderDigest(order);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("METATX_ADDRESS")) throw new ServiceUnavailableException("METATX_ADDRESS is not configured");
      throw err;
    }

    return {
      data: {
        digest,
        typedData:      await buildMetaTxTypedData(order),
        metaTxContract: metaTxAddress(),
        order: {
          ...order,
          nonce:                  order.nonce.toString(),
          deadline:               order.deadline.toString(),
          grossAmountIn:          order.grossAmountIn.toString(),
          minUserOut:             order.minUserOut.toString(),
          swapDeadline:           order.swapDeadline.toString(),
          relayerFee:             order.relayerFee.toString(),
          relayerFeeTokenAmount:  order.relayerFeeTokenAmount.toString(),
        },
        aggregatorFeeEstimate: (grossAmountIn / 200n).toString(),
      },
    };
  }

  /**
   * POST /dex/metatx/relay
   * Submits a signed MetaTxOrder on-chain via the RELAYER_PRIVATE_KEY account.
   */
  async relay(body: Record<string, unknown>) {
    if (!process.env.RELAYER_PRIVATE_KEY) {
      throw new BadRequestException("Meta-tx relay is not enabled on this node (RELAYER_PRIVATE_KEY not set)");
    }

    const rawOrder = body["order"];
    if (!rawOrder || typeof rawOrder !== "object") throw new BadRequestException("order is required");
    const o = rawOrder as Record<string, unknown>;

    const order: MetaTxOrder = {
      user:          requireAddress(o["user"],          "order.user"),
      nonce:         requireBigInt(o["nonce"],           "order.nonce"),
      deadline:      requireBigInt(o["deadline"],        "order.deadline"),
      adapterId:     (() => {
        const v = o["adapterId"];
        if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
          throw new BadRequestException("order.adapterId must be a 32-byte hex string");
        }
        return v as Hex;
      })(),
      tokenIn:       requireAddress(o["tokenIn"],        "order.tokenIn"),
      grossAmountIn: requireBigInt(o["grossAmountIn"],   "order.grossAmountIn"),
      tokenOut:      requireAddress(o["tokenOut"],       "order.tokenOut"),
      minUserOut:    requireBigInt(o["minUserOut"],      "order.minUserOut"),
      recipient:     requireAddress(o["recipient"],      "order.recipient"),
      swapDeadline:  requireBigInt(o["swapDeadline"],    "order.swapDeadline"),
      adapterData:   (() => {
        const v = o["adapterData"];
        if (typeof v !== "string" || !/^0x[0-9a-fA-F]*$/.test(v)) {
          throw new BadRequestException("order.adapterData must be a hex string");
        }
        return v as Hex;
      })(),
      relayerFee:    requireBigInt(o["relayerFee"],      "order.relayerFee"),
      relayerFeeTokenAmount: o["relayerFeeTokenAmount"] !== undefined
        ? requireBigInt(o["relayerFeeTokenAmount"], "order.relayerFeeTokenAmount")
        : 0n,
      relayerFeeAdapterId: (() => {
        const v = o["relayerFeeAdapterId"] ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
        if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new BadRequestException("order.relayerFeeAdapterId must be a 32-byte hex string");
        return v as Hex;
      })(),
      relayerFeeAdapterData: (() => {
        const v = o["relayerFeeAdapterData"] ?? "0x";
        if (typeof v !== "string" || !/^0x[0-9a-fA-F]*$/.test(v)) throw new BadRequestException("order.relayerFeeAdapterData must be a hex string");
        return v as Hex;
      })(),
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
    if (rawPermitData.length > 1026) throw new BadRequestException("permitData exceeds maximum length (512 bytes)");

    const permit: PermitData = { permitType, data: rawPermitData as Hex };
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (order.deadline < nowSec) throw new BadRequestException("Meta-tx deadline has expired");

    let sigValid: boolean;
    try {
      sigValid = await verifyOrderSignature(order, sig as Hex);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("METATX_ADDRESS")) throw new ServiceUnavailableException("METATX_ADDRESS is not configured — set it to 0x1dEc224F47a84505a00584Ce7B23D0455D064c5b");
      throw new ServiceUnavailableException(`Signature verification RPC error: ${msg}`);
    }
    if (!sigValid) throw new BadRequestException("Signature does not match order.user — ensure you signed typedData with eth_signTypedData_v4, not the raw digest");

    const currentNonce = await getUserNonce(order.user).catch(() => null);
    if (currentNonce !== null && currentNonce !== order.nonce) {
      throw new BadRequestException(
        `Nonce mismatch: on-chain nonce is ${currentNonce}, order has ${order.nonce}. Re-fetch the digest.`,
      );
    }

    let txHash: Hex;
    try {
      txHash = await relayMetaTx(order, sig as Hex, permit);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("timeout") || msg.includes("TIMEOUT") ||
          msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") ||
          msg.includes("fetch failed")) {
        throw new ServiceUnavailableException("Relay RPC unavailable — try again shortly");
      }
      if (msg.includes("invalid signature") || msg.includes("ECDSA")) {
        throw new BadRequestException("Transaction reverted: invalid signature");
      }
      if (msg.includes("deadline") || msg.includes("expired")) {
        throw new BadRequestException("Transaction reverted: swap deadline expired");
      }
      if (msg.includes("slippage") || msg.includes("minOut") || msg.includes("insufficient output")) {
        throw new BadRequestException("Transaction reverted: slippage exceeded");
      }
      throw new BadRequestException("Transaction reverted");
    }

    return { data: { txHash, status: "submitted" } };
  }

  /**
   * POST /dex/metatx/batch-digest
   * Computes the EIP-712 digest the user must sign for a gasless multi-hop swap.
   * Steps come from GET /dex/route with pre-encoded adapterData.
   */
  async buildBatchDigest(body: Record<string, unknown>) {
    const user          = requireAddress(body["user"],          "user");
    const grossAmountIn = requireBigInt(body["grossAmountIn"],  "grossAmountIn");
    const minFinalOut   = requireBigInt(body["minFinalOut"],    "minFinalOut");
    const recipient     = requireAddress(body["recipient"],     "recipient");
    const deadline      = requireBigInt(body["deadline"],       "deadline");
    const swapDeadline  = requireBigInt(body["swapDeadline"],   "swapDeadline");
    const relayerFee    = requireBigInt(body["relayerFee"],     "relayerFee");

    const relayerFeeTokenAmount = body["relayerFeeTokenAmount"] !== undefined
      ? requireBigInt(body["relayerFeeTokenAmount"], "relayerFeeTokenAmount")
      : 0n;
    const rawRfAdapterId = body["relayerFeeAdapterId"] ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
    if (typeof rawRfAdapterId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(rawRfAdapterId)) {
      throw new BadRequestException("relayerFeeAdapterId must be a 32-byte hex string");
    }
    const rawRfAdapterData = body["relayerFeeAdapterData"] ?? "0x";
    if (typeof rawRfAdapterData !== "string" || !/^0x[0-9a-fA-F]*$/.test(rawRfAdapterData)) {
      throw new BadRequestException("relayerFeeAdapterData must be a hex string");
    }
    const relayerFeeAdapterId   = rawRfAdapterId  as Hex;
    const relayerFeeAdapterData = rawRfAdapterData as Hex;

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
      relayerFeeTokenAmount, relayerFeeAdapterId, relayerFeeAdapterData,
    };

    let digest: Hex;
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
        typedData:      await buildBatchMetaTxTypedData(order),
        metaTxContract: metaTxAddress(),
        order: {
          ...order,
          nonce:                 order.nonce.toString(),
          deadline:              order.deadline.toString(),
          grossAmountIn:         order.grossAmountIn.toString(),
          minFinalOut:           order.minFinalOut.toString(),
          swapDeadline:          order.swapDeadline.toString(),
          relayerFee:            order.relayerFee.toString(),
          relayerFeeTokenAmount: order.relayerFeeTokenAmount.toString(),
          steps:                 order.steps.map(s => ({ ...s, minOut: s.minOut.toString() })),
        },
        aggregatorFeeEstimate: (grossAmountIn / 200n).toString(),
      },
    };
  }

  /**
   * POST /dex/metatx/batch-relay
   * Submits a signed BatchMetaTxOrder to OneMEMEMetaTx.batchExecuteMetaTx().
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
      relayerFeeTokenAmount: o["relayerFeeTokenAmount"] !== undefined
        ? requireBigInt(o["relayerFeeTokenAmount"], "order.relayerFeeTokenAmount")
        : 0n,
      relayerFeeAdapterId: (() => {
        const v = o["relayerFeeAdapterId"] ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
        if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new BadRequestException("order.relayerFeeAdapterId must be a 32-byte hex string");
        return v as Hex;
      })(),
      relayerFeeAdapterData: (() => {
        const v = o["relayerFeeAdapterData"] ?? "0x";
        if (typeof v !== "string" || !/^0x[0-9a-fA-F]*$/.test(v)) throw new BadRequestException("order.relayerFeeAdapterData must be a hex string");
        return v as Hex;
      })(),
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
    if (rawPermitData.length > 1026) throw new BadRequestException("permitData exceeds maximum length (512 bytes)");

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (order.deadline < nowSec) throw new BadRequestException("Meta-tx deadline has expired");

    let sigValid: boolean;
    try {
      sigValid = await verifyBatchOrderSignature(order, sig as Hex);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("METATX_ADDRESS")) throw new ServiceUnavailableException("METATX_ADDRESS is not configured — set it to 0x1dEc224F47a84505a00584Ce7B23D0455D064c5b");
      throw new ServiceUnavailableException(`Signature verification RPC error: ${msg}`);
    }
    if (!sigValid) throw new BadRequestException("Signature does not match order.user");

    const currentNonce = await getUserNonce(order.user).catch(() => null);
    if (currentNonce !== null && currentNonce !== order.nonce) {
      throw new BadRequestException(
        `Nonce mismatch: on-chain nonce is ${currentNonce}, order has ${order.nonce}. Re-fetch the digest.`,
      );
    }

    let txHash: Hex;
    try {
      txHash = await relayBatchMetaTx(order, sig as Hex, { permitType, data: rawPermitData as Hex });
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("timeout") || msg.includes("TIMEOUT") ||
          msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
        throw new ServiceUnavailableException("Relay RPC unavailable — try again shortly");
      }
      if (msg.includes("invalid signature") || msg.includes("ECDSA")) {
        throw new BadRequestException("Transaction reverted: invalid signature");
      }
      if (msg.includes("deadline") || msg.includes("expired")) {
        throw new BadRequestException("Transaction reverted: swap deadline expired");
      }
      if (msg.includes("slippage") || msg.includes("minOut") || msg.includes("insufficient output")) {
        throw new BadRequestException("Transaction reverted: slippage exceeded");
      }
      throw new BadRequestException("Transaction reverted");
    }

    return { data: { txHash, status: "submitted" } };
  }
}

