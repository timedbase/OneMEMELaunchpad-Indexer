import { Module } from "@nestjs/common";
import { TradesController, TradersController } from "./trades.controller";
import { TradesService } from "./trades.service";

@Module({
  controllers: [TradesController, TradersController],
  providers:   [TradesService],
})
export class TradesModule {}
