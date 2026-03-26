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

  /** GET /api/v1/discover/graduating — tokens closest to migration target */
  @Get("graduating")
  graduating(@Query() query: Record<string, string>) {
    return this.discover.graduating(query);
  }

  /** GET /api/v1/discover/bonding — alias for /graduating */
  @Get("bonding")
  bonding(@Query() query: Record<string, string>) {
    return this.discover.graduating(query);
  }

  /** GET /api/v1/discover/migrated */
  @Get("migrated")
  migrated(@Query() query: Record<string, string>) {
    return this.discover.migrated(query);
  }
}
