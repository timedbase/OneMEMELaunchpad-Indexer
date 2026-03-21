import { Module } from "@nestjs/common";
import { TokensController, CreatorsController } from "./tokens.controller";
import { TokensService } from "./tokens.service";
import { PriceModule } from "../price/price.module";

@Module({
  imports:     [PriceModule],
  controllers: [TokensController, CreatorsController],
  providers:   [TokensService],
})
export class TokensModule {}
