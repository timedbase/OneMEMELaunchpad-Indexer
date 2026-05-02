import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { sql } from "../../db";
import { isAddress } from "../../helpers";

const MAX_MESSAGES_PER_TOKEN = 200;
const MAX_TEXT_LENGTH        = 500;
const DEFAULT_HISTORY_LIMIT  = 50;
const MAX_HISTORY_LIMIT      = 200;

export interface ChatMessage {
  id:        string;
  token:     string;
  sender:    string;
  text:      string;
  timestamp: number;
}

@Injectable()
export class ChatService implements OnModuleInit {
  private readonly logger = new Logger(ChatService.name);

  /**
   * Create the chat_message table if it doesn't exist.
   * Off-chain user content — stored in PostgreSQL independently of the subgraph.
   */
  async onModuleInit() {
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS chat_message (
          id        BIGSERIAL    PRIMARY KEY,
          token     TEXT         NOT NULL,
          sender    TEXT         NOT NULL,
          text      TEXT         NOT NULL,
          timestamp BIGINT       NOT NULL
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS chat_message_token_ts
          ON chat_message (token, timestamp DESC)
      `;
      this.logger.log("Chat table ready");
    } catch (err: unknown) {
      this.logger.error(`Failed to initialize chat table: ${String(err)}`);
    }
  }

  /** Fetch the most recent messages for a token (oldest-first for display). */
  async history(token: string, limitRaw?: number): Promise<ChatMessage[]> {
    if (!isAddress(token)) return [];

    const limit = Math.min(
      isFinite(limitRaw as number) && (limitRaw as number) > 0
        ? Math.floor(limitRaw as number)
        : DEFAULT_HISTORY_LIMIT,
      MAX_HISTORY_LIMIT,
    );

    const rows = await sql`
      SELECT id::text, token, sender, text, timestamp::int
      FROM (
        SELECT * FROM chat_message
        WHERE token = ${token.toLowerCase()}
        ORDER BY timestamp DESC
        LIMIT ${limit}
      ) sub
      ORDER BY timestamp ASC
    `;
    return rows as unknown as ChatMessage[];
  }

  /** Persist a new message and prune old ones so storage stays bounded. */
  async save(token: string, sender: string, text: string): Promise<ChatMessage | null> {
    const clean = [...text.trim()].slice(0, MAX_TEXT_LENGTH).join("");
    if (!clean) return null;

    const now       = Math.floor(Date.now() / 1000);
    const tokenAddr = token.toLowerCase();

    // Single atomic statement: insert + prune in one round-trip, no race condition.
    const rows = await sql`
      WITH inserted AS (
        INSERT INTO chat_message (token, sender, text, timestamp)
        VALUES (${tokenAddr}, ${sender.toLowerCase()}, ${clean}, ${now})
        RETURNING id::text, token, sender, text, timestamp::int
      ),
      pruned AS (
        DELETE FROM chat_message
        WHERE token = ${tokenAddr}
          AND id < (
            SELECT MIN(id) FROM (
              SELECT id FROM chat_message
              WHERE token = ${tokenAddr}
              ORDER BY id DESC
              LIMIT ${MAX_MESSAGES_PER_TOKEN}
            ) top
          )
      )
      SELECT * FROM inserted
    `;

    return (rows[0] ?? null) as ChatMessage | null;
  }
}
