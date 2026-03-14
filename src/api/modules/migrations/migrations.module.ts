import { Module } from "@nestjs/common";
import { MigrationsController } from "./migrations.controller";
import { MigrationsService }    from "./migrations.service";

@Module({
  controllers: [MigrationsController],
  providers:   [MigrationsService],
})
export class MigrationsModule {}
