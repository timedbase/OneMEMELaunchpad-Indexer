import { Controller, Get, Param, Query } from "@nestjs/common";
import { ChatService } from "./chat.service";

@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /**
   * GET /api/v1/chat/:token/messages
   *
   * Returns the most recent messages for a token, oldest-first.
   * ?limit=N  — number of messages to return (default 50, max 200)
   */
  @Get(":token/messages")
  async messages(
    @Param("token") token: string,
    @Query("limit") limitParam?: string,
  ) {
    const limit    = limitParam ? parseInt(limitParam, 10) : undefined;
    const messages = await this.chat.history(token, limit);
    return { data: messages };
  }
}
