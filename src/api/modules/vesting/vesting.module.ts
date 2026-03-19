import { Module } from "@nestjs/common";
import { VestingController } from "./vesting.controller";
import { VestingService }    from "./vesting.service";

@Module({
  controllers: [VestingController],
  providers:   [VestingService],
})
export class VestingModule {}
