import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { sql } from "../../db";
import { subgraphFetchAll, subgraphFetch, tradeSourceId } from "../../subgraph";
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

function getStartBlock(): string {
  const raw = process.env.POINTS_START_BLOCK ?? process.env.START_BLOCK;
  if (!raw) return "0";
  try {
    const n = BigInt(raw);
    return n > 0n ? n.toString() : "0";
  } catch {
    return "0";
  }
}

const POLL_INTERVAL_MS = 30_000;

// ── Subgraph query types ──────────────────────────────────────────────────────

interface SubgraphToken {
  id:                 string;   // token contract address (Bytes → hex)
  creator:            string;   // wallet address
  txHash:             string;   // creation tx hash (source_id for TOKEN_CREATED)
  createdAtTimestamp: string;   // unix seconds as string (BigInt)
}

interface SubgraphTrade {
  id:        string;   // txHash(32b) + logIndex(4b) as hex — use tradeSourceId()
  trader:    string;
  type:      "BUY" | "SELL";
  token:     { id: string };
  timestamp: string;
  blockNumber: string;
}

interface SubgraphMigration {
  txHash:    string;
  timestamp: string;
  token:     { id: string; creator: string };
}

interface SubgraphTradeVolume {
  bnbAmount: string;
}

// ── GraphQL queries ───────────────────────────────────────────────────────────

const TOKENS_QUERY = /* GraphQL */ `
  query Tokens($startBlock: BigInt!, $first: Int!, $skip: Int!) {
    tokens(
      where:          { createdAtBlockNumber_gte: $startBlock }
      first:          $first
      skip:           $skip
      orderBy:        createdAtBlockNumber
      orderDirection: asc
    ) {
      id
      creator
      txHash
      createdAtTimestamp
    }
  }
`;

const TRADES_QUERY = /* GraphQL */ `
  query Trades($startBlock: BigInt!, $first: Int!, $skip: Int!) {
    trades(
      where:          { blockNumber_gte: $startBlock }
      first:          $first
      skip:           $skip
      orderBy:        blockNumber
      orderDirection: asc
    ) {
      id
      trader
      type
      token { id }
      timestamp
      blockNumber
    }
  }
`;

const MIGRATIONS_QUERY = /* GraphQL */ `
  query Migrations($startBlock: BigInt!, $first: Int!, $skip: Int!) {
    migrations(
      where:          { blockNumber_gte: $startBlock }
      first:          $first
      skip:           $skip
      orderBy:        blockNumber
      orderDirection: asc
    ) {
      txHash
      timestamp
      token { id creator }
    }
  }
`;

const REFERRAL_CHECK_QUERY = /* GraphQL */ `
  query ReferralCheck($wallet: Bytes!, $startBlock: BigInt!) {
    trades(
      where: { trader: $wallet, blockNumber_gte: $startBlock }
      first: 1000
    ) {
      bnbAmount
    }
    tokens(
      where: { creator: $wallet, createdAtBlockNumber_gte: $startBlock }
      first: 1
    ) {
      id
    }
  }
`;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class PointsService implements OnModuleInit {
  private readonly logger = new Logger(PointsService.name);

  constructor(private readonly price: PriceService) {}

  async onModuleInit() {
    try {
      // source_id is the internal dedup key — never exposed to users.
      //   TOKEN_CREATED  : creation tx hash
      //   BUY / SELL     : "{txHash}-{logIndex}"  (Ponder-compatible format)
      //   TOKEN_MIGRATED : migration tx hash
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
      // then attempt to backfill from the old tx_hash column (may not exist).
      await sql`ALTER TABLE point_event ADD COLUMN IF NOT EXISTS source_id TEXT`;
      try {
        await sql`
          UPDATE point_event
          SET source_id = tx_hash
          WHERE source_id IS NULL AND tx_hash IS NOT NULL
        `;
      } catch {
        // tx_hash column never existed on this install — nothing to backfill.
      }

      // Dedup index on (event_type, source_id).
      await sql`DROP INDEX IF EXISTS point_event_dedup`;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS point_event_dedup
          ON point_event (event_type, source_id)
      `;

      await sql`CREATE INDEX IF NOT EXISTS point_event_wallet_idx ON point_event (wallet)`;
      await sql`CREATE INDEX IF NOT EXISTS point_event_ts_idx     ON point_event (timestamp DESC)`;

      this.logger.log(`Points tables ready — start block: ${getStartBlock() === "0" ? "all" : getStartBlock()}`);
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

  private async awardTokenCreated(startBlock: string): Promise<void> {
    const tokens = await subgraphFetchAll<SubgraphToken>(
      "tokens",
      TOKENS_QUERY,
      { startBlock },
    );

    for (const token of tokens) {
      await sql`
        INSERT INTO point_event (wallet, event_type, points, token, source_id, timestamp)
        VALUES (
          ${token.creator.toLowerCase()},
          'TOKEN_CREATED',
          ${sql.unsafe(String(POINTS.TOKEN_CREATED))},
          ${token.id.toLowerCase()},
          ${token.txHash.toLowerCase()},
          ${parseInt(token.createdAtTimestamp)}
        )
        ON CONFLICT (event_type, source_id) DO NOTHING
      `;
    }
  }

  private async awardTrades(startBlock: string): Promise<void> {
    const trades = await subgraphFetchAll<SubgraphTrade>(
      "trades",
      TRADES_QUERY,
      { startBlock },
    );

    for (const trade of trades) {
      const eventType = trade.type === "BUY" ? "BUY" : "SELL";
      const points    = trade.type === "BUY"
        ? sql.unsafe(String(POINTS.BUY))
        : sql.unsafe(String(POINTS.SELL));

      await sql`
        INSERT INTO point_event (wallet, event_type, points, token, source_id, timestamp)
        VALUES (
          ${trade.trader.toLowerCase()},
          ${eventType},
          ${points},
          ${trade.token.id.toLowerCase()},
          ${tradeSourceId(trade.id)},
          ${parseInt(trade.timestamp)}
        )
        ON CONFLICT (event_type, source_id) DO NOTHING
      `;
    }
  }

  private async awardMigrations(startBlock: string): Promise<void> {
    const migrations = await subgraphFetchAll<SubgraphMigration>(
      "migrations",
      MIGRATIONS_QUERY,
      { startBlock },
    );

    for (const m of migrations) {
      await sql`
        INSERT INTO point_event (wallet, event_type, points, token, source_id, timestamp)
        VALUES (
          ${m.token.creator.toLowerCase()},
          'TOKEN_MIGRATED',
          ${sql.unsafe(String(POINTS.TOKEN_MIGRATED))},
          ${m.token.id.toLowerCase()},
          ${m.txHash.toLowerCase()},
          ${parseInt(m.timestamp)}
        )
        ON CONFLICT (event_type, source_id) DO NOTHING
      `;
    }
  }

  private async awardReferralBonuses(startBlock: string): Promise<void> {
    const priceData = this.price.getPrice();
    if ("error" in priceData) {
      this.logger.warn("Skipping referral bonus poll — BNB price not yet available");
      return;
    }
    if (priceData.stale) {
      this.logger.warn("Skipping referral bonus poll — BNB price is stale");
      return;
    }
    const bnbPrice = priceData.bnbUsdt;

    const pending = await sql<{ referred: string; referrer: string }[]>`
      SELECT wallet AS referred, referrer
      FROM referral
      WHERE credited = FALSE
    `;

    for (const row of pending) {
      try {
        const data = await subgraphFetch<{
          trades: SubgraphTradeVolume[];
          tokens: { id: string }[];
        }>(REFERRAL_CHECK_QUERY, {
          wallet:     row.referred.toLowerCase(),
          startBlock,
        });

        const tradeCount  = data.trades.length;
        const bnbVolumeWei = data.trades.reduce(
          (sum, t) => sum + BigInt(t.bnbAmount),
          0n,
        );
        const bnbVolume = Number(bnbVolumeWei) / 1e18;
        const hasToken  = data.tokens.length > 0;

        const qualifies =
          (tradeCount >= 5 && bnbVolume * bnbPrice >= 50) || hasToken;

        if (!qualifies) continue;

        const sourceId = `ref:${row.referred}`;
        const now      = Math.floor(Date.now() / 1000);

        await sql`
          INSERT INTO point_event (wallet, event_type, points, token, source_id, timestamp)
          VALUES (
            ${row.referrer},
            'REFERRAL_BONUS',
            ${sql.unsafe(String(POINTS.REFERRAL_BONUS))},
            NULL,
            ${sourceId},
            ${now}
          )
          ON CONFLICT (event_type, source_id) DO NOTHING
        `;
        await sql`UPDATE referral SET credited = TRUE WHERE wallet = ${row.referred}`;
      } catch (err: unknown) {
        this.logger.warn(`Referral check failed for ${row.referred}: ${(err as Error).message}`);
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
      startBlock:   startBlock === "0" ? "all" : startBlock,
      totalWallets: rows.length,
      pointValues:  POINTS,
      data: rows,
    };
  }
}
