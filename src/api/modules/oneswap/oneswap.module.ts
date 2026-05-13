import { Module } from "@nestjs/common";
import { OneswapController } from "./oneswap.controller";
import { OneswapService }    from "./oneswap.service";

@Module({
  controllers: [OneswapController],
  providers:   [OneswapService],
})
export class OneswapModule {}
