import { Injectable, OnModuleInit, Logger, BadRequestException, ConflictException } from "@nestjs/common";
import { sql } from "../../db";
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

    // Reject if the wallet already has on-chain activity — they are an existing
    // user and cannot be attributed to a referrer after the fact.
    const [activity] = await sql`
      SELECT 1 AS hit
      FROM (
        SELECT 1 FROM trade  WHERE trader  = ${w} LIMIT 1
        UNION ALL
        SELECT 1 FROM token  WHERE creator = ${w} LIMIT 1
      ) AS acts
      LIMIT 1
    `;
    if (activity) throw new BadRequestException("Wallet already has on-chain activity and cannot be referred");

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
      bonusPoints:   bonusRow.bonusPoints as number,
      bonusPerCredit: POINTS.REFERRAL_BONUS,
      referred,
    };
  }
}
