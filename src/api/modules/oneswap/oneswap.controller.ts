import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { OneswapService } from "./oneswap.service";

/**
 * Swap routing via the @1swap/sdk aggregator.
 * Base path: /api/v1/:chain/oneswap
 *
 * Requires BSC_RPC_URL — returns 503 when not configured.
 *
 * Pass 0x000...000 or the string "native" as tokenIn / tokenOut for native BNB.
 */
@Controller("oneswap")
export class OneswapController {
  constructor(private readonly oneswap: OneswapService) {}

  /**
   * GET /oneswap/quote
   * All protocol quotes sorted best-first.
   *
   * Query: tokenIn, tokenOut, amountIn (wei)
   */
  @Get("quote")
  quote(@Query() query: Record<string, string>) {
    return this.oneswap.quotes(query);
  }

  /**
   * GET /oneswap/route
   * Optimal route with executionData for OneDex.execute().
   * Returns minAmountOut (slippage applied) and oneDex contract address.
   *
   * Query: tokenIn, tokenOut, amountIn (wei), recipient, slippageBps (default: 50)
   */
  @Get("route")
  route(@Query() query: Record<string, string>) {
    return this.oneswap.route(query);
  }

  /**
   * GET /oneswap/execute
   * Complete unsigned transaction ready to sign and broadcast.
   * Returns tx (to, data, value, from) and approval (token, spender, amount) or null for BNB.
   *
   * Query: tokenIn, tokenOut, amountIn (wei), recipient, slippageBps (default: 50), deadline (unix ts)
   */
  @Get("execute")
  execute(@Query() query: Record<string, string>) {
    return this.oneswap.execute(query);
  }

  /**
   * GET /oneswap/execute/permit2
   * Step 1 of the Permit2 flow — returns EIP-712 typedData for the wallet to sign.
   * Only for ERC20 tokenIn; native BNB does not need Permit2.
   *
   * Query: tokenIn, tokenOut, amountIn (wei), recipient, slippageBps (default: 50), deadline, nonce (optional)
   */
  @Get("execute/permit2")
  executePermit2(@Query() query: Record<string, string>) {
    return this.oneswap.executePermit2(query);
  }

  /**
   * POST /oneswap/execute/permit2/submit
   * Step 2 of the Permit2 flow — returns executeWithPermit2() calldata.
   * Send the approval tx first, then broadcast the returned tx.
   *
   * Body (JSON): tokenIn, tokenOut, amountIn, recipient, slippageBps, deadline,
   *              signature (0x-prefixed 65-byte ECDSA), permit2Nonce
   */
  @Post("execute/permit2/submit")
  executePermit2Submit(@Body() body: Record<string, string>) {
    return this.oneswap.executePermit2Submit(body);
  }

  /**
   * GET /oneswap/tokens/:address
   * Detect which protocol a token trades on and whether it has graduated.
   * Returns bondingCurve, graduated, isTaxToken, ammProtocols.
   */
  @Get("tokens/:address")
  detectToken(@Param("address") address: string) {
    return this.oneswap.token(address);
  }
}
