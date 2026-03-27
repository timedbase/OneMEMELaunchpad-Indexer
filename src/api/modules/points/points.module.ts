import { Module } from "@nestjs/common";
import { PointsController } from "./points.controller";
import { PointsService }    from "./points.service";
import { PriceModule }      from "../price/price.module";

@Module({
  imports:     [PriceModule],
  controllers: [PointsController],
  providers:   [PointsService],
  exports:     [PointsService],
})
export class PointsModule {}
