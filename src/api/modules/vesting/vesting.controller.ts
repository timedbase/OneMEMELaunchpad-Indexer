import { Controller, Get, Param, Query } from "@nestjs/common";
import { VestingService } from "./vesting.service";

@Controller("vesting")
export class VestingController {
  constructor(private readonly vesting: VestingService) {}

  /** GET /api/v1/<chain>/vesting/:token — vesting schedule for a specific token */
  @Get(":token")
  getByToken(@Param("token") token: string) {
    return this.vesting.getByToken(token);
  }
}

/** Separate controller so /creators/:address/vesting doesn't conflict with other creator routes. */
@Controller("creators")
export class VestingByCreatorController {
  constructor(private readonly vesting: VestingService) {}

  /** GET /api/v1/<chain>/creators/:address/vesting — all vesting schedules for a creator */
  @Get(":address/vesting")
  getByBeneficiary(
    @Param("address") address: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.vesting.getByBeneficiary(address, query);
  }
}
