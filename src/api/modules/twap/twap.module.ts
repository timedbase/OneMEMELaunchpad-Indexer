import { Module } from "@nestjs/common";
import { TwapController } from "./twap.controller";
import { TwapService }    from "./twap.service";

@Module({
  controllers: [TwapController],
  providers:   [TwapService],
})
export class TwapModule {}
