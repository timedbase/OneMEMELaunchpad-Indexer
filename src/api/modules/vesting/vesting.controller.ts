import { Controller, Get, Param, Query } from "@nestjs/common";
import { VestingService } from "./vesting.service";

@Controller("api/v1")
export class VestingController {
  constructor(private readonly vesting: VestingService) {}

  /** GET /api/v1/vesting/:token — vesting schedule for a specific token */
  @Get("vesting/:token")
  getByToken(@Param("token") token: string) {
    return this.vesting.getByToken(token);
  }

  /** GET /api/v1/creators/:address/vesting — all vesting schedules for a creator */
  @Get("creators/:address/vesting")
  getByBeneficiary(
    @Param("address") address: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.vesting.getByBeneficiary(address, query);
  }
}
