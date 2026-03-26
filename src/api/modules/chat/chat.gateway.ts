/**
 * Chat WebSocket Gateway
 *
 * One persistent connection per browser tab. Clients subscribe to a token
 * room, then send and receive messages scoped to that token address.
 *
 * Connection URL:
 *   wss://api.1coin.meme/api/v1/bsc/chat/ws
 *
 * Protocol (JSON frames):
 *
 *   Client → server:
 *     { type: "subscribe", token: "0x..." }          — join a token room
 *     { type: "message",   sender: "0x...",
 *                          text:   "hello" }         — send a message
 *
 *   Server → client:
 *     { type: "history",   messages: [...] }         — sent after subscribe
 *     { type: "message",   id, token, sender,
 *                          text, timestamp }         — new message broadcast
 *     { type: "error",     message: "..." }          — validation / rate-limit
 *     { type: "keepalive" }                          — 15 s heartbeat
 */

import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { IncomingMessage } from "node:http";
import type { Server, WebSocket } from "ws";
import { ChatService } from "./chat.service";
import { isAddress } from "../../helpers";

const KEEPALIVE_MS          = 15_000;
const RATE_LIMIT_MS         = 3_000;   // minimum gap between messages per IP (global)
const MAX_CONNS_PER_IP      = 5;
const MSG_WINDOW_MS         = 60_000;  // rolling window for per-token per-IP rate limit
const MAX_MSGS_PER_WINDOW   = 5;       // max messages per IP per token per minute

interface ConnState {
  token:     string | null;
  ip:        string;
  keepalive: ReturnType<typeof setInterval>;
}

function clientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return (Array.isArray(xff) ? xff[0] : xff).split(",")[0].trim();
  const xri = req.headers["x-real-ip"];
  if (xri) return (Array.isArray(xri) ? xri[0] : xri).trim();
  return (req.socket as { remoteAddress?: string }).remoteAddress ?? "unknown";
}

function send(client: WebSocket, payload: object) {
  if ((client as unknown as { readyState: number }).readyState === 1 /* OPEN */) {
    client.send(JSON.stringify(payload));
  }
}

const chainSlug = process.env.CHAIN_SLUG ?? "bsc";
@WebSocketGateway({ path: `/api/v1/${chainSlug}/chat/ws` })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly connections = new Map<WebSocket, ConnState>();

  // Token → set of subscribed clients for O(1) broadcast.
  private readonly rooms = new Map<string, Set<WebSocket>>();

  // Per-IP rate limiting: tracks the timestamp of the last accepted message.
  private readonly lastMsg = new Map<string, number>();

  // Per-IP per-token rate limiting: tracks message timestamps within the rolling window.
  // Key: `${ip}:${token}`, value: array of accepted message timestamps (ms).
  private readonly tokenMsgTimestamps = new Map<string, number[]>();

  constructor(private readonly chat: ChatService) {
    // Purge stale rate-limit state every 5 minutes to prevent unbounded map growth.
    setInterval(() => {
      const cutoff = Date.now() - MSG_WINDOW_MS;
      for (const [key, timestamps] of this.tokenMsgTimestamps) {
        const fresh = timestamps.filter(ts => ts > cutoff);
        if (fresh.length === 0) this.tokenMsgTimestamps.delete(key);
        else this.tokenMsgTimestamps.set(key, fresh);
      }
      const globalCutoff = Date.now() - RATE_LIMIT_MS;
      for (const [ip, ts] of this.lastMsg) {
        if (ts < globalCutoff) this.lastMsg.delete(ip);
      }
    }, 5 * 60_000).unref();
  }

  async handleConnection(client: WebSocket, req: IncomingMessage): Promise<void> {
    const ip = clientIp(req);

    const ipConns = [...this.connections.values()].filter(s => s.ip === ip).length;
    if (ipConns >= MAX_CONNS_PER_IP) {
      client.close(1008, "Too many connections");
      return;
    }

    const keepalive = setInterval(() => {
      send(client, { type: "keepalive" });
    }, KEEPALIVE_MS);

    this.connections.set(client, { token: null, ip, keepalive });

    client.on("message", (raw) => {
      void this.handleFrame(client, ip, raw.toString());
    });
  }

  handleDisconnect(client: WebSocket): void {
    const state = this.connections.get(client);
    if (state) {
      clearInterval(state.keepalive);
      if (state.token) {
        const room = this.rooms.get(state.token);
        if (room) { room.delete(client); if (room.size === 0) this.rooms.delete(state.token); }
      }
      this.connections.delete(client);
    }
  }

  // ─── Frame handler ─────────────────────────────────────────────────────────

  private async handleFrame(client: WebSocket, ip: string, raw: string): Promise<void> {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw);
    } catch {
      send(client, { type: "error", message: "Invalid JSON" });
      return;
    }

    try {
      switch (frame["type"]) {
        case "subscribe": return await this.onSubscribe(client, frame);
        case "message":   return await this.onMessage(client, ip, frame);
        default:
          send(client, { type: "error", message: `Unknown type: ${String(frame["type"])}` });
      }
    } catch {
      send(client, { type: "error", message: "Internal error — please try again" });
    }
  }

  // ─── Subscribe ─────────────────────────────────────────────────────────────

  private async onSubscribe(client: WebSocket, frame: Record<string, unknown>): Promise<void> {
    const token = typeof frame["token"] === "string" ? frame["token"].toLowerCase() : null;

    if (!token || !isAddress(token)) {
      send(client, { type: "error", message: "subscribe.token must be a valid address" });
      return;
    }

    const state = this.connections.get(client);
    if (state) {
      // Leave previous room if re-subscribing to a different token.
      if (state.token && state.token !== token) {
        const prev = this.rooms.get(state.token);
        if (prev) { prev.delete(client); if (prev.size === 0) this.rooms.delete(state.token); }
      }
      state.token = token;
    }

    // Join room.
    if (!this.rooms.has(token)) this.rooms.set(token, new Set());
    this.rooms.get(token)!.add(client);

    const messages = await this.chat.history(token);
    send(client, { type: "history", messages });
  }

  // ─── Send message ──────────────────────────────────────────────────────────

  private async onMessage(client: WebSocket, ip: string, frame: Record<string, unknown>): Promise<void> {
    const state = this.connections.get(client);
    if (!state?.token) {
      send(client, { type: "error", message: "Subscribe to a token before sending messages" });
      return;
    }

    // Rate limit: 1 message per 3 seconds per IP (global cooldown)
    const now  = Date.now();
    const last = this.lastMsg.get(ip) ?? 0;
    const wait = Math.ceil((last + RATE_LIMIT_MS - now) / 1_000);
    if (now - last < RATE_LIMIT_MS) {
      send(client, { type: "error", message: `Slow down — wait ${wait}s before sending again` });
      return;
    }
    this.lastMsg.set(ip, now);

    // Rate limit: max 5 messages per minute per IP per token
    const tokenKey   = `${ip}:${state.token}`;
    const timestamps = (this.tokenMsgTimestamps.get(tokenKey) ?? [])
      .filter(ts => now - ts < MSG_WINDOW_MS);
    if (timestamps.length >= MAX_MSGS_PER_WINDOW) {
      send(client, {
        type:    "error",
        message: `Rate limit exceeded — max ${MAX_MSGS_PER_WINDOW} messages per minute per token`,
      });
      return;
    }
    timestamps.push(now);
    this.tokenMsgTimestamps.set(tokenKey, timestamps);

    // Validate sender address
    const sender = typeof frame["sender"] === "string" ? frame["sender"] : null;
    if (!sender || !isAddress(sender)) {
      send(client, { type: "error", message: "message.sender must be a valid wallet address" });
      return;
    }

    // Validate text
    const text = typeof frame["text"] === "string" ? frame["text"].trim() : "";
    if (!text) {
      send(client, { type: "error", message: "message.text cannot be empty" });
      return;
    }
    if (text.length > 500) {
      send(client, { type: "error", message: "message.text cannot exceed 500 characters" });
      return;
    }

    const msg = await this.chat.save(state.token, sender, text);
    if (!msg) return;

    // Broadcast to all clients in the room — O(1) lookup via rooms map.
    const room = this.rooms.get(state.token);
    if (room) {
      for (const ws of room) send(ws, { type: "message", ...msg });
    }
  }
}
