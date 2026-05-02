import {
  Controller,
  Get,
  Post,
  Param,
  Query,
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
   * GET /dex/quote
   * Live on-chain quote — simulates expected output before committing to a swap.
   * Use this to compute amountOut and minOut before calling POST /dex/swap or /dex/metatx/digest.
   *
   * Supported adapters: all — PANCAKE_V2/V3/V4, UNISWAP_V2/V3/V4, ONEMEME_BC, FOURMEME, FLAPSH
   *
   * Query params:
   *   adapter   — adapter name (required)
   *   tokenIn   — input token address (required)
   *   amountIn  — input amount in wei (required)
   *   tokenOut  — output token address (required)
   *   path      — comma-separated token addresses for multi-hop (optional, defaults to direct)
   *   fees      — comma-separated fee tiers for V3 hops, e.g. 500,3000 (required for V3)
   *   slippage  — slippage tolerance in basis points, default 100 (1%)
   */
  @Get("quote")
  getQuote(@Query() query: Record<string, string>) {
    return this.metatx.getQuote(query);
  }

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

  /**
   * GET /dex/route
   * Computes the optimal swap route, detecting whether a WBNB bridge hop is needed.
   *
   * For bonding-curve adapters (ONEMEME_BC, FOURMEME, FLAPSH) with a non-WBNB tokenIn,
   * returns a two-step route: tokenIn→WBNB (PANCAKE_V3 500, fallback PANCAKE_V2) then
   * WBNB→tokenOut via the target adapter. Otherwise returns a single-step route.
   *
   * Each step includes pre-encoded adapterData ready to use with POST /dex/batch-swap
   * or POST /dex/metatx/batch-digest.
   *
   * Query params:
   *   adapter   — target adapter (required)
   *   tokenIn   — input token address (required)
   *   amountIn  — input amount in wei (required)
   *   tokenOut  — output token address (required)
   *   fees      — fee tier(s) for V3 single-step route, e.g. 500 (required for V3)
   *   slippage  — slippage tolerance in basis points, default 100 (1%)
   */
  @Get("route")
  getRoute(@Query() query: Record<string, string>) {
    return this.metatx.getRoute(query);
  }

  /**
   * POST /dex/batch-swap
   * Builds ABI-encoded calldata for OneMEMEAggregator.batchSwap().
   * The caller broadcasts the transaction themselves — no relayer involved.
   *
   * Use steps from GET /dex/route or build them manually using /dex/quote outputs.
   * Fee is charged only once on the initial amountIn.
   *
   * Body:
   *   {
   *     steps:       SwapStep[] (≥2) — each with adapterId, tokenIn, tokenOut, minOut, adapterData
   *     amountIn:    gross input amount in wei
   *     minFinalOut: minimum acceptable final output in wei
   *     to:          recipient address
   *     deadline:    unix timestamp (seconds)
   *   }
   * Returns: { to (aggregator address), calldata, steps, amountIn, feeEstimate, minFinalOut, deadline }
   */
  @Post("batch-swap")
  buildBatchSwap(@Body() body: Record<string, unknown>) {
    return this.metatx.buildBatchSwap(body);
  }

  /**
   * POST /dex/metatx/batch-digest
   * Computes the EIP-712 digest the user must sign for a gasless multi-hop swap.
   *
   * Flow:
   *   1. GET /dex/route → get steps[] with pre-encoded adapterData
   *   2. GET /dex/metatx/nonce/:user → get current nonce
   *   3. POST /dex/metatx/batch-digest → get digest + BatchMetaTxOrder
   *   4. User signs digest with their wallet
   *   5. POST /dex/metatx/batch-relay with { order, sig }
   *
   * Body:
   *   {
   *     user, steps[] (≥2), grossAmountIn, minFinalOut,
   *     recipient, deadline, swapDeadline, relayerFee
   *   }
   * Returns: { digest, metaTxContract, order, aggregatorFeeEstimate }
   */
  @Post("metatx/batch-digest")
  buildBatchDigest(@Body() body: Record<string, unknown>) {
    return this.metatx.buildBatchDigest(body);
  }

  /**
   * POST /dex/metatx/batch-relay
   * Submits a signed BatchMetaTxOrder to OneMEMEMetaTx.batchExecuteMetaTx() on-chain.
   * The RELAYER_PRIVATE_KEY account pays gas; the user is reimbursed via relayerFee.
   *
   * Body:
   *   {
   *     order:      BatchMetaTxOrder (from /dex/metatx/batch-digest response),
   *     sig:        "0x..." (65-byte EIP-712 signature),
   *     permitType: 0 | 1 | 2  (default 0 = PERMIT_NONE),
   *     permitData: "0x..."     (required if permitType > 0)
   *   }
   * Returns: { txHash, status: "submitted" }
   */
  @Post("metatx/batch-relay")
  relayBatch(@Body() body: Record<string, unknown>) {
    return this.metatx.relayBatch(body);
  }
}
