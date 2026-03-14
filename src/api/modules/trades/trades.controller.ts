import { Controller, Get, Param, Query } from "@nestjs/common";
import { TradesService } from "./trades.service";

@Controller("trades")
export class TradesController {
  constructor(private readonly trades: TradesService) {}

  /** GET /api/v1/trades */
  @Get()
  list(@Query() query: Record<string, string>) {
    return this.trades.list(query);
  }
}

@Controller("traders")
export class TradersController {
  constructor(private readonly trades: TradesService) {}

  /** GET /api/v1/traders/:address/trades */
  @Get(":address/trades")
  byTrader(
    @Param("address") address: string,
    @Query() query: Record<string, string>,
  ) {
    return this.trades.byTrader(address, query);
  }
}
