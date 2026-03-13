/**
 * OneMEME Launchpad Indexer — Event Handlers
 *
 * Processes all events emitted by the LaunchpadFactory contract on BSC and
 * persists them to PostgreSQL via Ponder's type-safe ORM.
 *
 * Events handled:
 *   Token lifecycle:  TokenCreated, TokenBought, TokenSold, TokenMigrated
 *   Oracle:           TWAPUpdated
 *   Factory admin:    DefaultParamsUpdated, FeesWithdrawn, RouterUpdated,
 *                     FeeRecipientUpdated, TradeFeeUpdated, UsdcPairUpdated,
 *                     TwapMaxAgeBlocksUpdated
 */

import { ponder } from "ponder:registry";
import * as schema from "ponder:schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps the on-chain TokenType enum (uint8) to a human-readable string.
 *   0 → "Standard"   (plain ERC-20, no taxes)
 *   1 → "Tax"        (buy/sell tax with up to 5 recipients)
 *   2 → "Reflection" (RFI-style passive distribution)
 */
function tokenTypeLabel(tokenType: number): string {
  switch (tokenType) {
    case 0:  return "Standard";
    case 1:  return "Tax";
    case 2:  return "Reflection";
    default: return "Unknown";
  }
}

// ─── Token Lifecycle ──────────────────────────────────────────────────────────

/**
 * Emitted when a new meme token is deployed through the factory.
 * Initialises the Token row and zeroes out all running aggregates.
 */
ponder.on("LaunchpadFactory:TokenCreated", async ({ event, context }) => {
  const { token, tokenType, creator, totalSupply, antibotEnabled, tradingBlock } =
    event.args;

  await context.db.insert(schema.token).values({
    id:                 token,
    tokenType:          tokenTypeLabel(tokenType),
    creator,
    totalSupply,
    antibotEnabled,
    tradingBlock,
    createdAtBlock:     event.block.number,
    createdAtTimestamp: Number(event.block.timestamp),
    migrated:           false,
    pairAddress:        null,
    buyCount:           0,
    sellCount:          0,
    volumeBNB:          0n,
    raisedBNB:          0n,
  });
});

// ─── Bonding Curve Trades ─────────────────────────────────────────────────────

/**
 * Emitted when a user buys tokens from the bonding curve.
 *
 * Stores the individual trade and updates the token's running stats:
 *   - Increments buyCount
 *   - Adds bnbIn to volumeBNB
 *   - Syncs raisedBNB to the latest on-chain value
 *
 * Note: tokensToDead is the portion burned as an antibot penalty and is
 * non-zero only during the antibot window (first N blocks after tradingBlock).
 */
ponder.on("LaunchpadFactory:TokenBought", async ({ event, context }) => {
  const { token, buyer, bnbIn, tokensOut, tokensToDead, raisedBNB } = event.args;

  await context.db.insert(schema.trade).values({
    id:           `${event.transaction.hash}-${event.log.logIndex}`,
    token,
    tradeType:    "buy",
    trader:       buyer,
    bnbAmount:    bnbIn,
    tokenAmount:  tokensOut,
    tokensToDead,
    raisedBNB,
    blockNumber:  event.block.number,
    txHash:       event.transaction.hash,
    timestamp:    Number(event.block.timestamp),
  });

  await context.db
    .update(schema.token, { id: token })
    .set((row) => ({
      buyCount:  row.buyCount + 1,
      volumeBNB: row.volumeBNB + bnbIn,
      raisedBNB,
    }));
});

/**
 * Emitted when a user sells tokens back to the bonding curve.
 *
 * Stores the individual trade and updates the token's running stats:
 *   - Increments sellCount
 *   - Adds bnbOut to volumeBNB
 *   - Syncs raisedBNB to the latest on-chain value
 */
ponder.on("LaunchpadFactory:TokenSold", async ({ event, context }) => {
  const { token, seller, tokensIn, bnbOut, raisedBNB } = event.args;

  await context.db.insert(schema.trade).values({
    id:           `${event.transaction.hash}-${event.log.logIndex}`,
    token,
    tradeType:    "sell",
    trader:       seller,
    bnbAmount:    bnbOut,
    tokenAmount:  tokensIn,
    tokensToDead: null,
    raisedBNB,
    blockNumber:  event.block.number,
    txHash:       event.transaction.hash,
    timestamp:    Number(event.block.timestamp),
  });

  await context.db
    .update(schema.token, { id: token })
    .set((row) => ({
      sellCount: row.sellCount + 1,
      volumeBNB: row.volumeBNB + bnbOut,
      raisedBNB,
    }));
});

// ─── Migration ────────────────────────────────────────────────────────────────

/**
 * Emitted (permissionlessly) once the bonding-curve fundraising target is met.
 *
 * All raised BNB plus 38% of the token supply are deposited into a new
 * PancakeSwap V2 pair as permanent liquidity. This event marks the end of the
 * bonding-curve phase.
 *
 * - Creates a Migration row with the pair address and liquidity amounts.
 * - Marks the Token as migrated and records the pair address.
 */
ponder.on("LaunchpadFactory:TokenMigrated", async ({ event, context }) => {
  const { token, pair, liquidityBNB, liquidityTokens } = event.args;

  await context.db.insert(schema.migration).values({
    id:              token,
    token,
    pair,
    liquidityBNB,
    liquidityTokens,
    blockNumber:     event.block.number,
    txHash:          event.transaction.hash,
    timestamp:       Number(event.block.timestamp),
  });

  await context.db
    .update(schema.token, { id: token })
    .set({ migrated: true, pairAddress: pair });
});

// ─── TWAP Oracle ──────────────────────────────────────────────────────────────

/**
 * Emitted whenever the factory's 30-minute TWAP oracle is refreshed.
 *
 * The price average is used internally to convert USD-denominated parameters
 * (creation fee, virtual BNB, migration target) to BNB at runtime.
 */
ponder.on("LaunchpadFactory:TWAPUpdated", async ({ event, context }) => {
  const { priceAvg, blockNumber: priceBlockNumber } = event.args;

  await context.db.insert(schema.twapUpdate).values({
    id:               `${event.transaction.hash}-${event.log.logIndex}`,
    priceAvg,
    priceBlockNumber,
    blockNumber:      event.block.number,
    timestamp:        Number(event.block.timestamp),
  });
});

// ─── Factory Admin Events ─────────────────────────────────────────────────────

/**
 * Emitted when the factory owner updates the default virtual BNB or migration
 * target USD values applied to newly created tokens.
 */
ponder.on("LaunchpadFactory:DefaultParamsUpdated", async ({ event, context }) => {
  const { virtualBNBUSD, migrationTargetUSD } = event.args;

  await context.db.insert(schema.factoryEvent).values({
    id:                `DefaultParamsUpdated-${event.transaction.hash}-${event.log.logIndex}`,
    eventType:         "DefaultParamsUpdated",
    blockNumber:       event.block.number,
    txHash:            event.transaction.hash,
    timestamp:         Number(event.block.timestamp),
    virtualBNBUSD,
    migrationTargetUSD,
  });
});

/**
 * Emitted when the factory owner withdraws accumulated platform fees.
 */
ponder.on("LaunchpadFactory:FeesWithdrawn", async ({ event, context }) => {
  const { recipient, amount } = event.args;

  await context.db.insert(schema.factoryEvent).values({
    id:               `FeesWithdrawn-${event.transaction.hash}-${event.log.logIndex}`,
    eventType:        "FeesWithdrawn",
    blockNumber:      event.block.number,
    txHash:           event.transaction.hash,
    timestamp:        Number(event.block.timestamp),
    withdrawRecipient: recipient,
    withdrawAmount:    amount,
  });
});

/**
 * Emitted when the PancakeSwap router address is updated.
 */
ponder.on("LaunchpadFactory:RouterUpdated", async ({ event, context }) => {
  const { router } = event.args;

  await context.db.insert(schema.factoryEvent).values({
    id:          `RouterUpdated-${event.transaction.hash}-${event.log.logIndex}`,
    eventType:   "RouterUpdated",
    blockNumber: event.block.number,
    txHash:      event.transaction.hash,
    timestamp:   Number(event.block.timestamp),
    router,
  });
});

/**
 * Emitted when the platform fee recipient address is updated.
 */
ponder.on("LaunchpadFactory:FeeRecipientUpdated", async ({ event, context }) => {
  const { recipient } = event.args;

  await context.db.insert(schema.factoryEvent).values({
    id:           `FeeRecipientUpdated-${event.transaction.hash}-${event.log.logIndex}`,
    eventType:    "FeeRecipientUpdated",
    blockNumber:  event.block.number,
    txHash:       event.transaction.hash,
    timestamp:    Number(event.block.timestamp),
    feeRecipient: recipient,
  });
});

/**
 * Emitted when the bonding-curve trade fee (in basis points) is updated.
 */
ponder.on("LaunchpadFactory:TradeFeeUpdated", async ({ event, context }) => {
  const { feeBps } = event.args;

  await context.db.insert(schema.factoryEvent).values({
    id:          `TradeFeeUpdated-${event.transaction.hash}-${event.log.logIndex}`,
    eventType:   "TradeFeeUpdated",
    blockNumber: event.block.number,
    txHash:      event.transaction.hash,
    timestamp:   Number(event.block.timestamp),
    feeBps,
  });
});

/**
 * Emitted when the USDC/WBNB pair used by the TWAP oracle is reconfigured.
 */
ponder.on("LaunchpadFactory:UsdcPairUpdated", async ({ event, context }) => {
  const { usdcToken, pair, isToken0 } = event.args;

  await context.db.insert(schema.factoryEvent).values({
    id:           `UsdcPairUpdated-${event.transaction.hash}-${event.log.logIndex}`,
    eventType:    "UsdcPairUpdated",
    blockNumber:  event.block.number,
    txHash:       event.transaction.hash,
    timestamp:    Number(event.block.timestamp),
    usdcToken,
    usdcPair:     pair,
    usdcIsToken0: isToken0,
  });
});

/**
 * Emitted when the maximum age (in blocks) before a TWAP reading is considered
 * stale is updated.
 */
ponder.on("LaunchpadFactory:TwapMaxAgeBlocksUpdated", async ({ event, context }) => {
  const { blocks } = event.args;

  await context.db.insert(schema.factoryEvent).values({
    id:               `TwapMaxAgeBlocksUpdated-${event.transaction.hash}-${event.log.logIndex}`,
    eventType:        "TwapMaxAgeBlocksUpdated",
    blockNumber:      event.block.number,
    txHash:           event.transaction.hash,
    timestamp:        Number(event.block.timestamp),
    twapMaxAgeBlocks: blocks,
  });
});
