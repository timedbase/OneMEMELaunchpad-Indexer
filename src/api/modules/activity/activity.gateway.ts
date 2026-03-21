/**
 * Activity WebSocket Gateway
 *
 * Provides a real-time WSS feed of create/buy/sell events.
 *
 * Connection URL:
 *   ws://localhost:3001/api/v1/activity/ws   (HTTP mode)
 *   wss://localhost:3001/api/v1/activity/ws  (HTTPS/TLS mode)
 *
 * Optional query params on connect:
 *   type   "create" | "buy" | "sell"  — filter by event type
 *   token  0x-address                 — filter by token
 *
 * Message format (JSON):
 *   { event: "activity",  data: { eventType, token, actor, bnbAmount,
 *                                  tokenAmount, blockNumber, timestamp, txHash } }
 *   { event: "keepalive", data: "" }
 *
 * Example (browser):
 *   const ws = new WebSocket("wss://api.1coin.meme/api/v1/activity/ws?type=buy");
 *   ws.onmessage = (e) => console.log(JSON.parse(e.data));
 */

import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { IncomingMessage } from "node:http";
import type { Server, WebSocket } from "ws";
import { ActivityService, VALID_TYPES } from "./activity.service";

const POLL_MS      = 2_000;
const KEEPALIVE_MS = 15_000;
const WS_OPEN      = 1; // WebSocket.OPEN constant

interface ConnState {
  typeFilter?:  string;
  tokenFilter?: string;
  lastBlock:    bigint;
  poll:         ReturnType<typeof setInterval>;
  keepalive:    ReturnType<typeof setInterval>;
}

@WebSocketGateway({ path: "/api/v1/activity/ws" })
export class ActivityGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly connections = new Map<WebSocket, ConnState>();

  constructor(private readonly activity: ActivityService) {}

  async handleConnection(client: WebSocket, req: IncomingMessage): Promise<void> {
    const url         = new URL(req.url ?? "/", "http://localhost");
    const typeFilter  = url.searchParams.get("type")  ?? undefined;
    const tokenFilter = url.searchParams.get("token") ?? undefined;

    if (typeFilter && !VALID_TYPES.has(typeFilter)) {
      client.send(JSON.stringify({ event: "error", data: `Invalid type: ${typeFilter}` }));
      client.close();
      return;
    }

    const lastBlock = await this.activity.latestBlock();

    // Guard: client may have disconnected during the latestBlock() await.
    // If so, nothing is in the connections map yet — just bail out.
    if ((client as unknown as { readyState: number }).readyState !== WS_OPEN) return;

    // Send initial snapshot so the feed isn't empty on first connect.
    try {
      const snapshot = await this.activity.query({
        typeFilter,
        token:  tokenFilter,
        limit:  20,
        offset: 0,
      });
      if ((client as unknown as { readyState: number }).readyState === WS_OPEN) {
        for (const row of [...snapshot].reverse()) {
          client.send(JSON.stringify({ event: "activity", data: JSON.stringify(row) }));
        }
      }
    } catch { /* non-fatal — connection stays open */ }

    // Guard again after snapshot query (may have taken time).
    if ((client as unknown as { readyState: number }).readyState !== WS_OPEN) return;

    const keepalive = setInterval(() => {
      if ((client as unknown as { readyState: number }).readyState === WS_OPEN) {
        client.send(JSON.stringify({ event: "keepalive", data: "" }));
      }
    }, KEEPALIVE_MS);

    const state: ConnState = { typeFilter, tokenFilter, lastBlock, keepalive, poll: null! };

    state.poll = setInterval(async () => {
      if ((client as unknown as { readyState: number }).readyState !== WS_OPEN) return;
      try {
        const rows = await this.activity.query({
          typeFilter:  state.typeFilter,
          token:       state.tokenFilter,
          sinceBlock:  state.lastBlock,
          limit:       50,
          offset:      0,
        });

        if (rows.length > 0) {
          for (const row of rows) {
            const b = BigInt(row.blockNumber as string);
            if (b > state.lastBlock) state.lastBlock = b;
          }
          for (const row of [...rows].reverse()) {
            client.send(JSON.stringify({ event: "activity", data: JSON.stringify(row) }));
          }
        }
      } catch { /* keep alive on DB errors */ }
    }, POLL_MS);

    this.connections.set(client, state);
  }

  handleDisconnect(client: WebSocket): void {
    const state = this.connections.get(client);
    if (state) {
      clearInterval(state.poll);
      clearInterval(state.keepalive);
      this.connections.delete(client);
    }
  }
}
