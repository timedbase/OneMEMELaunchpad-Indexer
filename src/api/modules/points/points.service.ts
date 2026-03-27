import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { sql } from "../../db";
import { paginated, parsePagination, isAddress } from "../../helpers";

// ── Point values ──────────────────────────────────────────────────────────────

export const POINTS = {
  TOKEN_CREATED:  5,
  BUY:            1,
  SELL:           0.5,
  TOKEN_MIGRATED: 80,
  REFERRAL_BONUS: 10,
} as const;

// ── Season / start-block gate ─────────────────────────────────────────────────
// Set POINTS_START_BLOCK in .env to only award points for on-chain events at or
// after that block.  Unset (or 0) means award for all indexed events.
// Changing this value affects future polls only — already-inserted rows are
// not retroactively removed.

function getStartBlock(): bigint {
  const raw = process.env.POINTS_START_BLOCK;
  if (!raw) return 0n;
  const n = BigInt(raw);
  return n > 0n ? n : 0n;
}

const POLL_INTERVAL_MS = 30_000;

@Injectable()
export class PointsService implements OnModuleInit {
  private readonly logger = new Logger(PointsService.name);

  async onModuleInit() {
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS point_event (
          id          BIGSERIAL PRIMARY KEY,
          wallet      TEXT          NOT NULL,
          event_type  TEXT          NOT NULL,
          points      NUMERIC(10,2) NOT NULL,
          token       TEXT,
          tx_hash     TEXT,
          block_number BIGINT,
          timestamp   BIGINT        NOT NULL
        )
      `;
      // Unique dedup: one point_event per (event_type, tx_hash).
      // tx_hash is the on-chain tx hash (or synthetic key for referral bonuses).
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS point_event_dedup
          ON point_event (event_type, tx_hash)
          WHERE tx_hash IS NOT NULL
      `;
      await sql`CREATE INDEX IF NOT EXISTS point_event_wallet_idx    ON point_event (wallet)`;
      await sql`CREATE INDEX IF NOT EXISTS point_event_ts_idx        ON point_event (timestamp DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS point_event_block_idx     ON point_event (block_number)`;

      // Referral table — also created here so the poller can safely query it
      // regardless of module initialisation order.
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
      await this.awardReferralBonuses();
    } catch (err: unknown) {
      this.logger.warn(`Points poll error: ${(err as Error).message}`);
    }
  }

  private async awardTokenCreated(startBlock: bigint): Promise<void> {
    const blockFilter = startBlock > 0n
      ? sql`AND t.created_at_block::numeric >= ${startBlock}`
      : sql``;

    await sql`
      INSERT INTO point_event (wallet, event_type, points, token, tx_hash, block_number, timestamp)
      SELECT
        t.creator,
        'TOKEN_CREATED',
        ${POINTS.TOKEN_CREATED},
        t.id,
        t.creation_tx_hash,
        t.created_at_block,
        t.created_at_timestamp::bigint
      FROM token t
      LEFT JOIN point_event pe
        ON pe.event_type = 'TOKEN_CREATED' AND pe.tx_hash = t.creation_tx_hash
      WHERE pe.id IS NULL ${blockFilter}
      ON CONFLICT (event_type, tx_hash) DO NOTHING
    `;
  }

  private async awardTrades(startBlock: bigint): Promise<void> {
    // Use trade.id ({txHash}-{logIndex}) as the dedup key so each log line
    // gets exactly one point event even if multiple trades share a tx hash.
    const blockFilter = startBlock > 0n
      ? sql`AND tr.block_number::numeric >= ${startBlock}`
      : sql``;

    await sql`
      INSERT INTO point_event (wallet, event_type, points, token, tx_hash, block_number, timestamp)
      SELECT
        tr.trader,
        CASE WHEN tr.trade_type = 'buy' THEN 'BUY' ELSE 'SELL' END,
        CASE WHEN tr.trade_type = 'buy' THEN ${POINTS.BUY} ELSE ${POINTS.SELL} END,
        tr.token,
        tr.id,
        tr.block_number,
        tr.timestamp::bigint
      FROM trade tr
      LEFT JOIN point_event pe
        ON pe.event_type IN ('BUY', 'SELL') AND pe.tx_hash = tr.id
      WHERE pe.id IS NULL ${blockFilter}
      ON CONFLICT (event_type, tx_hash) DO NOTHING
    `;
  }

  private async awardMigrations(startBlock: bigint): Promise<void> {
    const blockFilter = startBlock > 0n
      ? sql`AND m.block_number::numeric >= ${startBlock}`
      : sql``;

    await sql`
      INSERT INTO point_event (wallet, event_type, points, token, tx_hash, block_number, timestamp)
      SELECT
        tk.creator,
        'TOKEN_MIGRATED',
        ${POINTS.TOKEN_MIGRATED},
        m.token,
        m.tx_hash,
        m.block_number,
        m.timestamp::bigint
      FROM migration m
      JOIN token tk ON tk.id = m.token
      LEFT JOIN point_event pe
        ON pe.event_type = 'TOKEN_MIGRATED' AND pe.tx_hash = m.tx_hash
      WHERE pe.id IS NULL ${blockFilter}
      ON CONFLICT (event_type, tx_hash) DO NOTHING
    `;
  }

  private async awardReferralBonuses(): Promise<void> {
    // Find referrals where the referred wallet has now earned ≥1 qualifying
    // point but the referrer hasn't been credited yet.
    const pending = await sql`
      SELECT r.wallet AS referred, r.referrer
      FROM referral r
      WHERE r.credited = FALSE
        AND EXISTS (
          SELECT 1 FROM point_event pe
          WHERE pe.wallet = r.wallet
            AND pe.event_type IN ('TOKEN_CREATED', 'BUY', 'SELL', 'TOKEN_MIGRATED')
        )
    `;

    for (const row of pending) {
      const syntheticKey = `ref:${row.referred as string}`;
      const now = Math.floor(Date.now() / 1000);
      try {
        await sql`
          INSERT INTO point_event (wallet, event_type, points, token, tx_hash, block_number, timestamp)
          VALUES (
            ${row.referrer as string},
            'REFERRAL_BONUS',
            ${POINTS.REFERRAL_BONUS},
            NULL,
            ${syntheticKey},
            NULL,
            ${now}
          )
          ON CONFLICT (event_type, tx_hash) DO NOTHING
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
          event_type                          AS "eventType",
          COUNT(*)::int                       AS count,
          COALESCE(SUM(points), 0)::numeric   AS points
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
      breakdown:   breakdown as { eventType: string; count: number; points: string }[],
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
    const blockInfo  = startBlock > 0n ? String(startBlock) : "all";

    const rows = await sql`
      SELECT
        wallet,
        SUM(points)::numeric                                              AS "totalPoints",
        COUNT(*)::int                                                     AS "eventCount",
        COUNT(*) FILTER (WHERE event_type = 'TOKEN_CREATED')::int        AS "tokenCreatedCount",
        COUNT(*) FILTER (WHERE event_type = 'BUY')::int                  AS "buyCount",
        COUNT(*) FILTER (WHERE event_type = 'SELL')::int                 AS "sellCount",
        COUNT(*) FILTER (WHERE event_type = 'TOKEN_MIGRATED')::int       AS "tokenMigratedCount",
        COUNT(*) FILTER (WHERE event_type = 'REFERRAL_BONUS')::int       AS "referralBonusCount",
        MIN(timestamp)::int                                               AS "firstActivityAt",
        MAX(timestamp)::int                                               AS "lastActivityAt"
      FROM point_event
      GROUP BY wallet
      ORDER BY SUM(points) DESC
    `;

    return {
      exportedAt:  Math.floor(Date.now() / 1000),
      startBlock:  blockInfo,
      totalWallets: rows.length,
      pointValues: POINTS,
      data: rows,
    };
  }
}
