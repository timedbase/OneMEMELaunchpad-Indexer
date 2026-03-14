import { Controller, Get, Query } from "@nestjs/common";
import { LeaderboardService } from "./leaderboard.service";

@Controller("leaderboard")
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  /**
   * GET /api/v1/leaderboard/traders
   *
   * Returns traders ranked by total BNB trading volume.
   *
   * Query params:
   *   period   "alltime" | "1d" | "7d" | "30d"  (default: alltime)
   *   page     number  (default: 1)
   *   limit    number  (default: 50, max: 100)
   *
   * Response per entry:
   *   address        trader wallet address
   *   volumeBNB      total BNB traded (buys + sells, wei string)
   *   tradeCount     total number of trades
   *   buyCount       number of buys
   *   sellCount      number of sells
   *   tokensTraded   number of distinct tokens traded
   *   lastTradeAt    unix timestamp of most recent trade
   */
  @Get("traders")
  traders(@Query() query: Record<string, string>) {
    return this.leaderboard.traders(query);
  }
}
