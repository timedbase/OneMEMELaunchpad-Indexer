import { Controller, Get, Param, Query } from "@nestjs/common";
import { QuotesService } from "./quotes.service";

@Controller("tokens")
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  /** GET /api/v1/tokens/:address/quote/price */
  @Get(":address/quote/price")
  spotPrice(@Param("address") address: string) {
    return this.quotes.spotPrice(address);
  }

  /** GET /api/v1/tokens/:address/quote/buy?bnbIn=<wei>&slippage=<bps> */
  @Get(":address/quote/buy")
  buy(
    @Param("address") address: string,
    @Query() query: Record<string, string>,
  ) {
    return this.quotes.buy(address, query);
  }

  /** GET /api/v1/tokens/:address/quote/sell?tokensIn=<wei>&slippage=<bps> */
  @Get(":address/quote/sell")
  sell(
    @Param("address") address: string,
    @Query() query: Record<string, string>,
  ) {
    return this.quotes.sell(address, query);
  }
}
