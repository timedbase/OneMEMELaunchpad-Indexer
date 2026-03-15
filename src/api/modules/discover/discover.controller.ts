import { Controller, Get, Query } from "@nestjs/common";
import { DiscoverService } from "./discover.service";

@Controller("discover")
export class DiscoverController {
  constructor(private readonly discover: DiscoverService) {}

  /** GET /api/v1/discover/trending */
  @Get("trending")
  trending(@Query() query: Record<string, string>) {
    return this.discover.trending(query);
  }

  /** GET /api/v1/discover/new */
  @Get("new")
  newTokens(@Query() query: Record<string, string>) {
    return this.discover.newTokens(query);
  }

  /** GET /api/v1/discover/bonding */
  @Get("bonding")
  bonding(@Query() query: Record<string, string>) {
    return this.discover.bonding(query);
  }

  /** GET /api/v1/discover/migrated */
  @Get("migrated")
  migrated(@Query() query: Record<string, string>) {
    return this.discover.migrated(query);
  }
}
