import { Controller, Get } from "@nestjs/common";
import { StatsService }  from "./stats.service";

@Controller("stats")
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** GET /api/v1/stats */
  @Get()
  platform() {
    return this.stats.platform();
  }
}
