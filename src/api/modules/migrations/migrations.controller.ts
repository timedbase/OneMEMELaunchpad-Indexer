import { Controller, Get, Query } from "@nestjs/common";
import { MigrationsService } from "./migrations.service";

@Controller("migrations")
export class MigrationsController {
  constructor(private readonly migrations: MigrationsService) {}

  /** GET /api/v1/migrations */
  @Get()
  list(@Query() query: Record<string, string>) {
    return this.migrations.list(query);
  }
}
