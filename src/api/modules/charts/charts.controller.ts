import { Controller, Get, Query } from "@nestjs/common";
import { ChartsService } from "./charts.service";

/**
 * TradingView UDF-compatible chart data endpoint.
 *
 * Base path: GET /api/v1/charts/*
 *
 * All responses follow the TradingView Universal Data Feed (UDF) protocol.
 * Point TradingView's datafeed URL to: https://yourapi.com/api/v1/charts
 */
@Controller("charts")
export class ChartsController {
  constructor(private readonly charts: ChartsService) {}

  /** GET /api/v1/charts/config */
  @Get("config")
  config() {
    return this.charts.config();
  }

  /** GET /api/v1/charts/time */
  @Get("time")
  time() {
    return this.charts.time();
  }

  /** GET /api/v1/charts/symbols?symbol=<tokenAddress> */
  @Get("symbols")
  symbols(@Query("symbol") symbol: string) {
    return this.charts.symbols(symbol);
  }

  /**
   * GET /api/v1/charts/history
   *   ?symbol=<tokenAddress>
   *   &resolution=1|5|15|30|60|240|D
   *   &from=<unix>
   *   &to=<unix>
   *   &countback=<n>
   */
  @Get("history")
  history(@Query() query: Record<string, string>) {
    return this.charts.history(query);
  }

  /** GET /api/v1/charts/search?query=<addr>&limit=10 */
  @Get("search")
  search(@Query() query: Record<string, string>) {
    return this.charts.search(query);
  }
}
