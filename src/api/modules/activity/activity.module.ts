import { Module } from "@nestjs/common";
import { ActivityController } from "./activity.controller";
import { ActivityGateway }    from "./activity.gateway";
import { ActivityService }    from "./activity.service";

@Module({
  controllers: [ActivityController],
  providers:   [ActivityService, ActivityGateway],
})
export class ActivityModule {}
