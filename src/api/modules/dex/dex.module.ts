import { Module } from "@nestjs/common";
import { DexController }   from "./dex.controller";
import { DexService }      from "./dex.service";
import { RouteController } from "./route.controller";
import { RouteService }    from "./route.service";
import { SecurityService } from "./security.service";

/**
 * Self-contained module for the OneMEMEAggregator DEX layer.
 *
 * Sub-layers:
 *   DexService      — subgraph market data (tokens, pools, trades, swaps)
 *   RouteService    — aggregation: price comparison, route finding, calldata building
 *   SecurityService — GoPlus token security reports + tax detection for route quoting
 *
 * MetaTx (gasless swaps) is temporarily disabled — pending further development.
 */
@Module({
  controllers: [DexController, RouteController],
  providers:   [DexService, RouteService, SecurityService],
})
export class DexModule {}
