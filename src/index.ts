/**
 * OneMEME Launchpad Indexer — Event Handlers
 *
 * Processes user-facing events emitted by the LaunchpadFactory and BondingCurve
 * contracts on BSC and persists them to PostgreSQL via Ponder's type-safe ORM.
 *
 * Events handled:
 *   LaunchpadFactory:TokenCreated  — new meme token deployed
 *   BondingCurve:TokenBought       — bonding-curve buy
 *   BondingCurve:TokenSold         — bonding-curve sell
 *   BondingCurve:TokenMigrated     — token graduates to PancakeSwap V2
 *   MemeToken:Transfer             — ERC-20 transfer on any deployed token
 *                                    (used to maintain exact onchain holder balances)
 */

import { ponder } from "ponder:registry";
import * as schema from "ponder:schema";
import LaunchpadFactoryAbi from "../abis/LaunchpadFactory.json";

// ─── Implementation address cache ─────────────────────────────────────────────
// The factory's impl addresses never change after deployment. We read them once
// on the first TokenCreated event and reuse the result for all subsequent ones.

type ImplAddresses = { standard: string; tax: string; reflection: string };
const implCache = new Map<string, ImplAddresses>();

/**
 * Reads standardImpl / taxImpl / reflectionImpl from the factory contract.
 * Results are cached in-process — only 3 RPC calls total per indexer run.
 */
async function getFactoryImpls(factoryAddress: string, client: any): Promise<ImplAddresses | null> {
  if (implCache.has(factoryAddress)) return implCache.get(factoryAddress)!;
  try {
    const [standard, tax, reflection] = await Promise.all([
      client.readContract({ abi: LaunchpadFactoryAbi, address: factoryAddress, functionName: "standardImpl" }),
      client.readContract({ abi: LaunchpadFactoryAbi, address: factoryAddress, functionName: "taxImpl" }),
      client.readContract({ abi: LaunchpadFactoryAbi, address: factoryAddress, functionName: "reflectionImpl" }),
    ]) as [string, string, string];
    const result: ImplAddresses = {
      standard:   standard.toLowerCase(),
      tax:        tax.toLowerCase(),
      reflection: reflection.toLowerCase(),
    };
    implCache.set(factoryAddress, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Extracts the implementation address from an EIP-1167 minimal proxy's bytecode.
 *
 * EIP-1167 layout (36 bytes):
 *   363d3d373d3d3d363d73  ← 10-byte prefix
 *   {20-byte-impl}        ← bytes 10–29
 *   5af43d82803e903d91602b57fd5bf3  ← 15-byte suffix
 *
 * The hex-encoded bytecode string (without 0x) has the impl at chars 20–59.
 */
function implFromBytecode(bytecode: string): string | null {
  // bytecode includes "0x" prefix → impl starts at char 22 (2 + 20)
  if (!bytecode || bytecode.length < 62) return null;
  return `0x${bytecode.slice(22, 62)}`.toLowerCase();
}

/**
 * Returns "Standard" | "Tax" | "Reflection" | null by comparing the token's
 * EIP-1167 implementation against the factory's known impl addresses.
 */
async function resolveTokenType(
  tokenAddress: string,
  factoryAddress: string,
  client: any,
): Promise<string | null> {
  const [bytecode, impls] = await Promise.all([
    client.getBytecode({ address: tokenAddress }).catch(() => null),
    getFactoryImpls(factoryAddress, client),
  ]);
  if (!bytecode || !impls) return null;
  const impl = implFromBytecode(bytecode);
  if (!impl) return null;
  if (impl === impls.standard)   return "Standard";
  if (impl === impls.tax)        return "Tax";
  if (impl === impls.reflection) return "Reflection";
  return null;
}

// ─── Token Created ────────────────────────────────────────────────────────────

/**
 * Emitted by LaunchpadFactory when a new meme token is deployed.
 * Initialises the Token row and zeroes out all running aggregates.
 *
 * virtualBNB and migrationTarget are included directly in the event.
 * tokenType is derived from the token's EIP-1167 implementation bytecode.
 */
ponder.on("LaunchpadFactory:TokenCreated", async ({ event, context }) => {
  const { token, creator, totalSupply, virtualBNB, migrationTarget, antibotEnabled, tradingBlock } =
    event.args;

  const tokenType = await resolveTokenType(token, event.log.address, context.client);

  await context.db.insert(schema.token).values({
    id:                 token,
    tokenType,
    creator,
    totalSupply,
    virtualBNB,
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
    migrationTarget,
  });
});

// ─── Bonding Curve Trades ─────────────────────────────────────────────────────

/**
 * Emitted by BondingCurve when a user buys tokens from the bonding curve.
 *
 * Stores the individual trade and updates the token's running stats:
 *   - Increments buyCount
 *   - Adds bnbIn to volumeBNB
 *   - Syncs raisedBNB to the latest on-chain value
 *
 * Note: tokensToDead is the portion burned as an antibot penalty and is
 * non-zero only during the antibot window (first N blocks after tradingBlock).
 */
ponder.on("BondingCurve:TokenBought", async ({ event, context }) => {
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
 * Emitted by BondingCurve when a user sells tokens back to the bonding curve.
 *
 * Stores the individual trade and updates the token's running stats:
 *   - Increments sellCount
 *   - Adds bnbOut to volumeBNB
 *   - Syncs raisedBNB to the latest on-chain value
 */
ponder.on("BondingCurve:TokenSold", async ({ event, context }) => {
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
 * Emitted by BondingCurve once the fundraising target is met.
 *
 * All raised BNB plus a portion of the token supply are deposited into a new
 * PancakeSwap V2 pair as permanent liquidity. This marks the end of the
 * bonding-curve phase.
 */
ponder.on("BondingCurve:TokenMigrated", async ({ event, context }) => {
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
