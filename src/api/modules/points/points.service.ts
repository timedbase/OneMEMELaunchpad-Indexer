import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { sql } from "../../db";
import { paginated, parsePagination, isAddress } from "../../helpers";
import { PriceService } from "../price/price.service";

// ── Point values ──────────────────────────────────────────────────────────────

export const POINTS = {
  TOKEN_CREATED:  5,
  BUY:            1,
  SELL:           0.5,
  TOKEN_MIGRATED: 80,
  REFERRAL_BONUS: 10,
} as const;

// ── Season / start-block gate ─────────────────────────────────────────────────
// Falls back to START_BLOCK (indexer start) when POINTS_START_BLOCK is unset.

function getStartBlock(): bigint {
  const raw = process.env.POINTS_START_BLOCK ?? process.env.START_BLOCK;
  if (!raw) return 0n;
  try {
    const n = BigInt(raw);
    return n > 0n ? n : 0n;
  } catch {
    return 0n;
  }
}

const POLL_INTERVAL_MS = 30_000;

@Injectable()
export class PointsService implements OnModuleInit {
  private readonly logger = new Logger(PointsService.name);

  constructor(private readonly price: PriceService) {}

  async onModuleInit() {
    try {
      // source_id is the internal dedup key — never exposed to users.
      //   TOKEN_CREATED  : creation_tx_hash
      //   BUY / SELL     : trade.id  ({txHash}-{logIndex})
      //   TOKEN_MIGRATED : migration tx_hash
      //   REFERRAL_BONUS : "ref:{referred_wallet}"
      await sql`
        CREATE TABLE IF NOT EXISTS point_event (
          id          BIGSERIAL     PRIMARY KEY,
          wallet      TEXT          NOT NULL,
          event_type  TEXT          NOT NULL,
          points      NUMERIC(10,2) NOT NULL,
          token       TEXT,
          source_id   TEXT,
          timestamp   BIGINT        NOT NULL
        )
      `;

      // Migrate existing installs: add source_id if it doesn't exist yet,
      // then backfill from the old tx_hash column.
      await sql`ALTER TABLE point_event ADD COLUMN IF NOT EXISTS source_id TEXT`;
      await sql`
        UPDATE point_event
        SET source_id = tx_hash
        WHERE source_id IS NULL AND tx_hash IS NOT NULL
      `;

      // Dedup index on (event_type, source_id).
      // Drop old index in case it was created on tx_hash.
      await sql`DROP INDEX IF EXISTS point_event_dedup`;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS point_event_dedup
          ON point_event (event_type, source_id)
          WHERE source_id IS NOT NULL
      `;

      await sql`CREATE INDEX IF NOT EXISTS point_event_wallet_idx ON point_event (wallet)`;
      await sql`CREATE INDEX IF NOT EXISTS point_event_ts_idx     ON point_event (timestamp DESC)`;

      await sql`
        CREATE TABLE IF NOT EXISTS referral (
          wallet        TEXT PRIMARY KEY,
          referrer      TEXT    NOT NULL,
          registered_at BIGINT  NOT NULL,
          credited      BOOLEAN NOT NULL DEFAULT FALSE
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS referral_referrer_idx ON referral (referrer)`;

      this.logger.log(`Points tables ready — start block: ${getStartBlock() || "all"}`);
    } catch (err: unknown) {
      this.logger.error(`Failed to initialise points tables: ${(err as Error).message}`);
    }

    void this.poll();
    setInterval(() => { void this.poll(); }, POLL_INTERVAL_MS).unref();
  }

  // ── Background poller ──────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    try {
      const startBlock = getStartBlock();
      await this.awardTokenCreated(startBlock);
      await this.awardTrades(startBlock);
      await this.awardMigrations(startBlock);
      await this.awardReferralBonuses(startBlock);
    } catch (err: unknown) {
      this.logger.warn(`Points poll error: ${(err as Error).message}`);
    }
  }

  private async awardTokenCreated(startBlock: bigint): Promise<void> {
    const blockFilter = startBlock > 0n
      ? sql`AND t.created_at_block::numeric >= ${Number(startBlock)}`
      : sql``;

    await sql`
      INSERT INTO point_event (wallet, event_type, points, token, source_id, timestamp)
      SELECT
        t.creator,
        'TOKEN_CREATED',
        ${POINTS.TOKEN_CREATED},
        t.id,
        t.creation_tx_hash,
        t.created_at_timestamp::bigint
      FROM token t
      LEFT JOIN point_event pe
        ON pe.event_type = 'TOKEN_CREATED' AND pe.source_id = t.creation_tx_hash
      WHERE pe.id IS NULL ${blockFilter}
      ON CONFLICT (event_type, source_id) DO NOTHING
    `;
  }

  private async awardTrades(startBlock: bigint): Promise<void> {
    const blockFilter = startBlock > 0n
      ? sql`AND tr.block_number::numeric >= ${Number(startBlock)}`
      : sql``;

    await sql`
      INSERT INTO point_event (wallet, event_type, points, token, source_id, timestamp)
      SELECT
        tr.trader,
        CASE WHEN tr.trade_type = 'buy' THEN 'BUY' ELSE 'SELL' END,
        CASE WHEN tr.trade_type = 'buy' THEN ${POINTS.BUY} ELSE ${POINTS.SELL} END,
        tr.token,
        tr.id,
        tr.timestamp::bigint
      FROM trade tr
      LEFT JOIN point_event pe
        ON pe.event_type IN ('BUY', 'SELL') AND pe.source_id = tr.id
      WHERE pe.id IS NULL ${blockFilter}
      ON CONFLICT (event_type, source_id) DO NOTHING
    `;
  }

  private async awardMigrations(startBlock: bigint): Promise<void> {
    const blockFilter = startBlock > 0n
      ? sql`AND m.block_number::numeric >= ${Number(startBlock)}`
      : sql``;

    await sql`
      INSERT INTO point_event (wallet, event_type, points, token, source_id, timestamp)
      SELECT
        tk.creator,
        'TOKEN_MIGRATED',
        ${POINTS.TOKEN_MIGRATED},
        m.token,
        m.tx_hash,
        m.timestamp::bigint
      FROM migration m
      JOIN token tk ON tk.id = m.token
      LEFT JOIN point_event pe
        ON pe.event_type = 'TOKEN_MIGRATED' AND pe.source_id = m.tx_hash
      WHERE pe.id IS NULL ${blockFilter}
      ON CONFLICT (event_type, source_id) DO NOTHING
    `;
  }

  private async awardReferralBonuses(startBlock: bigint): Promise<void> {
    // Qualification: referred user must either
    //   (a) complete ≥5 trades with a combined BNB volume worth ≥$50 USD, OR
    //   (b) have launched a token (creator of at least one token)
    // Both checks respect the POINTS_START_BLOCK gate.

    const priceData = this.price.getPrice();
    if ("error" in priceData) {
      this.logger.warn("Skipping referral bonus poll — BNB price not yet available");
      return;
    }
    const bnbPrice = priceData.bnbUsdt;

    const blockFilter = startBlock > 0n
      ? sql`AND tr.block_number::numeric >= ${Number(startBlock)}`
      : sql``;
    const tokenBlockFilter = startBlock > 0n
      ? sql`AND t.created_at_block::numeric >= ${Number(startBlock)}`
      : sql``;

    const pending = await sql`
      SELECT r.wallet AS referred, r.referrer
      FROM referral r
      WHERE r.credited = FALSE
        AND (
          -- (a) ≥5 trades AND total BNB volume * bnbPrice ≥ $50
          (
            SELECT COUNT(*) FROM trade tr
            WHERE tr.trader = r.wallet ${blockFilter}
          ) >= 5
          AND
          (
            SELECT COALESCE(SUM(tr.bnb_amount::numeric / 1e18), 0) FROM trade tr
            WHERE tr.trader = r.wallet ${blockFilter}
          ) * ${bnbPrice} >= 50
          OR
          -- (b) launched at least one token
          EXISTS (
            SELECT 1 FROM token t
            WHERE t.creator = r.wallet ${tokenBlockFilter}
          )
        )
    `;

    for (const row of pending) {
      const sourceId = `ref:${row.referred as string}`;
      const now = Math.floor(Date.now() / 1000);
      try {
        await sql`
          INSERT INTO point_event (wallet, event_type, points, token, source_id, timestamp)
          VALUES (
            ${row.referrer as string},
            'REFERRAL_BONUS',
            ${POINTS.REFERRAL_BONUS},
            NULL,
            ${sourceId},
            ${now}
          )
          ON CONFLICT (event_type, source_id) DO NOTHING
        `;
        await sql`UPDATE referral SET credited = TRUE WHERE wallet = ${row.referred as string}`;
      } catch (err: unknown) {
        this.logger.warn(`Referral bonus failed for ${row.referred as string}: ${(err as Error).message}`);
      }
    }
  }

  // ── Public queries ─────────────────────────────────────────────────────────

  async getWallet(address: string) {
    if (!isAddress(address)) return null;
    const addr = address.toLowerCase();

    const [[summary], breakdown] = await Promise.all([
      sql`
        SELECT
          COALESCE(SUM(points), 0)::numeric AS "totalPoints",
          COUNT(*)::int                     AS "eventCount"
        FROM point_event
        WHERE wallet = ${addr}
      `,
      sql`
        SELECT
          event_type                         AS "eventType",
          COUNT(*)::int                      AS count,
          COALESCE(SUM(points), 0)::numeric  AS points
        FROM point_event
        WHERE wallet = ${addr}
        GROUP BY event_type
        ORDER BY points DESC
      `,
    ]);

    return {
      wallet:      addr,
      totalPoints: summary.totalPoints as string,
      eventCount:  summary.eventCount  as number,
      breakdown:   breakdown as unknown as { eventType: string; count: number; points: string }[],
    };
  }

  async leaderboard(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          wallet,
          SUM(points)::numeric AS "totalPoints",
          COUNT(*)::int        AS "eventCount",
          MAX(timestamp)::int  AS "lastActivityAt"
        FROM point_event
        GROUP BY wallet
        ORDER BY SUM(points) DESC, MAX(timestamp) DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(DISTINCT wallet)::int AS count FROM point_event`,
    ]);

    return paginated(rows, count, page, limit);
  }

  // ── Internal export ────────────────────────────────────────────────────────

  async exportAll() {
    const startBlock = getStartBlock();

    const rows = await sql`
      SELECT
        wallet,
        SUM(points)::numeric                                        AS "totalPoints",
        COUNT(*)::int                                               AS "eventCount",
        COUNT(*) FILTER (WHERE event_type = 'TOKEN_CREATED')::int  AS "tokenCreatedCount",
        COUNT(*) FILTER (WHERE event_type = 'BUY')::int            AS "buyCount",
        COUNT(*) FILTER (WHERE event_type = 'SELL')::int           AS "sellCount",
        COUNT(*) FILTER (WHERE event_type = 'TOKEN_MIGRATED')::int AS "tokenMigratedCount",
        COUNT(*) FILTER (WHERE event_type = 'REFERRAL_BONUS')::int AS "referralBonusCount",
        MIN(timestamp)::int                                         AS "firstActivityAt",
        MAX(timestamp)::int                                         AS "lastActivityAt"
      FROM point_event
      GROUP BY wallet
      ORDER BY SUM(points) DESC
    `;

    return {
      exportedAt:   Math.floor(Date.now() / 1000),
      startBlock:   startBlock > 0n ? String(startBlock) : "all",
      totalWallets: rows.length,
      pointValues:  POINTS,
      data: rows,
    };
  }
}
