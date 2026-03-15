/**
 * OneMEME Launchpad Indexer — Event Handlers
 *
 * Processes user-facing events emitted by the LaunchpadFactory contract on BSC
 * and persists them to PostgreSQL via Ponder's type-safe ORM.
 *
 * Events handled:
 *   LaunchpadFactory:TokenCreated  — new meme token deployed
 *   LaunchpadFactory:TokenBought   — bonding-curve buy
 *   LaunchpadFactory:TokenSold     — bonding-curve sell
 *   LaunchpadFactory:TokenMigrated — token graduates to PancakeSwap V2
 *   MemeToken:Transfer             — ERC-20 transfer on any deployed token
 *                                    (used to maintain exact onchain holder balances)
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

// ─── Token Created ────────────────────────────────────────────────────────────

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
 * Emitted once the bonding-curve fundraising target is met.
 *
 * All raised BNB plus 38% of the token supply are deposited into a new
 * PancakeSwap V2 pair as permanent liquidity. This marks the end of the
 * bonding-curve phase.
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

// ─── Holder Balances ──────────────────────────────────────────────────────────

/**
 * Fired on every ERC-20 Transfer on any token deployed by the factory.
 *
 * Maintains exact onchain balances in the `holder` table:
 *   - Deducts `value` from the sender's balance (skip the zero address — mints)
 *   - Credits `value`  to the receiver's balance (skip the zero address — burns)
 *
 * Rows are upserted so the first transfer for a wallet creates the row
 * and subsequent transfers update it in place.
 */
ponder.on("MemeToken:Transfer", async ({ event, context }) => {
  const { from, to, value } = event.args;
  const token = event.log.address;

  const ZERO = "0x0000000000000000000000000000000000000000";

  // Deduct from sender (skip zero address = mint)
  if (from !== ZERO) {
    await context.db
      .insert(schema.holder)
      .values({ token, address: from, balance: 0n - value })
      .onConflictDoUpdate((row) => ({ balance: row.balance - value }));
  }

  // Credit receiver (skip zero address = burn)
  if (to !== ZERO) {
    await context.db
      .insert(schema.holder)
      .values({ token, address: to, balance: value })
      .onConflictDoUpdate((row) => ({ balance: row.balance + value }));
  }
});
