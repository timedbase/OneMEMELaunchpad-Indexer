import { Controller, Get, UseGuards } from "@nestjs/common";
import { StatsService }  from "./stats.service";
import { OriginGuard }   from "../../common/origin.guard";

@Controller("stats")
@UseGuards(OriginGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** GET /api/v1/stats */
  @Get()
  platform() {
    return this.stats.platform();
  }
}
