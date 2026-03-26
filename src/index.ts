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
import { keccak256, toBytes, parseAbi } from "viem";

// ─── Metadata helpers ─────────────────────────────────────────────────────────

const META_URI_ABI = parseAbi(["function metaURI() view returns (string)"]);

const IPFS_GATEWAY = (process.env.IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs/").replace(/\/?$/, "/");

function resolveUri(uri: string): string {
  if (uri.startsWith("ipfs://")) return IPFS_GATEWAY + uri.slice(7);
  if (uri.startsWith("ipfs/"))   return IPFS_GATEWAY + uri.slice(5);
  return uri;
}

interface TokenMeta {
  metaUri:  string;
  name:     string | null;
  symbol:   string | null;
  image:    string | null;
  website:  string | null;
  twitter:  string | null;
  telegram: string | null;
}

async function fetchTokenMeta(
  token:  `0x${string}`,
  client: { readContract: (...args: any[]) => Promise<unknown> },
): Promise<TokenMeta | null> {
  try {
    const uri = await client.readContract({
      address:      token,
      abi:          META_URI_ABI,
      functionName: "metaURI",
    }) as string;

    if (!uri || !uri.trim()) return null;

    const httpUri = resolveUri(uri.trim());
    const res = await fetch(httpUri, {
      signal:  AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return { metaUri: uri, name: null, symbol: null, image: null, website: null, twitter: null, telegram: null };

    const raw = await res.json() as Record<string, unknown>;

    // Support both flat fields and a nested `socials` object.
    const socials = (raw.socials && typeof raw.socials === "object")
      ? raw.socials as Record<string, unknown>
      : {} as Record<string, unknown>;

    const imageRaw = typeof raw.image === "string" ? raw.image : undefined;

    return {
      metaUri:  uri,
      name:     typeof raw.name   === "string" ? raw.name   : null,
      symbol:   typeof raw.symbol === "string" ? raw.symbol : null,
      image:    imageRaw ? resolveUri(imageRaw) : null,
      website:  typeof raw.website  === "string" ? raw.website  : null,
      twitter:  typeof (socials.twitter  ?? raw.twitter)  === "string" ? String(socials.twitter  ?? raw.twitter)  : null,
      telegram: typeof (socials.telegram ?? raw.telegram) === "string" ? String(socials.telegram ?? raw.telegram) : null,
    };
  } catch {
    return null;
  }
}

// ─── Token type from calldata ──────────────────────────────────────────────────
// The factory has three creation functions, one per token type:
//   createToken((string,string,uint8,bool,bool,uint256,string,bytes32)) → Standard
//   createTT((string,string,string,uint8,bool,bool,uint256,bytes32))    → Tax
//   createRFL((string,string,string,uint8,bool,bool,uint256,bytes32))   → Reflection
//
// The function selector (first 4 bytes of calldata) uniquely identifies which
// was called — no RPC calls needed.

function makeSelector(sig: string): string {
  return keccak256(toBytes(sig)).slice(0, 10).toLowerCase();
}

const SELECTOR_STANDARD   = makeSelector("createToken((string,string,uint8,bool,bool,uint256,string,bytes32))");
const SELECTOR_TAX        = makeSelector("createTT((string,string,string,uint8,bool,bool,uint256,bytes32))");
const SELECTOR_REFLECTION = makeSelector("createRFL((string,string,string,uint8,bool,bool,uint256,bytes32))");

function tokenTypeFromCalldata(input: `0x${string}`): string | null {
  const sel = input.slice(0, 10).toLowerCase();
  if (sel === SELECTOR_STANDARD)   return "Standard";
  if (sel === SELECTOR_TAX)        return "Tax";
  if (sel === SELECTOR_REFLECTION) return "Reflection";
  return null;
}

// ─── Token Created ────────────────────────────────────────────────────────────

/**
 * Emitted by LaunchpadFactory when a new meme token is deployed.
 * Initialises the Token row and zeroes out all running aggregates.
 *
 * virtualBNB and migrationTarget are included directly in the event.
 * tokenType is derived from the factory function selector in the creation calldata.
 */
ponder.on("LaunchpadFactory:TokenCreated", async ({ event, context }) => {
  const { token, creator, totalSupply, virtualBNB, migrationTarget, antibotEnabled, tradingBlock } =
    event.args;

  const tokenType = tokenTypeFromCalldata(event.transaction.input);

  const meta = await fetchTokenMeta(token, context.client);

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
    creationTxHash:     event.transaction.hash,
    migrated:           false,
    pairAddress:        null,
    buyCount:           0,
    sellCount:          0,
    volumeBNB:          0n,
    raisedBNB:          0n,
    migrationTarget,
    creatorTokens:      0n,  // updated by VestingWallet:VestingAdded when schedule is created
    metaUri:            meta?.metaUri  ?? null,
    name:               meta?.name     ?? null,
    symbol:             meta?.symbol   ?? null,
    image:              meta?.image    ?? null,
    website:            meta?.website  ?? null,
    twitter:            meta?.twitter  ?? null,
    telegram:           meta?.telegram ?? null,
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

  // Read current raisedBNB (pre-trade) for the opening price of this block.
  const tokenRow = await context.db.find(schema.token, { id: token });
  const preRaisedBNB = tokenRow?.raisedBNB ?? 0n;

  const snapshotId = `${token}-${event.block.number}`;
  await context.db
    .insert(schema.tokenSnapshot)
    .values({
      id:             snapshotId,
      token,
      blockNumber:    event.block.number,
      timestamp:      Number(event.block.timestamp),
      openRaisedBNB:  preRaisedBNB,
      closeRaisedBNB: raisedBNB,
      volumeBNB:      bnbIn,
      buyCount:       1,
      sellCount:      0,
    })
    .onConflictDoUpdate((row) => ({
      closeRaisedBNB: raisedBNB,
      volumeBNB:      row.volumeBNB + bnbIn,
      buyCount:       row.buyCount + 1,
    }));

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

  const tokenRow = await context.db.find(schema.token, { id: token });
  const preRaisedBNB = tokenRow?.raisedBNB ?? 0n;

  const snapshotId = `${token}-${event.block.number}`;
  await context.db
    .insert(schema.tokenSnapshot)
    .values({
      id:             snapshotId,
      token,
      blockNumber:    event.block.number,
      timestamp:      Number(event.block.timestamp),
      openRaisedBNB:  preRaisedBNB,
      closeRaisedBNB: raisedBNB,
      volumeBNB:      bnbOut,
      buyCount:       0,
      sellCount:      1,
    })
    .onConflictDoUpdate((row) => ({
      closeRaisedBNB: raisedBNB,
      volumeBNB:      row.volumeBNB + bnbOut,
      sellCount:      row.sellCount + 1,
    }));

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

  // Once a token migrates to PancakeSwap every swap emits 2-3 Transfer events
  // (router → pair, pair → recipient, etc.) — not useful for bonding-curve
  // holder tracking and the volume would bloat the table with DEX addresses.
  const tokenRow = await context.db.find(schema.token, { id: token });
  if (tokenRow?.migrated) return;

  const ZERO = "0x0000000000000000000000000000000000000000";

  const blockNumber         = event.block.number;
  const lastUpdatedTimestamp = Number(event.block.timestamp);

  // Deduct from sender (skip zero address = mint)
  if (from !== ZERO) {
    await context.db
      .insert(schema.holder)
      // On first-ever transfer out from this address, initialise balance as negative.
      // The onConflictDoUpdate will correct it once the matching credit arrives.
      // This upsert pattern ensures row creation and update are a single atomic op.
      .values({ token, address: from, balance: -value, lastUpdatedBlock: blockNumber, lastUpdatedTimestamp })
      .onConflictDoUpdate((row) => ({ balance: row.balance - value, lastUpdatedBlock: blockNumber, lastUpdatedTimestamp }));
  }

  // Credit receiver (skip zero address = burn)
  if (to !== ZERO) {
    await context.db
      .insert(schema.holder)
      .values({ token, address: to, balance: value, lastUpdatedBlock: blockNumber, lastUpdatedTimestamp })
      .onConflictDoUpdate((row) => ({ balance: row.balance + value, lastUpdatedBlock: blockNumber, lastUpdatedTimestamp }));
  }
});

// ─── Vesting ──────────────────────────────────────────────────────────────────

/**
 * Emitted by VestingWallet when the factory creates a new vesting schedule
 * during token creation. The beneficiary is the token creator; the amount
 * is exactly 5% of total supply (CREATOR_BPS = 500) when enableCreatorAlloc
 * is true. No event fires when the creator opts out (amount = 0).
 *
 * Also backfills creatorTokens on the parent token row so the frontend can
 * show the creator allocation without a separate vesting query.
 */
ponder.on("VestingWallet:VestingAdded", async ({ event, context }) => {
  const { token, beneficiary, amount } = event.args;

  await context.db.insert(schema.vesting).values({
    token,
    beneficiary,
    amount,
    blockNumber: event.block.number,
    start:       Number(event.block.timestamp),
    claimed:     0n,
    voided:      false,
    burned:      0n,
  });

  // Backfill creatorTokens on the token row for fast API reads.
  // Token row may not exist yet if VestingAdded fires before TokenCreated.
  try {
    await context.db
      .update(schema.token, { id: token })
      .set({ creatorTokens: amount });
  } catch (err) {
    // Token not yet indexed — skip, creatorTokens starts at 0n from TokenCreated handler.
    // Log unexpected errors so they're visible in Ponder's output.
    console.warn("[VestingAdded] token update skipped:", token, err);
  }
});

/**
 * Emitted when a beneficiary calls claim() and receives unlocked tokens.
 * Vesting is linear over 365 days with no cliff; claimable amount grows
 * continuously from the schedule start timestamp.
 */
ponder.on("VestingWallet:Claimed", async ({ event, context }) => {
  const { token, beneficiary, amount } = event.args;

  // VestingAdded always fires before Claimed (contract guarantee).
  // Update only — accumulate claimed amount on the existing row.
  await context.db
    .update(schema.vesting, { token, beneficiary })
    .set((row) => ({ claimed: row.claimed + amount }));
});

/**
 * Emitted when the VestingWallet owner voids a schedule before it has fully
 * unlocked. The unvested remainder is burned to the dead address (0x...dEaD).
 * After voiding, no further claims are possible for this (token, beneficiary).
 */
ponder.on("VestingWallet:VestingVoided", async ({ event, context }) => {
  const { token, beneficiary, burned } = event.args;

  // VestingAdded always fires before VestingVoided (contract guarantee).
  // Update only — mark the existing row as voided and record the burned amount.
  await context.db
    .update(schema.vesting, { token, beneficiary })
    .set({ voided: true, burned });
});
