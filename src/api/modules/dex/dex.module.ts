import { Module } from "@nestjs/common";
import { DexController }   from "./dex.controller";
import { DexService }      from "./dex.service";
import { RouteController } from "./route.controller";
import { RouteService }    from "./route.service";
import { SecurityService } from "./security.service";

@Module({
  controllers: [DexController, RouteController],
  providers:   [DexService, RouteService, SecurityService],
})
export class DexModule {}
