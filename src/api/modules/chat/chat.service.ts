import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { sql } from "../../db";

const MAX_MESSAGES_PER_TOKEN = 200;
const MAX_TEXT_LENGTH        = 500;
const HISTORY_LIMIT          = 50;

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

  /** Create the chat_message table if it doesn't exist.
   *  This table is off-chain user content — not part of Ponder's schema. */
  async onModuleInit() {
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
  }

  /** Fetch the most recent messages for a token (oldest-first for display). */
  async history(token: string): Promise<ChatMessage[]> {
    const rows = await sql`
      SELECT id::text, token, sender, text, timestamp::int
      FROM (
        SELECT * FROM chat_message
        WHERE token = ${token.toLowerCase()}
        ORDER BY timestamp DESC
        LIMIT ${HISTORY_LIMIT}
      ) sub
      ORDER BY timestamp ASC
    `;
    return rows as ChatMessage[];
  }

  /** Persist a new message and prune old ones so storage stays bounded. */
  async save(token: string, sender: string, text: string): Promise<ChatMessage | null> {
    const clean = text.trim().slice(0, MAX_TEXT_LENGTH);
    if (!clean) return null;

    const now = Math.floor(Date.now() / 1000);

    const [row] = await sql`
      INSERT INTO chat_message (token, sender, text, timestamp)
      VALUES (${token.toLowerCase()}, ${sender.toLowerCase()}, ${clean}, ${now})
      RETURNING id::text, token, sender, text, timestamp::int
    `;

    // Prune oldest messages beyond the cap (fire-and-forget)
    sql`
      DELETE FROM chat_message
      WHERE token = ${token.toLowerCase()}
        AND id NOT IN (
          SELECT id FROM chat_message
          WHERE token = ${token.toLowerCase()}
          ORDER BY timestamp DESC
          LIMIT ${MAX_MESSAGES_PER_TOKEN}
        )
    `.catch((err: Error) => this.logger.warn(`Chat prune failed: ${err.message}`));

    return row as ChatMessage;
  }
}
