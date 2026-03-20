import { Controller, Get, Query } from "@nestjs/common";
import { LeaderboardService } from "./leaderboard.service";

@Controller("leaderboard")
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  @Get("users")
  users(@Query() query: Record<string, string>) {
    return this.leaderboard.users(query);
  }

  @Get("tokens")
  tokens(@Query() query: Record<string, string>) {
    return this.leaderboard.tokens(query);
  }

  @Get("creators")
  creators(@Query() query: Record<string, string>) {
    return this.leaderboard.creators(query);
  }

  @Get("traders")
  traders(@Query() query: Record<string, string>) {
    return this.leaderboard.traders(query);
  }
}
