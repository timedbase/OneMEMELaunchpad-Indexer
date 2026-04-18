import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";

import { HealthController }    from "./health.controller";
import { IndexModule }         from "./modules/index/index.module";
import { TokensModule }        from "./modules/tokens/tokens.module";
import { TradesModule }        from "./modules/trades/trades.module";
import { MigrationsModule }    from "./modules/migrations/migrations.module";
import { StatsModule }         from "./modules/stats/stats.module";
import { QuotesModule }        from "./modules/quotes/quotes.module";
import { ActivityModule }      from "./modules/activity/activity.module";
import { DiscoverModule }      from "./modules/discover/discover.module";
import { UploadModule }        from "./modules/upload/upload.module";
import { LeaderboardModule }   from "./modules/leaderboard/leaderboard.module";
import { ChartsModule }        from "./modules/charts/charts.module";
import { PriceModule }         from "./modules/price/price.module";
import { ChatModule }          from "./modules/chat/chat.module";
import { VestingModule }       from "./modules/vesting/vesting.module";
import { PointsModule }        from "./modules/points/points.module";
import { ReferralsModule }     from "./modules/referrals/referrals.module";
import { DexModule }           from "./modules/dex/dex.module";

import {
  QuoteRateLimitMiddleware,
  StatsRateLimitMiddleware,
  ListRateLimitMiddleware,
  PostRateLimitMiddleware,
} from "./common/rate-limit.middleware";

@Module({
  imports: [
    IndexModule,
    TokensModule,
    TradesModule,
    MigrationsModule,
    StatsModule,
    QuotesModule,
    ActivityModule,
    DiscoverModule,
    UploadModule,
    LeaderboardModule,
    ChartsModule,
    PriceModule,
    ChatModule,
    VestingModule,
    PointsModule,
    ReferralsModule,
    DexModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Quote routes — 20 req/min (each triggers a live RPC call to BSC)
    consumer
      .apply(QuoteRateLimitMiddleware)
      .forRoutes({ path: "tokens/*/quote/*", method: RequestMethod.GET });

    // Stats — 10 req/min (runs 6 parallel aggregation queries)
    consumer
      .apply(StatsRateLimitMiddleware)
      .forRoutes({ path: "stats", method: RequestMethod.GET });

    // Default — 60 req/min for everything else
    // Applied last; quote/stats middleware already ran for their routes.
    consumer
      .apply(ListRateLimitMiddleware)
      .forRoutes({ path: "*", method: RequestMethod.GET });

    // POST endpoints — 10 req/min per IP (referral registration)
    consumer
      .apply(PostRateLimitMiddleware)
      .forRoutes({ path: "*", method: RequestMethod.POST });
  }
}
