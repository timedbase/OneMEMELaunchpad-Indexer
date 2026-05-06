import { Module } from "@nestjs/common";
import { DexController }   from "./dex.controller";
import { DexService }      from "./dex.service";
import { RouteController } from "./route.controller";
import { RouteService }    from "./route.service";

/**
 * Self-contained module for the OneMEMEAggregator DEX layer.
 *
 * Two sub-layers:
 *   DexService    — subgraph market data (tokens, pools, trades, swaps)
 *   RouteService  — aggregation: price comparison, route finding, calldata building
 *
 * MetaTx (gasless swaps) is temporarily disabled — pending further development.
 */
@Module({
  controllers: [DexController, RouteController],
  providers:   [DexService, RouteService],
})
export class DexModule {}
