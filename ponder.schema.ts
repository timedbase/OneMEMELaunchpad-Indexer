import { onchainTable, index } from "ponder";

// ─── Token ────────────────────────────────────────────────────────────────────
// One row per deployed meme token. Created on TokenCreated, updated on each
// trade and migration.

export const token = onchainTable(
  "token",
  (t) => ({
    /** Token contract address (primary key). */
    id: t.hex().primaryKey(),

    /**
     * Token implementation type:
     *   "Standard"   – plain ERC-20, no taxes
     *   "Tax"        – configurable buy/sell taxes (up to 5 recipients)
     *   "Reflection" – RFI-style passive holder distribution
     */
    tokenType: t.text().notNull(),

    /** Address that called createToken / createTT / createRFL. */
    creator: t.hex().notNull(),

    /** Total supply minted at launch (18-decimal, one of ONE/THOUSAND/MILLION/BILLION). */
    totalSupply: t.bigint().notNull(),

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
     * Gives a sense of overall activity/liquidity before migration.
     */
    volumeBNB: t.bigint().notNull(),

    /**
     * Current total BNB raised on the bonding curve (synced from the
     * raisedBNB field emitted in the most recent buy or sell event).
     */
    raisedBNB: t.bigint().notNull(),
  }),
  (table) => ({
    creatorIdx: index().on(table.creator),
    migratedIdx: index().on(table.migrated),
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
    tokenIdx:      index().on(table.token),
    traderIdx:     index().on(table.trader),
    timestampIdx:  index().on(table.timestamp),
    tradeTypeIdx:  index().on(table.tradeType),
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

// ─── TWAP Update ─────────────────────────────────────────────────────────────
// Records every oracle update emitted by the factory's TWAP mechanism.
// Useful for reconstructing the historical BNB/USD price used by the launchpad.

export const twapUpdate = onchainTable(
  "twap_update",
  (t) => ({
    /** "{txHash}-{logIndex}" – globally unique. */
    id: t.text().primaryKey(),

    /**
     * 30-minute time-weighted average BNB price expressed in the USDC
     * pair's fixed-point representation (contract-specific scale).
     */
    priceAvg: t.bigint().notNull(),

    /**
     * The block number stored inside the TWAPUpdated event args
     * (the block the TWAP observation was anchored to).
     */
    priceBlockNumber: t.bigint().notNull(),

    /** BSC block number where the TWAPUpdated event was emitted. */
    blockNumber: t.bigint().notNull(),

    /** Unix timestamp (seconds) of the block. */
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    blockNumberIdx: index().on(table.blockNumber),
  })
);

// ─── Factory Event ────────────────────────────────────────────────────────────
// Captures all administrative / config-change events emitted by the factory.
// Each row is one event, with optional columns populated depending on event type.

export const factoryEvent = onchainTable(
  "factory_event",
  (t) => ({
    /** "{EventType}-{txHash}-{logIndex}" – globally unique. */
    id: t.text().primaryKey(),

    /**
     * Discriminator for the event type:
     *   "DefaultParamsUpdated" | "FeesWithdrawn" | "RouterUpdated" |
     *   "FeeRecipientUpdated"  | "TradeFeeUpdated" | "UsdcPairUpdated" |
     *   "TwapMaxAgeBlocksUpdated"
     */
    eventType: t.text().notNull(),

    /** BSC block number. */
    blockNumber: t.bigint().notNull(),

    /** Transaction hash. */
    txHash: t.hex().notNull(),

    /** Unix timestamp (seconds) of the block. */
    timestamp: t.integer().notNull(),

    // ── DefaultParamsUpdated ──────────────────────────────────────────────────
    /** New default virtual BNB expressed in USD (18 decimals). */
    virtualBNBUSD: t.bigint(),
    /** New default migration target expressed in USD (18 decimals). */
    migrationTargetUSD: t.bigint(),

    // ── RouterUpdated ─────────────────────────────────────────────────────────
    /** New PancakeSwap router address. */
    router: t.hex(),

    // ── FeeRecipientUpdated ───────────────────────────────────────────────────
    /** New fee recipient address. */
    feeRecipient: t.hex(),

    // ── TradeFeeUpdated ───────────────────────────────────────────────────────
    /** New trade fee in basis points (e.g. 100 = 1%). */
    feeBps: t.bigint(),

    // ── UsdcPairUpdated ───────────────────────────────────────────────────────
    /** New USDC token address used by the TWAP oracle. */
    usdcToken: t.hex(),
    /** New USDC/WBNB pair address used by the TWAP oracle. */
    usdcPair: t.hex(),
    /** Whether usdcToken is token0 in the pair. */
    usdcIsToken0: t.boolean(),

    // ── TwapMaxAgeBlocksUpdated ───────────────────────────────────────────────
    /** New maximum age (in blocks) before TWAP is considered stale. */
    twapMaxAgeBlocks: t.bigint(),

    // ── FeesWithdrawn ─────────────────────────────────────────────────────────
    /** Address that received the withdrawn fees. */
    withdrawRecipient: t.hex(),
    /** Amount of BNB withdrawn (wei). */
    withdrawAmount: t.bigint(),
  }),
  (table) => ({
    eventTypeIdx: index().on(table.eventType),
  })
);
