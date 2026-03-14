import { Controller, Get, Query } from "@nestjs/common";
import { FactoryService } from "./factory.service";

@Controller("factory")
export class FactoryController {
  constructor(private readonly factory: FactoryService) {}

  /** GET /api/v1/factory/events */
  @Get("events")
  events(@Query() query: Record<string, string>) {
    return this.factory.events(query);
  }
}
