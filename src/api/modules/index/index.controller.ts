import { Controller, Get } from "@nestjs/common";

/**
 * Route index — returns a summary of available API route groups.
 * Accessible at GET /api/v1
 */
@Controller()
export class IndexController {
  @Get()
  index() {
    return {
      service: "onememe-launchpad-api",
      version: "v1",
      routes: [
        { group: "tokens",      prefix: "/api/v1/tokens" },
        { group: "trades",      prefix: "/api/v1/trades" },
        { group: "migrations",  prefix: "/api/v1/migrations" },
        { group: "stats",       prefix: "/api/v1/stats" },
        { group: "quotes",      prefix: "/api/v1/tokens/:address/quote" },
        { group: "activity",    prefix: "/api/v1/activity" },
        { group: "discover",    prefix: "/api/v1/discover" },
        { group: "leaderboard", prefix: "/api/v1/leaderboard" },
        { group: "price",       prefix: "/api/v1/price" },
        { group: "charts",      prefix: "/api/v1/charts" },
        { group: "chat",        prefix: "/api/v1/chat" },
        { group: "upload",      prefix: "/api/v1/metadata/upload" },
        { group: "health",      prefix: "/health" },
      ],
    };
  }
}
