import { Controller, Get } from "@nestjs/common";
import { PriceService } from "./price.service";

@Controller("price")
export class PriceController {
  constructor(private readonly price: PriceService) {}

  /**
   * GET /api/v1/price/bnb
   *
   * Returns the BNB/USDT price averaged from CoinGecko and the PancakeSwap
   * WBNB/USDT on-chain pair. Refreshed every 10 seconds.
   *
   * Response:
   *   bnbUsdt    — averaged price
   *   sources    — per-source breakdown (CoinGecko, PancakeSwap)
   *   updatedAt  — unix timestamp of last successful fetch
   *   stale      — true if all sources failed on last refresh (cached value returned)
   */
  @Get("bnb")
  bnb() {
    return this.price.getPrice();
  }
}
