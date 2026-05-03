import { Module } from "@nestjs/common";
import { DexController }    from "./dex.controller";
import { DexService }       from "./dex.service";
import { RouteController }  from "./route.controller";
import { RouteService }     from "./route.service";
import { MetaTxController } from "./metatx.controller";
import { MetaTxService }    from "./metatx.service";

/**
 * Self-contained module for the OneMEMEAggregator DEX layer.
 *
 * Three sub-layers:
 *   DexService      — subgraph market data (tokens, pools, trades, swaps)
 *   RouteService    — aggregation: price comparison, route finding, calldata building
 *   MetaTxService   — gasless: EIP-712 signing and on-chain relay
 */
@Module({
  controllers: [DexController, RouteController, MetaTxController],
  providers:   [DexService, RouteService, MetaTxService],
})
export class DexModule {}
