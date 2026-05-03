import { Controller, Get, Post, Query, Body } from "@nestjs/common";
import { RouteService } from "./route.service";

/**
 * DEX route and swap calldata endpoints.
 *
 * These routes are the aggregation layer — they find the best price across
 * liquidity sources and build calldata for on-chain execution.
 * The caller broadcasts transactions themselves; no relayer is involved here.
 *
 * Base path: /api/v1/:chain/dex
 */
@Controller("dex")
export class RouteController {
  constructor(private readonly route: RouteService) {}

  /**
   * GET /dex/quote
   *
   * Queries all liquidity sources in parallel and returns the best price.
   * Response includes `sources[]` sorted best-first.
   *
   * Query params:
   *   tokenIn   — input token address (required)
   *   amountIn  — input amount in wei string (required)
   *   tokenOut  — output token address (required)
   *   slippage  — slippage tolerance in basis points, default 100 (1%)
   */
  @Get("quote")
  getQuote(@Query() query: Record<string, string>) {
    return this.route.getQuote(query);
  }

  /**
   * GET /dex/route
   * Finds the optimal swap route across all relevant liquidity sources.
   *
   * Queries V2, V3, V4, and bonding-curve adapters in parallel. V3/V4 pools are
   * discovered from their subgraphs so only real pools with liquidity are quoted.
   * When neither tokenIn nor tokenOut is WBNB and a BC adapter wins, a two-step
   * bridge route (tokenIn→WBNB→tokenOut) is returned automatically.
   * The `sources[]` field lists every source tried, sorted best-first.
   *
   * Query params:
   *   tokenIn   — input token address (required)
   *   amountIn  — input amount in wei (required)
   *   tokenOut  — output token address (required)
   *   slippage  — slippage in basis points, default 100 (1%)
   */
  @Get("route")
  getRoute(@Query() query: Record<string, string>) {
    return this.route.getRoute(query);
  }

  /**
   * POST /dex/swap
   * Builds ABI-encoded calldata for OneMEMEAggregator.swap() or batchSwap().
   * The caller broadcasts the transaction — no relayer, no gasless.
   *
   * Body: { tokenIn, amountIn, tokenOut, to, deadline, slippage? }
   * Aggregates all sources, picks the best, computes minOut from slippage.
   * Returns `sources[]` and `steps[]`. When the best route is a two-step bridge,
   * batchSwap calldata is built automatically (`singleStep: false`).
   */
  @Post("swap")
  buildSwap(@Body() body: Record<string, unknown>) {
    return this.route.buildSwap(body);
  }

  /**
   * POST /dex/batch-swap
   * Builds ABI-encoded calldata for OneMEMEAggregator.batchSwap().
   * Use steps from GET /dex/route or compose manually from GET /dex/quote outputs.
   *
   * Body: { steps[], amountIn, minFinalOut, to, deadline }
   * Returns: { to, calldata, value, nativeIn, nativeOut, steps, amountIn, feeEstimate, minFinalOut, deadline }
   */
  @Post("batch-swap")
  buildBatchSwap(@Body() body: Record<string, unknown>) {
    return this.route.buildBatchSwap(body);
  }
}
