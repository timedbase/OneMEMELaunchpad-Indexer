import { Controller, Get } from "@nestjs/common";

/**
 * Route index — returns a summary of available API route groups.
 * Accessible at GET /api/v1/<chain>
 */
@Controller()
export class IndexController {
  @Get()
  index() {
    const chain = process.env.CHAIN_SLUG ?? "bsc";
    const base  = `/api/v1/${chain}`;
    return {
      service: "onememe-launchpad-api",
      version: "v1",
      chain,
      routes: [
        { group: "tokens",      prefix: `${base}/tokens` },
        { group: "trades",      prefix: `${base}/trades` },
        { group: "migrations",  prefix: `${base}/migrations` },
        { group: "stats",       prefix: `${base}/stats` },
        { group: "quotes",      prefix: `${base}/tokens/:address/quote` },
        { group: "activity",    prefix: `${base}/activity` },
        { group: "discover",    prefix: `${base}/discover` },
        { group: "leaderboard", prefix: `${base}/leaderboard` },
        { group: "vesting",     prefix: `${base}/vesting` },
        { group: "price",       prefix: `${base}/price` },
        { group: "charts",      prefix: `${base}/charts` },
        { group: "chat",        prefix: `${base}/chat` },
        { group: "upload",      prefix: `${base}/metadata/upload` },
        { group: "health",      prefix: "/health" },
      ],
    };
  }
}
