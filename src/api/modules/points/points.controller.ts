import {
  Controller, Get, Param, Query, Headers,
  NotFoundException, BadRequestException, UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { PointsService } from "./points.service";
import { isAddress } from "../../helpers";

@Controller("points")
export class PointsController {
  constructor(private readonly points: PointsService) {}

  /**
   * GET /api/v1/:chain/points/leaderboard
   *
   * Top wallets ranked by total points.
   * Supports standard ?page=&limit= pagination.
   */
  @Get("leaderboard")
  async leaderboard(@Query() query: Record<string, string | undefined>) {
    return this.points.leaderboard(query);
  }

  /**
   * GET /api/v1/:chain/points/export
   *
   * Internal endpoint — requires X-Admin-Key header matching ADMIN_SECRET env var.
   * Returns every wallet's full point summary for reward issuance.
   * Respects POINTS_START_BLOCK — only events at or after that block are included.
   */
  @Get("export")
  async export(@Headers("x-admin-key") adminKey: string | undefined) {
    const secret = process.env.ADMIN_SECRET;
    if (!secret) {
      throw new UnauthorizedException("Export endpoint is disabled (ADMIN_SECRET not set)");
    }
    // Constant-time comparison to prevent timing-based key enumeration.
    const provided = adminKey ?? "";
    const valid =
      provided.length === secret.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
    if (!valid) {
      throw new UnauthorizedException("Invalid admin key");
    }
    return this.points.exportAll();
  }

  /**
   * GET /api/v1/:chain/points/:wallet
   *
   * Returns a wallet's total points and per-event-type breakdown.
   */
  @Get(":wallet")
  async wallet(@Param("wallet") wallet: string) {
    if (!isAddress(wallet)) throw new BadRequestException("Invalid wallet address");
    const result = await this.points.getWallet(wallet);
    if (!result) throw new NotFoundException("Wallet not found");
    return { data: result };
  }
}
