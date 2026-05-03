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
   * Live on-chain quote from a specific adapter.
   *
   * Query params:
   *   adapter      — adapter name (required)
   *   tokenIn      — input token address (required)
   *   amountIn     — input amount in wei (required)
   *   tokenOut     — output token address (required)
   *   path         — comma-separated token addresses for multi-hop (optional)
   *   fees         — comma-separated fee tiers, e.g. 500,3000 (required for V3/V4)
   *   tickSpacing  — comma-separated tick spacings for V4 (optional, auto-derived)
   *   hooks        — comma-separated hook addresses for V4 (optional)
   *   slippage     — slippage tolerance in basis points, default 100 (1%)
   */
  @Get("quote")
  getQuote(@Query() query: Record<string, string>) {
    return this.route.getQuote(query);
  }

  /**
   * GET /dex/route
   * Finds the optimal swap route across all relevant liquidity sources.
   *
   * Aggregation mode (no adapter param):
   *   Queries V2, V3 (common fee tiers), and bonding-curve adapters in parallel.
   *   Returns the route with the best output. The `sources` field lists every
   *   source that returned a valid quote, sorted best-first.
   *
   * Specific adapter mode (adapter param provided):
   *   Routes through that single adapter. For bonding-curve adapters with a
   *   non-WBNB tokenIn, automatically prepends a PANCAKE_V3→PANCAKE_V2 bridge hop.
   *
   * Query params:
   *   adapter     — target adapter (optional; omit for aggregation)
   *   tokenIn     — input token address (required)
   *   amountIn    — input amount in wei (required)
   *   tokenOut    — output token address (required)
   *   fees        — fee tier(s) for V3/V4 routes (required when adapter is V3/V4)
   *   tickSpacing — tick spacings for V4 (optional, auto-derived from fee)
   *   hooks       — hook addresses for V4 (optional)
   *   slippage    — slippage in basis points, default 100 (1%)
   */
  @Get("route")
  getRoute(@Query() query: Record<string, string>) {
    return this.route.getRoute(query);
  }

  /**
   * POST /dex/swap
   * Builds ABI-encoded calldata for OneMEMEAggregator.swap().
   * The caller broadcasts the transaction — no relayer, no gasless.
   *
   * Body: { adapter, tokenIn, amountIn, tokenOut, minOut, to, deadline, path?, fees? }
   * Returns: { to, calldata, value, nativeIn, nativeOut, adapter, amountIn, feeEstimate, ... }
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
