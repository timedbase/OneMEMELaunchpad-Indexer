import { Controller, Get, Query } from "@nestjs/common";
import { ChartsService } from "./charts.service";

/**
 * Chart data endpoints for TradingView Lightweight Charts.
 *
 * Base path: GET /api/v1/{chain}/charts/*
 *
 * Primary endpoint for the frontend chart:
 *   GET /history  — OHLCV bar array, consumed directly by Lightweight Charts
 *
 * The /config, /symbols, /search, and /time endpoints implement the TradingView
 * UDF (Universal Data Feed) protocol used by the full TradingView Advanced
 * Charts widget. They are NOT called by Lightweight Charts automatically but are
 * kept for potential future use with the Advanced Charts embed.
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
