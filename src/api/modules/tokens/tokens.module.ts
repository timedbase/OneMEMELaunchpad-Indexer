import { Module } from "@nestjs/common";
import { TokensController, CreatorsController } from "./tokens.controller";
import { TokensService } from "./tokens.service";

@Module({
  controllers: [TokensController, CreatorsController],
  providers:   [TokensService],
})
export class TokensModule {}
