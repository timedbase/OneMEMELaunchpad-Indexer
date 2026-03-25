import { Module } from "@nestjs/common";
import { DiscoverController } from "./discover.controller";
import { DiscoverService }    from "./discover.service";
import { PriceModule }        from "../price/price.module";

@Module({
  imports:     [PriceModule],
  controllers: [DiscoverController],
  providers:   [DiscoverService],
})
export class DiscoverModule {}
