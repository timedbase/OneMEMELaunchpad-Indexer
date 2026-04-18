import { Module } from "@nestjs/common";
import { DexController }   from "./dex.controller";
import { DexService }      from "./dex.service";
import { MetaTxController } from "./metatx.controller";
import { MetaTxService }   from "./metatx.service";

/**
 * Self-contained module for the OneMEMEAggregator DEX layer.
 *
 * Data sources owned exclusively by this module:
 *   - AGGREGATOR_SUBGRAPH_URL  (via dex-subgraph.ts)
 *   - AGGREGATOR_ADDRESS       (via dex-rpc.ts)
 *   - METATX_ADDRESS           (via dex-rpc.ts)
 *   - RELAYER_PRIVATE_KEY      (via dex-rpc.ts — relay only)
 *
 * No imports from or into other feature modules.
 */
@Module({
  controllers: [DexController, MetaTxController],
  providers:   [DexService, MetaTxService],
})
export class DexModule {}
