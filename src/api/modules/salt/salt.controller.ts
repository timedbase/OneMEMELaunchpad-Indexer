import {
  Controller,
  Get,
  Param,
  NotFoundException,
  BadRequestException,
  Sse,
  MessageEvent,
} from "@nestjs/common";
import { Observable, map } from "rxjs";
import { SaltService } from "./salt.service";
import { isAddress } from "../../helpers";

@Controller("salt")
export class SaltController {
  constructor(private readonly salt: SaltService) {}

  /**
   * GET /api/v1/salt/:address
   *
   * Returns the current session result — may be partial (some types still
   * mining) or complete (all three types found).
   * Returns 404 if no session has been started for this address yet.
   */
  @Get(":address")
  getResult(@Param("address") address: string) {
    if (!isAddress(address)) throw new BadRequestException("Invalid Ethereum address");

    const result = this.salt.getResult(address);
    if (!result) {
      throw new NotFoundException(
        "No salt session for this address. " +
        "Open GET /api/v1/salt/:address/stream to start mining.",
      );
    }

    return { data: result };
  }

  /**
   * GET /api/v1/salt/:address/stream
   *
   * SSE stream. Every connection starts a fresh mine across all three token
   * types (Standard, Tax, Reflection) in parallel. Worker threads are killed
   * immediately when the client disconnects.
   *
   * Events:
   *   { type: "progress", tokenType: "Standard"|"Tax"|"Reflection", attempts: number }
   *   { type: "found",    tokenType: "Standard"|"Tax"|"Reflection", attempts: number, salt: "0x...", predictedAddress: "0x..." }
   *
   * Stream completes once all three types have been found.
   */
  @Sse(":address/stream")
  stream(@Param("address") address: string): Observable<MessageEvent> {
    if (!isAddress(address)) throw new BadRequestException("Invalid Ethereum address");

    return this.salt
      .startMining(address)
      .pipe(map(event => ({ data: event }) as MessageEvent));
  }
}
