import { Controller, Get, Param } from "@nestjs/common";
import { ChatService } from "./chat.service";

@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** GET /api/v1/chat/:token/messages — last 50 messages, oldest-first */
  @Get(":token/messages")
  async messages(@Param("token") token: string) {
    const messages = await this.chat.history(token);
    return { data: messages };
  }
}
