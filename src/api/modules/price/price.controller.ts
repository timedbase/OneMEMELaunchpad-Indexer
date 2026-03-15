import { Controller, Get } from "@nestjs/common";
import { PriceService } from "./price.service";

@Controller("price")
export class PriceController {
  constructor(private readonly price: PriceService) {}

  /**
   * GET /api/v1/price/bnb
   *
   * Returns the aggregated BNB/USDT price averaged across Binance, OKX, and Bybit.
   * Refreshed every 10 seconds. Use this to convert all BNB wei amounts to USD
   * on the frontend.
   *
   * Response:
   *   bnbUsdt    — aggregated price (average of available sources)
   *   sources    — per-exchange breakdown
   *   updatedAt  — unix timestamp of last successful fetch
   *   stale      — true if all exchanges failed on last refresh (cached value returned)
   */
  @Get("bnb")
  bnb() {
    return this.price.getPrice();
  }
}
