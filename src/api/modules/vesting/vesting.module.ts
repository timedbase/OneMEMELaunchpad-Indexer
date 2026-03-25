import { Module } from "@nestjs/common";
import { VestingController, VestingByCreatorController } from "./vesting.controller";
import { VestingService }                                from "./vesting.service";

@Module({
  controllers: [VestingController, VestingByCreatorController],
  providers:   [VestingService],
})
export class VestingModule {}
