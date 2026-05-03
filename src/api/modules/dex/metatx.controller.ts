import { Controller, Get, Post, Param, Body } from "@nestjs/common";
import { MetaTxService } from "./metatx.service";

/**
 * Gasless swap endpoints — meta-transaction signing and relay.
 *
 * This layer sits on top of the DEX route layer (RouteController).
 * The flow is:
 *   1. GET /dex/route    → find optimal route, get pre-encoded steps
 *   2. POST /dex/metatx/digest (or /batch-digest) → compute EIP-712 digest
 *   3. User signs the digest off-chain
 *   4. POST /dex/metatx/relay (or /batch-relay) → relayer submits on-chain
 *
 * Base path: /api/v1/:chain/dex/metatx
 */
@Controller("dex/metatx")
export class MetaTxController {
  constructor(private readonly metatx: MetaTxService) {}

  /**
   * GET /dex/metatx/nonce/:user
   * Returns the current on-chain nonce for a user on the OneMEMEMetaTx contract.
   * Must be fetched before building any digest to prevent replay.
   */
  @Get("nonce/:user")
  getNonce(@Param("user") user: string) {
    return this.metatx.getNonce(user);
  }

  /**
   * POST /dex/metatx/digest
   * Computes the EIP-712 digest the user must sign for a gasless single-hop swap.
   *
   * Body:
   *   user, adapter, tokenIn, grossAmountIn, tokenOut, minUserOut,
   *   recipient, deadline, swapDeadline, relayerFee, path?, fees?
   * Returns: { digest, order, metaTxContract, aggregatorFeeEstimate }
   */
  @Post("digest")
  buildDigest(@Body() body: Record<string, unknown>) {
    return this.metatx.buildDigest(body);
  }

  /**
   * POST /dex/metatx/relay
   * Submits a signed MetaTxOrder to OneMEMEMetaTx.executeMetaTx() on-chain.
   * The RELAYER_PRIVATE_KEY account pays gas.
   *
   * Body: { order, sig, permitType?, permitData? }
   * Returns: { txHash, status: "submitted" }
   */
  @Post("relay")
  relay(@Body() body: Record<string, unknown>) {
    return this.metatx.relay(body);
  }

  /**
   * POST /dex/metatx/batch-digest
   * Computes the EIP-712 digest the user must sign for a gasless multi-hop swap.
   * Steps come from GET /dex/route with pre-encoded adapterData.
   *
   * Body:
   *   user, steps[], grossAmountIn, minFinalOut,
   *   recipient, deadline, swapDeadline, relayerFee
   * Returns: { digest, metaTxContract, order, aggregatorFeeEstimate }
   */
  @Post("batch-digest")
  buildBatchDigest(@Body() body: Record<string, unknown>) {
    return this.metatx.buildBatchDigest(body);
  }

  /**
   * POST /dex/metatx/batch-relay
   * Submits a signed BatchMetaTxOrder to OneMEMEMetaTx.batchExecuteMetaTx().
   * The RELAYER_PRIVATE_KEY account pays gas.
   *
   * Body: { order, sig, permitType?, permitData? }
   * Returns: { txHash, status: "submitted" }
   */
  @Post("batch-relay")
  relayBatch(@Body() body: Record<string, unknown>) {
    return this.metatx.relayBatch(body);
  }
}
