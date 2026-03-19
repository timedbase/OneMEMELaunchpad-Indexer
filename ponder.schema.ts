import { onchainTable, index, primaryKey } from "ponder";

// ─── Token ────────────────────────────────────────────────────────────────────
// One row per deployed meme token. Created on TokenCreated, updated on each
// trade and migration.

export const token = onchainTable(
  "token",
  (t) => ({
    /** Token contract address (primary key). */
    id: t.hex().primaryKey(),

    /**
     * Token implementation type: "Standard" | "Tax" | "Reflection".
     * Derived at index time by comparing the token's EIP-1167 implementation
     * address against the factory's standardImpl / taxImpl / reflectionImpl.
     * Null only if bytecode read fails (extremely unlikely).
     */
    tokenType: t.text(),

    /** Address that called createToken on the factory. */
    creator: t.hex().notNull(),

    /** Total supply minted at launch (18-decimal). */
    totalSupply: t.bigint().notNull(),

    /**
     * Initial virtual BNB reserve used in the bonding-curve AMM formula.
     * Price at any point = (virtualBNB + raisedBNB) / tokensAvailable.
     */
    virtualBNB: t.bigint().notNull(),

    /** Whether the antibot penalty was enabled at launch. */
    antibotEnabled: t.boolean().notNull(),

    /** BSC block number after which normal trading began on the bonding curve. */
    tradingBlock: t.bigint().notNull(),

    /** BSC block number of the TokenCreated event. */
    createdAtBlock: t.bigint().notNull(),

    /** Unix timestamp (seconds) of the TokenCreated event. */
    createdAtTimestamp: t.integer().notNull(),

    /** Whether the token has been migrated to PancakeSwap. */
    migrated: t.boolean().notNull(),

    /** PancakeSwap pair address, populated after migration. */
    pairAddress: t.hex(),

    // ── Running aggregates (updated on every buy / sell) ──────────────────────

    /** Total number of bonding-curve buy transactions. */
    buyCount: t.integer().notNull(),

    /** Total number of bonding-curve sell transactions. */
    sellCount: t.integer().notNull(),

    /**
     * Total BNB traded through the bonding curve (buys + sells, wei).
     */
    volumeBNB: t.bigint().notNull(),

    /**
     * Current total BNB raised on the bonding curve (synced from the
     * raisedBNB field emitted in the most recent buy or sell event).
     */
    raisedBNB: t.bigint().notNull(),

    /**
     * BNB target that must be raised before the token can migrate to
     * PancakeSwap. Read from the factory's tokens() view at creation time.
     * Used by the frontend to show bonding-curve progress without an extra
     * on-chain read per token card.
     */
    migrationTarget: t.bigint().notNull(),
  }),
  (table) => ({
    creatorIdx:        index().on(table.creator),
    migratedIdx:       index().on(table.migrated),
    volumeBNBIdx:      index().on(table.volumeBNB),
    raisedBNBIdx:      index().on(table.raisedBNB),
    createdAtBlockIdx: index().on(table.createdAtBlock),
  })
);

// ─── Trade ────────────────────────────────────────────────────────────────────
// One row per bonding-curve buy or sell transaction.

export const trade = onchainTable(
  "trade",
  (t) => ({
    /** "{txHash}-{logIndex}" – globally unique. */
    id: t.text().primaryKey(),

    /** Token contract address. */
    token: t.hex().notNull(),

    /** "buy" or "sell". */
    tradeType: t.text().notNull(),

    /** Address of the buyer / seller. */
    trader: t.hex().notNull(),

    /**
     * For buys:  BNB sent in (wei).
     * For sells: BNB received out (wei).
     */
    bnbAmount: t.bigint().notNull(),

    /**
     * For buys:  gross tokens received before antibot burn (wei).
     * For sells: tokens sent in (wei).
     */
    tokenAmount: t.bigint().notNull(),

    /**
     * Tokens burned to the dead address as antibot penalty (buys only).
     * NULL for sell trades.
     */
    tokensToDead: t.bigint(),

    /** Cumulative BNB raised on the bonding curve at this point in time (wei). */
    raisedBNB: t.bigint().notNull(),

    /** BSC block number. */
    blockNumber: t.bigint().notNull(),

    /** Transaction hash. */
    txHash: t.hex().notNull(),

    /** Unix timestamp (seconds) of the block. */
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    tokenIdx:          index().on(table.token),
    traderIdx:         index().on(table.trader),
    timestampIdx:      index().on(table.timestamp),
    tradeTypeIdx:      index().on(table.tradeType),
    timestampTokenIdx: index().on(table.timestamp, table.token),
  })
);

// ─── Holder ───────────────────────────────────────────────────────────────────
// One row per (token, wallet) pair. Updated on every Transfer event.
// Balance drops to zero when a wallet transfers out its entire position;
// the row is retained (balance = 0n) rather than deleted for simplicity.

export const holder = onchainTable(
  "holder",
  (t) => ({
    /** Token contract address. */
    token: t.hex().notNull(),

    /** Wallet address. */
    address: t.hex().notNull(),

    /** Current onchain balance (wei). Updated on every Transfer event. */
    balance: t.bigint().notNull(),
  }),
  (table) => ({
    pk:         primaryKey({ columns: [table.token, table.address] }),
    tokenIdx:   index().on(table.token),
    balanceIdx: index().on(table.balance),
  })
);

// ─── Migration ────────────────────────────────────────────────────────────────
// One row per migrated token (keyed by token address since migration is a
// one-time, irreversible event).

export const migration = onchainTable(
  "migration",
  (t) => ({
    /** Token contract address (primary key). */
    id: t.hex().primaryKey(),

    /** Token contract address (redundant but explicit). */
    token: t.hex().notNull(),

    /** PancakeSwap V2 pair address created during migration. */
    pair: t.hex().notNull(),

    /** BNB deposited as permanent liquidity (wei). */
    liquidityBNB: t.bigint().notNull(),

    /** Tokens deposited as permanent liquidity (wei). */
    liquidityTokens: t.bigint().notNull(),

    /** BSC block number of the TokenMigrated event. */
    blockNumber: t.bigint().notNull(),

    /** Transaction hash. */
    txHash: t.hex().notNull(),

    /** Unix timestamp (seconds) of the block. */
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    pairIdx: index().on(table.pair),
  })
);
