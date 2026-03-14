import { Controller, Get, Query } from "@nestjs/common";
import { TwapService } from "./twap.service";

@Controller("twap")
export class TwapController {
  constructor(private readonly twap: TwapService) {}

  /** GET /api/v1/twap/latest */
  @Get("latest")
  latest() {
    return this.twap.latest();
  }

  /** GET /api/v1/twap */
  @Get()
  list(@Query() query: Record<string, string>) {
    return this.twap.list(query);
  }
}
