/**
 * Activity feed controller
 *
 * GET /api/v1/activity           Paginated unified create/buy/sell feed
 * GET /api/v1/activity/stream    Server-Sent Events (SSE) real-time push
 *
 * The SSE endpoint uses RxJS Observable — NestJS serialises each emitted
 * value as an SSE `data:` frame automatically.
 */

import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
  Sse,
} from "@nestjs/common";
import type { Response } from "express";
import { Observable } from "rxjs";
import { ActivityService, VALID_TYPES } from "./activity.service";

const POLL_MS      = 2_000;
const KEEPALIVE_MS = 15_000;

@Controller("activity")
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /** GET /api/v1/activity */
  @Get()
  list(@Query() query: Record<string, string>) {
    const type = query["type"];
    if (type && !VALID_TYPES.has(type)) {
      throw new BadRequestException(`Invalid type. Must be one of: ${[...VALID_TYPES].join(", ")}`);
    }
    return this.activity.list(query);
  }

  /**
   * GET /api/v1/activity/stream
   *
   * SSE — pushes new create/buy/sell events as they are indexed.
   * Client usage (browser):
   *   const es = new EventSource("/api/v1/activity/stream");
   *   es.addEventListener("activity", e => console.log(JSON.parse(e.data)));
   */
  @Sse("stream")
  stream(
    @Query() query: Record<string, string>,
    @Res({ passthrough: true }) res: Response,
  ): Observable<MessageEvent> {
    // SSE connections are long-lived — disable compression and timeouts.
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    const typeFilter  = query["type"];
    const tokenFilter = query["token"];

    if (typeFilter && !VALID_TYPES.has(typeFilter)) {
      throw new BadRequestException(`Invalid type. Must be one of: ${[...VALID_TYPES].join(", ")}`);
    }

    return new Observable<MessageEvent>((subscriber) => {
      let lastBlock   = 0n;
      let pollTimer:      ReturnType<typeof setInterval> | null = null;
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
      let destroyed   = false;

      const cleanup = () => {
        destroyed = true;
        if (pollTimer)      clearInterval(pollTimer);
        if (keepaliveTimer) clearInterval(keepaliveTimer);
      };

      // Seed with current max block so we only push NEW events after the snapshot.
      this.activity.latestBlock().then(async (block) => {
        if (destroyed) return;
        lastBlock = block;

        // Emit an initial snapshot so the feed isn't empty on first connect.
        try {
          const snapshot = await this.activity.query({
            typeFilter,
            token:  tokenFilter,
            limit:  20,
            offset: 0,
          });
          if (!destroyed) {
            for (const row of [...snapshot].reverse()) {
              subscriber.next({ type: "activity", data: JSON.stringify(row) } as MessageEvent);
            }
          }
        } catch { /* non-fatal — stream stays open */ }

        // Keepalive: prevents proxy / browser from closing idle connection.
        keepaliveTimer = setInterval(() => {
          if (destroyed) return;
          subscriber.next({ type: "keepalive", data: "" } as MessageEvent);
        }, KEEPALIVE_MS);

        // Poll for new events.
        pollTimer = setInterval(async () => {
          if (destroyed) return;
          try {
            const rows = await this.activity.query({
              typeFilter,
              token:      tokenFilter,
              sinceBlock: lastBlock,
              limit:      50,
              offset:     0,
            });

            if (rows.length > 0) {
              for (const row of rows) {
                const b = BigInt(row.blockNumber as string);
                if (b > lastBlock) lastBlock = b;
              }
              // Emit oldest-first so clients process events in order.
              for (const row of [...rows].reverse()) {
                subscriber.next({
                  type: "activity",
                  data: JSON.stringify(row),
                } as MessageEvent);
              }
            }
          } catch {
            // DB error — keep the stream open, try again next tick.
          }
        }, POLL_MS);
      }).catch(() => subscriber.error(new Error("Failed to seed SSE stream")));

      // Returned function is called when client disconnects.
      return cleanup;
    });
  }
}
