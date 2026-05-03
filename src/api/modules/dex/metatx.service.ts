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
  ADAPTER_IDS,
  getUserNonce,
  getOrderDigest,
  getBatchOrderDigest,
  relayMetaTx,
  relayBatchMetaTx,
  verifyOrderSignature,
  verifyBatchOrderSignature,
  metaTxAddress,
} from "./dex-rpc";
import {
  buildAdapterData,
  parseSteps,
  validatePathContinuity,
  requireAddress,
  requireBigInt,
  requireAdapter,
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
   * POST /dex/metatx/digest
   * Computes the EIP-712 digest the user must sign for a gasless single-hop swap.
   * Accepts the same adapter/tokenIn/tokenOut/fees body as POST /dex/swap.
   */
  async buildDigest(body: Record<string, unknown>) {
    const user          = requireAddress(body["user"],         "user");
    const adapter       = requireAdapter(body["adapter"]);
    const rawTokenIn    = requireAddress(body["tokenIn"],      "tokenIn");
    const rawTokenOut   = requireAddress(body["tokenOut"],     "tokenOut");
    const grossAmountIn = requireBigInt(body["grossAmountIn"], "grossAmountIn");
    const minUserOut    = requireBigInt(body["minUserOut"],    "minUserOut");
    const recipient     = requireAddress(body["recipient"],    "recipient");
    const deadline      = requireBigInt(body["deadline"],      "deadline");
    const swapDeadline  = requireBigInt(body["swapDeadline"],  "swapDeadline");
    const relayerFee    = requireBigInt(body["relayerFee"],    "relayerFee");

    if (grossAmountIn === 0n) throw new BadRequestException("grossAmountIn must be greater than 0");
    if (relayerFee >= grossAmountIn) throw new BadRequestException("relayerFee must be less than grossAmountIn");
    if (isNative(rawTokenIn) && isNative(rawTokenOut)) {
      throw new BadRequestException("tokenIn and tokenOut cannot both be native BNB");
    }

    const tokenIn  = toWbnbIfNative(rawTokenIn);
    const tokenOut = toWbnbIfNative(rawTokenOut);

    const adapterId   = ADAPTER_IDS[adapter];
    const adapterData = buildAdapterData(adapter, tokenIn, tokenOut, body as Record<string, unknown>, swapDeadline);

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
        aggregatorFeeEstimate: (grossAmountIn / 100n).toString() /* 1% protocol fee */,
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
    try { sigValid = await verifyOrderSignature(order, sig as Hex); }
    catch { sigValid = false; }
    if (!sigValid) throw new BadRequestException("Signature does not match order.user");

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
        aggregatorFeeEstimate: (grossAmountIn / 100n).toString() /* 1% protocol fee */,
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
    try { sigValid = await verifyBatchOrderSignature(order, sig as Hex); }
    catch { sigValid = false; }
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

