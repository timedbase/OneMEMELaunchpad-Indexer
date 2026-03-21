import { Module } from "@nestjs/common";
import { SaltController } from "./salt.controller";
import { SaltService }    from "./salt.service";

@Module({
  controllers: [SaltController],
  providers:   [SaltService],
})
export class SaltModule {}
