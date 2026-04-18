import {
  Controller,
  Get,
  Post,
  Param,
  Body,
} from "@nestjs/common";
import { MetaTxService } from "./metatx.service";

/**
 * Swap calldata builder and meta-transaction relay endpoints.
 *
 * All routes under /dex/swap and /dex/metatx.
 * These routes interact with on-chain contracts via dex-rpc.ts
 * and never touch the main launchpad subgraph or rpc.ts.
 */
@Controller("dex")
export class MetaTxController {
  constructor(private readonly metatx: MetaTxService) {}

  /**
   * POST /dex/swap
   * Builds ABI-encoded calldata for a direct OneMEMEAggregator.swap() call.
   * The caller broadcasts this themselves — no relayer, no gasless.
   *
   * Body: { adapter, tokenIn, amountIn, tokenOut, minOut, to, deadline, path?, fees?, adapterData? }
   * Returns: { to (aggregator address), calldata, adapter, amountIn, feeEstimate, ... }
   */
  @Post("swap")
  buildSwap(@Body() body: Record<string, unknown>) {
    return this.metatx.buildSwap(body);
  }

  /**
   * GET /dex/metatx/nonce/:user
   * Returns the current nonce for a user on the OneMEMEMetaTx contract.
   * Required before building a meta-tx digest.
   */
  @Get("metatx/nonce/:user")
  getNonce(@Param("user") user: string) {
    return this.metatx.getNonce(user);
  }

  /**
   * POST /dex/metatx/digest
   * Computes the EIP-712 digest the user must sign for a gasless swap.
   *
   * Flow:
   *   1. Call GET /dex/metatx/nonce/:user to get current nonce
   *   2. POST /dex/metatx/digest with order params → get digest + full order
   *   3. User signs digest with their wallet
   *   4. POST /dex/metatx/relay with { order, sig } → relayer submits on-chain
   *
   * Body:
   *   {
   *     user, adapter, tokenIn, grossAmountIn, tokenOut, minUserOut,
   *     recipient, deadline, swapDeadline, relayerFee,
   *     path?, fees?, adapterData?
   *   }
   * Returns: { digest, order, metaTxContract, aggregatorFeeEstimate }
   */
  @Post("metatx/digest")
  buildDigest(@Body() body: Record<string, unknown>) {
    return this.metatx.buildDigest(body);
  }

  /**
   * POST /dex/metatx/relay
   * Submits a signed MetaTxOrder to OneMEMEMetaTx.executeMetaTx() on-chain.
   * The RELAYER_PRIVATE_KEY account pays gas; the user is reimbursed via relayerFee.
   *
   * Only Token→BNB and Token→Token are supported (not BNB→Token).
   * User must have approved the MetaTx contract for grossAmountIn of tokenIn.
   *
   * Body:
   *   {
   *     order:      MetaTxOrder (from /dex/metatx/digest response),
   *     sig:        "0x..." (65-byte EIP-712 signature),
   *     permitType: 0 | 1 | 2  (default 0 = PERMIT_NONE),
   *     permitData: "0x..."     (required if permitType > 0)
   *   }
   * Returns: { txHash, status: "submitted" }
   */
  @Post("metatx/relay")
  relay(@Body() body: Record<string, unknown>) {
    return this.metatx.relay(body);
  }
}
