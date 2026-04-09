import { Injectable, OnModuleInit, Logger, BadRequestException, ConflictException } from "@nestjs/common";
import { sql } from "../../db";
import { subgraphFetch } from "../../subgraph";
import { isAddress } from "../../helpers";
import { POINTS } from "../points/points.service";

@Injectable()
export class ReferralsService implements OnModuleInit {
  private readonly logger = new Logger(ReferralsService.name);

  async onModuleInit() {
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS referral (
          wallet        TEXT PRIMARY KEY,
          referrer      TEXT    NOT NULL,
          registered_at BIGINT  NOT NULL,
          credited      BOOLEAN NOT NULL DEFAULT FALSE
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS referral_referrer_idx ON referral (referrer)`;
      this.logger.log("Referral table ready");
    } catch (err: unknown) {
      this.logger.error(`Failed to initialise referral table: ${(err as Error).message}`);
    }
  }

  /**
   * Register a referral relationship.
   * Must be called before the referred wallet earns its first points.
   * Self-referral is rejected. Duplicate registration is rejected.
   */
  async register(wallet: string, referrer: string): Promise<{ wallet: string; referrer: string }> {
    if (!isAddress(wallet))   throw new BadRequestException("Invalid wallet address");
    if (!isAddress(referrer)) throw new BadRequestException("Invalid referrer address");

    const w = wallet.toLowerCase();
    const r = referrer.toLowerCase();

    if (w === r) throw new BadRequestException("Cannot refer yourself");

    // Reject mutual referral: if the referrer is already registered as referred
    // by this wallet, allowing both sides would let them credit each other.
    const [mutual] = await sql`
      SELECT 1 FROM referral WHERE wallet = ${r} AND referrer = ${w} LIMIT 1
    `;
    if (mutual) throw new BadRequestException("Mutual referral not allowed");

    // Reject if the wallet already has on-chain activity — they are an existing
    // user and cannot be attributed to a referrer after the fact.
    const { trades, tokens: created } = await subgraphFetch<{
      trades:  { id: string }[];
      tokens:  { id: string }[];
    }>(`query WalletActivity($w: String!) {
      trades(first: 1, where: { trader: $w }) { id }
      tokens(first: 1, where: { creator: $w }) { id }
    }`, { w });
    if (trades.length > 0 || created.length > 0) {
      throw new BadRequestException("Wallet already has on-chain activity and cannot be referred");
    }

    const now = Math.floor(Date.now() / 1000);

    const result = await sql`
      INSERT INTO referral (wallet, referrer, registered_at)
      VALUES (${w}, ${r}, ${now})
      ON CONFLICT (wallet) DO NOTHING
      RETURNING wallet, referrer
    `;

    if (result.length === 0) {
      throw new ConflictException("Wallet already has a registered referrer");
    }

    return { wallet: w, referrer: r };
  }

  /**
   * Get referral stats for a referrer wallet.
   * Returns how many wallets they referred, how many have been credited,
   * and total referral bonus points earned.
   */
  async stats(referrer: string) {
    if (!isAddress(referrer)) return null;
    const r = referrer.toLowerCase();

    const [[row], referred] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int                                  AS "referredCount",
          COUNT(*) FILTER (WHERE credited = TRUE)::int   AS "creditedCount",
          COUNT(*) FILTER (WHERE credited = FALSE)::int  AS "pendingCount"
        FROM referral
        WHERE referrer = ${r}
      `,
      sql`
        SELECT wallet, credited, registered_at::int AS "registeredAt"
        FROM referral
        WHERE referrer = ${r}
        ORDER BY registered_at DESC
        LIMIT 50
      `,
    ]);

    const [bonusRow] = await sql`
      SELECT COALESCE(SUM(points), 0)::numeric AS "bonusPoints"
      FROM point_event
      WHERE wallet = ${r} AND event_type = 'REFERRAL_BONUS'
    `;

    return {
      referrer:      r,
      referredCount: row.referredCount  as number,
      creditedCount: row.creditedCount  as number,
      pendingCount:  row.pendingCount   as number,
      bonusPoints:   bonusRow.bonusPoints as string,
      bonusPerCredit: POINTS.REFERRAL_BONUS,
      referred,
    };
  }
}
