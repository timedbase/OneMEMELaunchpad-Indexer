import {
  Controller,
  Get,
  Param,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DexService } from "./dex.service";

/**
 * All read endpoints under /dex.
 *
 * Powered entirely by the OneMEMEAggregator subgraph (AGGREGATOR_SUBGRAPH_URL).
 * No data from the main launchpad subgraph is mixed in here.
 *
 * Base path: /api/v1/:chain/dex
 */
@Controller("dex")
export class DexController {
  constructor(private readonly dex: DexService) {}

  /**
   * GET /dex/adapters
   * Returns all registered adapter names and their keccak256 bytes32 IDs.
   */
  @Get("adapters")
  adapters() {
    return this.dex.adapters();
  }

  /**
   * GET /dex/stats
   * Platform-level stats: BNB price, total swaps, volume, fees, unique users.
   */
  @Get("stats")
  stats() {
    return this.wrapSubgraph(() => this.dex.stats());
  }

  /**
   * GET /dex/tokens
   * Paginated list of all tokens tracked by the aggregator subgraph.
   *
   * Query params:
   *   platform      — filter by platform: ONEMEME | FOURMEME | FLAPSH | DEX
   *   bondingPhase  — filter bonding-curve tokens: true | false
   *   search        — case-insensitive symbol substring match
   *   orderBy       — createdAtTimestamp | totalVolumeBNB | tradeCount | currentMarketCapBNB | currentLiquidityBNB
   *   orderDir      — asc | desc (default: desc)
   *   page / limit  — pagination
   */
  @Get("tokens")
  listTokens(@Query() query: Record<string, string>) {
    return this.wrapSubgraph(() => this.dex.listTokens(query));
  }

  /**
   * GET /dex/tokens/:address
   * Full detail for a single token including live price, market cap, and liquidity.
   */
  @Get("tokens/:address")
  getToken(@Param("address") address: string) {
    return this.wrapSubgraph(() => this.dex.getToken(address));
  }

  /**
   * GET /dex/tokens/:address/pools
   * All DEX pools containing this token (V2/V3/V4 across PancakeSwap and Uniswap).
   *
   * Query params:
   *   dex   — filter by DEX: PANCAKE_V2 | PANCAKE_V3 | UNISWAP_V2 | UNISWAP_V3 | etc.
   *   page / limit
   */
  @Get("tokens/:address/pools")
  getTokenPools(
    @Param("address") address: string,
    @Query() query: Record<string, string>,
  ) {
    return this.wrapSubgraph(() => this.dex.getTokenPools(address, query));
  }

  /**
   * GET /dex/tokens/:address/trades
   * Combined bonding-curve trades and aggregator swaps for a token.
   *
   * Query params:
   *   source — "bonding" | "dex" | (omit for all)
   *   page / limit
   */
  @Get("tokens/:address/trades")
  getTokenTrades(
    @Param("address") address: string,
    @Query() query: Record<string, string>,
  ) {
    return this.wrapSubgraph(() => this.dex.getTokenTrades(address, query));
  }

  /**
   * GET /dex/swaps
   * Paginated list of aggregator swaps (OneMEMEAggregator.Swapped events).
   *
   * Query params:
   *   user     — filter by trader address
   *   adapter  — filter by adapter name (e.g. PANCAKE_V2)
   *   tokenIn  — filter by input token address
   *   tokenOut — filter by output token address
   *   from / to — unix timestamp range
   *   page / limit
   */
  @Get("swaps")
  listSwaps(@Query() query: Record<string, string>) {
    return this.wrapSubgraph(() => this.dex.listSwaps(query));
  }

  // ── Helper ──────────────────────────────────────────────────────────────────

  private async wrapSubgraph<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.includes("AGGREGATOR_SUBGRAPH_URL")) {
        throw new ServiceUnavailableException(
          "Aggregator subgraph is not configured. Set AGGREGATOR_SUBGRAPH_URL.",
        );
      }
      throw err;
    }
  }
}
