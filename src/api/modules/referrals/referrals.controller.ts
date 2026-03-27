import { Controller, Get, Post, Param, Body, BadRequestException, NotFoundException } from "@nestjs/common";
import { ReferralsService } from "./referrals.service";
import { isAddress } from "../../helpers";

@Controller("referrals")
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  /**
   * POST /api/v1/:chain/referrals/register
   *
   * Register a referral before the referred wallet earns its first points.
   * Body: { "wallet": "0x...", "referrer": "0x..." }
   */
  @Post("register")
  async register(@Body() body: Record<string, unknown>) {
    const wallet   = typeof body["wallet"]   === "string" ? body["wallet"]   : null;
    const referrer = typeof body["referrer"] === "string" ? body["referrer"] : null;

    if (!wallet)   throw new BadRequestException("wallet is required");
    if (!referrer) throw new BadRequestException("referrer is required");

    const result = await this.referrals.register(wallet, referrer);
    return { data: result };
  }

  /**
   * GET /api/v1/:chain/referrals/:wallet
   *
   * Returns referral stats for a wallet acting as a referrer —
   * how many users they referred, how many have been credited, and bonus points earned.
   */
  @Get(":wallet")
  async stats(@Param("wallet") wallet: string) {
    if (!isAddress(wallet)) throw new BadRequestException("Invalid wallet address");
    const result = await this.referrals.stats(wallet);
    if (!result) throw new NotFoundException("Referrer not found");
    return { data: result };
  }
}
