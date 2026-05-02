# OneMEME Launchpad API

REST API for the OneMEME Launchpad on BSC. Reads all on-chain data from The Graph subgraph and exposes a typed HTTP API for the frontend.

---

## Stack

| Layer | Technology |
|---|---|
| On-chain data | [The Graph](https://thegraph.com) subgraph (GraphQL) |
| API | NestJS + Node.js |
| Database | PostgreSQL (Neon) — off-chain data only |
| Chain | BSC Mainnet (chainId 56) |

---

## Architecture

```
BSC chain events
      │
      ▼
The Graph Subgraph  ────────────────────►  Subgraph GraphQL endpoint
  (SUBGRAPH_URL)                                     │
  token / trade / holder /                           │
  migration / vesting / snapshot                     ▼
                                        NestJS REST API (port 3001)
                                          └─ /api/v1/<chain>/*
                                          │
                          PostgreSQL ◄────┘
                          (off-chain only:
                           points, referrals, chat)
```

The API is a single process running under PM2. On-chain data comes entirely from the subgraph over GraphQL. PostgreSQL stores only the three off-chain tables that have no on-chain equivalent.

---

## Subgraph Schema

The API queries these entities from the subgraph. All numeric fields are `BigInt` in GraphQL, returned as strings in the API.

### `token`

| Field | Type | Description |
|---|---|---|
| `id` | hex | Token contract address (PK) |
| `tokenType` | text | `"Standard"` \| `"Tax"` \| `"Reflection"` |
| `creator` | hex | Address that called `createToken` |
| `totalSupply` | bigint | Total supply at launch (wei) |
| `virtualBNB` | bigint | Base virtual BNB liquidity — constant set at creation (wei) |
| `antibotEnabled` | boolean | Whether antibot penalty was enabled at launch |
| `tradingBlock` | bigint | Block after which normal trading began |
| `createdAtBlock` | bigint | Block of `TokenCreated` event |
| `createdAtTimestamp` | integer | Unix timestamp of `TokenCreated` event |
| `creationTxHash` | hex | Transaction hash of `TokenCreated` event |
| `migrated` | boolean | Whether token has migrated to PancakeSwap |
| `pairAddress` | hex | PancakeSwap V2 pair address (null until migrated) |
| `buyCount` | integer | Total bonding-curve buy transactions |
| `sellCount` | integer | Total bonding-curve sell transactions |
| `volumeBNB` | bigint | Total BNB traded (buys + sells, wei) |
| `raisedBNB` | bigint | Cumulative BNB raised on bonding curve (wei) |
| `migrationTarget` | bigint | BNB required to trigger migration (wei) |
| `creatorTokens` | bigint | Creator vesting allocation (wei, 5% of supply if enabled) |
| `metaUri` | text | Raw `metaURI` string from the token contract (nullable) |
| `name` | text | Token display name (nullable) |
| `symbol` | text | Token ticker (nullable) |
| `description` | text | Token description (nullable) |
| `image` | text | IPFS CID of the token image — resolve via your preferred gateway (nullable) |
| `website` | text | Project website URL (nullable) |
| `twitter` | text | Twitter / X link (nullable) |
| `telegram` | text | Telegram link (nullable) |

Virtual liquidity at any point = `virtualBNB + raisedBNB`. The API exposes this as the `virtualLiquidityBNB` computed field.

### `trade`

| Field | Type | Description |
|---|---|---|
| `id` | text | `{txHash}-{logIndex}` (PK) |
| `token` | hex | Token contract address |
| `tradeType` | text | `"buy"` \| `"sell"` |
| `trader` | hex | Buyer or seller address |
| `bnbAmount` | bigint | BNB in (buy) or BNB out (sell), wei |
| `tokenAmount` | bigint | Gross tokens out (buy) or tokens in (sell), wei |
| `tokensToDead` | bigint | Antibot burn to dead address (buy only, null for sells) |
| `raisedBNB` | bigint | Cumulative BNB raised at this trade (wei) |
| `blockNumber` | bigint | BSC block number |
| `txHash` | hex | Transaction hash |
| `timestamp` | integer | Unix timestamp (seconds) |

### `holder`

| Field | Type | Description |
|---|---|---|
| `token` | hex | Token contract address |
| `address` | hex | Wallet address |
| `balance` | bigint | Current token balance (wei) |
| `lastUpdatedBlock` | bigint | Block of the most recent Transfer touching this row |
| `lastUpdatedTimestamp` | integer | Unix timestamp of the most recent Transfer |

Composite PK: `(token, address)`. Only populated while the token is on the bonding curve — Transfer tracking stops after migration.

### `migration`

| Field | Type | Description |
|---|---|---|
| `id` | hex | Token address (PK) |
| `token` | hex | Token address |
| `pair` | hex | PancakeSwap V2 pair address |
| `liquidityBNB` | bigint | BNB deposited as permanent liquidity (wei) |
| `liquidityTokens` | bigint | Tokens deposited as permanent liquidity (wei) |
| `blockNumber` | bigint | Block of `TokenMigrated` event |
| `txHash` | hex | Transaction hash |
| `timestamp` | integer | Unix timestamp (seconds) |

### `vesting`

| Field | Type | Description |
|---|---|---|
| `token` | hex | Token address |
| `beneficiary` | hex | Creator wallet (vesting recipient) |
| `amount` | bigint | Total tokens locked at start (wei) |
| `blockNumber` | bigint | Block of the `VestingAdded` event |
| `start` | integer | Unix timestamp vesting began |
| `claimed` | bigint | Tokens claimed so far (wei) |
| `voided` | boolean | Whether schedule was voided early |
| `burned` | bigint | Tokens burned on void (wei) |

Composite PK: `(token, beneficiary)`.

### `tokenSnapshot`

One row per `(token, block)` — written on every bonding-curve trade. Used by the TradingView chart endpoints.

| Field | Type | Description |
|---|---|---|
| `id` | text | `{tokenAddress}-{blockNumber}` (PK) |
| `token` | hex | Token contract address |
| `blockNumber` | bigint | BSC block number |
| `timestamp` | integer | Unix timestamp (seconds) |
| `openRaisedBNB` | bigint | Cumulative raisedBNB before the first trade of this block |
| `closeRaisedBNB` | bigint | Cumulative raisedBNB after the last trade of this block |
| `volumeBNB` | bigint | Total BNB traded in this block (wei) |
| `buyCount` | integer | Buy trades in this block |
| `sellCount` | integer | Sell trades in this block |

AMM spot price at any snapshot (BNB/token):
- `virtualLiquidity = virtualBNB + raisedBNB`
- `price = virtualLiquidity² / (virtualBNB × totalSupply)`

---

## Off-chain Database Schema

PostgreSQL stores only data that has no on-chain equivalent. These tables persist independently of the subgraph.

### `point_event`

| Column | Type | Description |
|---|---|---|
| `id` | bigserial | PK |
| `wallet` | text | Wallet address |
| `event_type` | text | `TOKEN_CREATED` \| `BUY` \| `SELL` \| `TOKEN_MIGRATED` \| `REFERRAL_BONUS` |
| `points` | numeric | Points awarded |
| `token` | text | Token address (null for referral bonus) |
| `source_id` | text | Internal dedup key — never exposed |
| `timestamp` | bigint | Unix timestamp |

### `referral`

| Column | Type | Description |
|---|---|---|
| `wallet` | text | Referred wallet address (PK) |
| `referrer` | text | Referrer wallet address |
| `registered_at` | bigint | Unix timestamp of registration |
| `credited` | boolean | Whether the referral bonus has been awarded |

### `chat_message`

| Column | Type | Description |
|---|---|---|
| `id` | bigserial | PK |
| `token` | text | Token address the message belongs to |
| `sender` | text | Verified wallet address of the sender |
| `text` | text | Message content (max 500 Unicode code points) |
| `timestamp` | bigint | Unix timestamp |

---

## REST API

**Base URL:** `https://api.1coin.meme/api/v1/bsc`

The `bsc` segment is the chain slug, set via the `CHAIN_SLUG` environment variable (default: `bsc`). All routes are served under `/api/v1/<chain>/`.

All paginated endpoints return:
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 142,
    "pages": 8,
    "hasMore": true
  }
}
```

All `bigint` / `numeric` fields are returned as **strings** to preserve precision.

### Rate Limits

| Route pattern | Limit |
|---|---|
| `/api/v1/{chain}/tokens/*/quote/*` | 20 req / min (live RPC) |
| `/api/v1/{chain}/dex/quote` | 20 req / min (live RPC) |
| `/api/v1/{chain}/dex/route` | 20 req / min (live RPC) |
| `/api/v1/{chain}/stats` | 10 req / min (heavy aggregation) |
| `POST *` | 10 req / min |
| Everything else (GET) | 60 req / min |

---

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check (not chain-scoped) |

---

### Tokens

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/tokens` | Paginated token list with pricing |
| `GET` | `/api/v1/{chain}/tokens/:address` | Single token — live PancakeSwap price if migrated |
| `GET` | `/api/v1/{chain}/tokens/:address/trades` | Trades for a token |
| `GET` | `/api/v1/{chain}/tokens/:address/traders` | Per-trader stats for a token |
| `GET` | `/api/v1/{chain}/tokens/:address/holders` | Token holder balances |
| `GET` | `/api/v1/{chain}/tokens/:address/migration` | Migration details (404 if not migrated) |
| `GET` | `/api/v1/{chain}/tokens/:address/snapshots` | Per-block bonding-curve history with AMM price |
| `GET` | `/api/v1/{chain}/tokens/:address/quote/price` | Live bonding-curve spot price (RPC) |
| `GET` | `/api/v1/{chain}/tokens/:address/quote/buy` | Buy quote with price impact (RPC) |
| `GET` | `/api/v1/{chain}/tokens/:address/quote/sell` | Sell quote with price impact (RPC) |
| `POST` | `/api/v1/{chain}/tokens/:address/metadata/refresh` | Re-read `metaURI()` from chain and re-fetch IPFS metadata |

**`GET /api/v1/{chain}/tokens` query params:**

| Param | Default | Description |
|---|---|---|
| `page` | `1` | Page number |
| `limit` | `20` | Results per page (max 100) |
| `type` | — | `Standard` \| `Tax` \| `Reflection` |
| `migrated` | — | `true` \| `false` |
| `orderBy` | `created_at_block` | `created_at_block` \| `volume_bnb` \| `buy_count` \| `sell_count` \| `raised_bnb` \| `total_supply` |
| `orderDir` | `desc` | `asc` \| `desc` |

**Computed fields on every token object:**

| Field | Description |
|---|---|
| `virtualLiquidityBNB` | `virtualBNB + raisedBNB` (wei string) — effective BNB depth of the bonding curve |
| `priceBnb` | BNB per token. Bonding curve: `virtualLiquidity² / (virtualBNB × totalSupply)`. Migrated (list): migration-time liquidity ratio. Migrated (single): live `getReserves()` from PancakeSwap. |
| `priceUsd` | `priceBnb × bnbSpotPrice` (10 decimal string, null if price feed unavailable) |
| `marketCapBnb` | `priceBnb × totalSupply` in BNB |
| `marketCapUsd` | `marketCapBnb × bnbSpotPrice` (2 decimal string) |

**`GET /api/v1/{chain}/tokens/:address/trades` query params:**

| Param | Default | Description |
|---|---|---|
| `page` / `limit` | 1 / 20 | Pagination |
| `type` | — | `buy` \| `sell` |
| `from` / `to` | — | Unix timestamp range |
| `orderBy` | `timestamp` | `timestamp` \| `bnb_amount` \| `token_amount` \| `block_number` |
| `orderDir` | `desc` | `asc` \| `desc` |

**`GET /api/v1/{chain}/tokens/:address/traders` query params:**

| Param | Default | Description |
|---|---|---|
| `page` / `limit` | 1 / 20 | Pagination |
| `orderBy` | `totalVolumeBNB` | `totalVolumeBNB` \| `totalTrades` \| `buyCount` \| `sellCount` \| `netBNB` |
| `orderDir` | `desc` | `asc` \| `desc` |

**`GET /api/v1/{chain}/tokens/:address/snapshots` query params:**

| Param | Default | Description |
|---|---|---|
| `page` / `limit` | 1 / 100 | Pagination |
| `from` / `to` | — | Unix timestamp range |

**`GET /api/v1/{chain}/tokens/:address/quote/buy` query params:**

| Param | Required | Description |
|---|---|---|
| `bnbIn` | Yes | BNB input in wei |
| `slippage` | No | Basis points (default `100` = 1%) |

**`GET /api/v1/{chain}/tokens/:address/quote/sell` query params:**

| Param | Required | Description |
|---|---|---|
| `tokensIn` | Yes | Token input in wei |
| `slippage` | No | Basis points (default `100` = 1%) |

---

### Creators

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/creators/:address/tokens` | Tokens launched by this address (includes pricing) |
| `GET` | `/api/v1/{chain}/creators/:address/vesting` | Vesting schedules for this creator |

---

### Trades

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/trades` | All trades, paginated |
| `GET` | `/api/v1/{chain}/traders/:address/trades` | All trades by a specific wallet |

---

### Migrations

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/migrations` | All migration events, paginated |

---

### Activity Feed

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/activity` | Last 15 create/buy/sell events — flat array for header marquee |
| `GET` | `/api/v1/{chain}/activity/stream` | SSE — pushes new events as they are indexed |
| `WS` | `/api/v1/{chain}/activity/ws` | WebSocket — same real-time feed |

**`GET /api/v1/{chain}/activity/stream` / WS query params:**

| Param | Description |
|---|---|
| `type` | Filter: `create` \| `buy` \| `sell` |
| `token` | Filter to a specific token address |

**Activity event shape:**
```json
{
  "eventType":   "buy",
  "token":       "0xabc...1111",
  "actor":       "0xbuyer...",
  "bnbAmount":   "500000000000000000",
  "tokenAmount": "6172839000000000000000",
  "blockNumber": "42001234",
  "timestamp":   1741823000,
  "txHash":      "0xabc..."
}
```

`actor` = creator for create events, trader for buy/sell. `bnbAmount` / `tokenAmount` = `null` for create events.

SSE sends `type: "activity"` events and periodic `type: "keepalive"` pings every 15 seconds. On connect, the 15 most recent events are replayed oldest-first before live polling begins.

WebSocket sends `{ event: "activity", data: "<JSON string>" }`.

---

### Discover

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/discover/trending` | Tokens with the most trades in the last 5 minutes |
| `GET` | `/api/v1/{chain}/discover/new` | Newest non-migrated tokens |
| `GET` | `/api/v1/{chain}/discover/bonding` | Active bonding-curve tokens sorted by `raisedBNB` |
| `GET` | `/api/v1/{chain}/discover/migrated` | Migrated tokens with liquidity details |

**`GET /api/v1/{chain}/discover/trending` query params:**

| Param | Default | Description |
|---|---|---|
| `type` | — | `Standard` \| `Tax` \| `Reflection` |
| `page` / `limit` | 1 / 20 | Pagination |

Trending objects include: `recentTrades`, `recentBuys`, `recentSells`, `recentVolumeBNB`, `priceBnb`, `priceUsd`, `marketCapBnb`, `marketCapUsd`.

**`GET /api/v1/{chain}/discover/new` / `/api/v1/{chain}/discover/bonding` query params:**

| Param | Description |
|---|---|
| `type` | `Standard` \| `Tax` \| `Reflection` |
| `page` / `limit` | Pagination |

**`GET /api/v1/{chain}/discover/migrated` query params:**

| Param | Default | Description |
|---|---|---|
| `orderBy` | `migratedAt` | `migratedAt` \| `liquidityBNB` \| `volumeBNB` |
| `orderDir` | `desc` | `asc` \| `desc` |
| `type` | — | Token type filter |

---

### Stats

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/stats` | Platform-wide aggregated statistics |

Returns: `totalTokens`, `migratedTokens`, `activeTokens`, `tokensByType`, `totalTrades`, `totalBuys`, `totalSells`, `uniqueTraders`, `totalVolumeBNB`, `totalLiquidityBNB`, `topTokenByVolume`.

---

### Leaderboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/leaderboard/tokens` | Tokens ranked by trading activity |
| `GET` | `/api/v1/{chain}/leaderboard/creators` | Creators ranked by tokens launched and BNB raised |
| `GET` | `/api/v1/{chain}/leaderboard/traders` | Traders ranked by BNB volume |
| `GET` | `/api/v1/{chain}/leaderboard/users` | Combined traders + creators |

**Common query params:**

| Param | Default | Description |
|---|---|---|
| `period` | `alltime` | `1d` \| `7d` \| `30d` \| `alltime` |
| `page` / `limit` | 1 / 20 | Pagination |

**`GET /api/v1/{chain}/leaderboard/tokens` additional param:**

| Param | Default | Description |
|---|---|---|
| `orderBy` | `volumeBNB` | `volumeBNB` \| `tradeCount` \| `buyCount` \| `sellCount` \| `raisedBNB` |

---

### Charts (TradingView UDF)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/charts/config` | UDF configuration |
| `GET` | `/api/v1/{chain}/charts/time` | Server unix timestamp |
| `GET` | `/api/v1/{chain}/charts/symbols?symbol=:address` | Symbol metadata |
| `GET` | `/api/v1/{chain}/charts/history` | OHLCV bars |
| `GET` | `/api/v1/{chain}/charts/search?query=:addr` | Symbol search |

OHLCV price is computed from the bonding-curve AMM formula using `tokenSnapshot` data — not raw per-trade ratios.

**`GET /api/v1/{chain}/charts/history` query params:**

| Param | Required | Description |
|---|---|---|
| `symbol` | Yes | Token address |
| `resolution` | Yes | `1` \| `5` \| `15` \| `30` \| `60` \| `240` \| `D` |
| `from` | No | Start unix timestamp |
| `to` | No | End unix timestamp (default: now) |
| `countback` | No | Number of bars |

---

### Vesting

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/vesting/:token` | Vesting schedule for a specific token |
| `GET` | `/api/v1/{chain}/creators/:address/vesting` | All vesting schedules for a creator |

Responses include computed fields: `claimable` (currently unlocked and unclaimed), `vestingEnds` (unix timestamp), `progressPct` (0–100).

---

### BNB Price

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/price/bnb` | BNB/USDT aggregated from 6 exchanges |

Sources: CoinGecko (free API) and PancakeSwap WBNB/USDT on-chain pair (via `getReserves()`). Refreshed every 10 seconds. Returns the average with a per-source breakdown.

---

### Chat

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/chat/:token/messages` | Last 50 messages for a token (oldest-first) |

**`GET /api/v1/{chain}/chat/:token/messages` query params:**

| Param | Default | Description |
|---|---|---|
| `limit` | `50` | Number of messages (max 200) |

Messages support full Unicode including emoji. WebSocket connection via `wss://<host>/api/v1/{chain}/chat/ws`.

**WebSocket protocol:**

Connection requires EIP-191 wallet authentication before messages can be sent.

```jsonc
// 1. Server → client (immediately on connect)
{ "type": "challenge", "nonce": "abc123", "message": "Sign: \"OneMEME Chat Auth\nNonce: abc123\" to authenticate" }

// 2. Client → server (sign the message with the user's wallet)
{ "type": "auth", "address": "0xUser...", "sig": "0x65-byte-sig..." }

// 3. Server → client (auth confirmed)
{ "type": "authenticated", "address": "0xuser..." }

// 4. Client → server (join a token room — after auth)
{ "type": "subscribe", "token": "0x..." }

// 5. Server → client (history replay after subscribe)
{ "type": "history", "messages": [...] }

// 6. Client → server (send a message — must be subscribed)
{ "type": "message", "text": "…" }

// Server → client (live message broadcast)
{ "type": "message", "id": "…", "token": "…", "sender": "…", "text": "…", "timestamp": 0 }
{ "type": "error", "message": "…" }
{ "type": "keepalive" }                              // every 15 s
```

The `sender` in broadcast messages is the server-verified wallet address — clients cannot spoof it.

Chat rate limits: 1 message per 3 s per IP (global), 5 messages per minute per IP per token.

---

### Points

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/{chain}/points/leaderboard` | public | Top wallets by total points (paginated) |
| `GET` | `/api/v1/{chain}/points/:wallet` | public | Wallet total points + per-event breakdown |
| `GET` | `/api/v1/{chain}/points/export` | `X-Admin-Key` header | Full dump of all wallets for reward issuance |

Points are awarded automatically by a background poller every 30 seconds:

| Action | Points |
|---|---|
| Launch a token | 5 |
| Buy trade | 1 |
| Sell trade | 0.5 |
| Token graduates to DEX (migration) | 80 |
| Referral bonus (one-time to referrer) | 10 |

Set `POINTS_START_BLOCK` to start a new season — only events at or after that block earn points. Falls back to `START_BLOCK` if unset.

The export endpoint requires the `X-Admin-Key: <ADMIN_SECRET>` header. Disabled when `ADMIN_SECRET` is not set.

---

### Referrals

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/{chain}/referrals/register` | Register a referral relationship |
| `GET` | `/api/v1/{chain}/referrals/:wallet` | Referrer stats (referred count, credited count, bonus points) |

**`POST /api/v1/{chain}/referrals/register` body:**
```json
{ "referred": "0xUserWhoClicked...", "referrer": "0xWhoSharedTheLink..." }
```

Must be called **before** the referred wallet makes any on-chain action.

**Registration is rejected if:**
- Self-referral (`referred === referrer`)
- Mutual referral (referrer is already registered as referred by this wallet)
- Referred wallet already has trades or tokens on-chain
- Referred wallet already has a registered referrer (returns `409`)

**Referral bonus is credited once the referred wallet:**
- Completes ≥5 trades with combined BNB volume worth ≥$50 USD, **or**
- Launches at least one token

The bonus (10 pts) is awarded to the **referrer**. The check runs every 30 seconds in the background.

---

### DEX

All DEX endpoints live under `/api/v1/{chain}/dex/`. They require the aggregator subgraph and DEX contract addresses to be configured — all return `503` when the DEX layer is not set up. See [DEX-Examples.md](DEX-Examples.md) for full request/response examples.

**Data endpoints**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/dex/adapters` | Supported routing adapters and their on-chain `bytes32` IDs |
| `GET` | `/api/v1/{chain}/dex/stats` | Aggregated DEX platform statistics |
| `GET` | `/api/v1/{chain}/dex/tokens` | Paginated DEX token list (pools, volume, price) |
| `GET` | `/api/v1/{chain}/dex/tokens/:address` | Single DEX token with pools and price |
| `GET` | `/api/v1/{chain}/dex/tokens/:address/pools` | Liquidity pools for a token |
| `GET` | `/api/v1/{chain}/dex/tokens/:address/trades` | Trade history for a DEX token |
| `GET` | `/api/v1/{chain}/dex/swaps` | All DEX swap events, paginated |

**Swap / quote endpoints**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/dex/quote` | Live on-chain quote (simulates expected output) |
| `GET` | `/api/v1/{chain}/dex/route` | Optimal multi-hop route with pre-encoded adapter data |
| `POST` | `/api/v1/{chain}/dex/swap` | Build `OneMEMEAggregator.swap()` calldata (self-broadcast) |
| `POST` | `/api/v1/{chain}/dex/batch-swap` | Build `OneMEMEAggregator.batchSwap()` calldata (self-broadcast) |

**Gasless / meta-transaction endpoints**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/{chain}/dex/metatx/nonce/:user` | On-chain nonce for a user |
| `POST` | `/api/v1/{chain}/dex/metatx/digest` | EIP-712 digest for a single-hop gasless swap |
| `POST` | `/api/v1/{chain}/dex/metatx/relay` | Relay a signed `MetaTxOrder` on-chain |
| `POST` | `/api/v1/{chain}/dex/metatx/batch-digest` | EIP-712 digest for a multi-hop gasless swap |
| `POST` | `/api/v1/{chain}/dex/metatx/batch-relay` | Relay a signed `BatchMetaTxOrder` on-chain |

**Native BNB support**

Pass `0x0000000000000000000000000000000000000000` as `tokenIn` or `tokenOut` in any swap/quote/route endpoint. The API automatically normalises it to WBNB for routing. Responses include:

| Field | Description |
|---|---|
| `nativeIn` | `true` when the original `tokenIn` was the zero address — caller must send `msg.value = amountIn` |
| `nativeOut` | `true` when the original `tokenOut` was the zero address — final output is unwrapped BNB |
| `value` | ETH value to attach to the transaction (wei string, `"0"` when `nativeIn` is false) |

**Supported adapters**

| Name | Category | Notes |
|---|---|---|
| `ONEMEME_BC` | bonding-curve | OneMEME Launchpad bonding curve |
| `FOURMEME` | bonding-curve | FourMEME bonding curve |
| `FLAPSH` | bonding-curve | Flap.SH bonding curve |
| `PANCAKE_V2` | amm-v2 | PancakeSwap V2 |
| `PANCAKE_V3` | amm-v3 | PancakeSwap V3 (fee param required) |
| `PANCAKE_V4` | amm-v4 | PancakeSwap V4 |
| `UNISWAP_V2` | amm-v2 | Uniswap V2 on BSC |
| `UNISWAP_V3` | amm-v3 | Uniswap V3 on BSC |
| `UNISWAP_V4` | amm-v4 | Uniswap V4 on BSC |

**Gasless swap flow (single-hop)**

```
1. GET  /dex/metatx/nonce/:user   → nonce
2. POST /dex/metatx/digest        → { digest, order }
3. wallet.signMessage(digest)     → sig
4. POST /dex/metatx/relay         → { txHash }
```

**Gasless swap flow (multi-hop)**

```
1. GET  /dex/route                → { steps[] }
2. GET  /dex/metatx/nonce/:user   → nonce
3. POST /dex/metatx/batch-digest  → { digest, order }
4. wallet.signMessage(digest)     → sig
5. POST /dex/metatx/batch-relay   → { txHash }
```

---

### Metadata Upload

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/{chain}/metadata/upload` | Pin token metadata and image to IPFS via Pinata |

**Form fields (`multipart/form-data`):**

| Field | Required | Description |
|---|---|---|
| `image` | Yes | Token image (jpeg/png/gif/webp/svg, max 3 MB) |
| `name` | Yes | Token display name |
| `symbol` | Yes | Ticker symbol |
| `description` | Yes | Short description |
| `website` | No | Project website URL |
| `x` | No | Twitter/X URL or handle |
| `telegram` | No | Telegram link |

Returns `{ metaURI, ipfsHash, gatewayUrl, imageUri }`. Pass `metaURI` to `tokenContract.setMetaURI()`.

---

## Running Locally

```bash
git clone https://github.com/timedbase/OneMEMELaunchpad-Indexer
cd OneMEMELaunchpad-Indexer
npm install
cp .env.example .env   # fill in SUBGRAPH_URL, BSC_RPC_URL, DATABASE_URL at minimum
docker compose up -d   # start local Postgres (for points, referrals, chat)
npm run api:dev        # API on http://localhost:3001
```

---

## Production Deployment (Docker / VPS)

Build and run the production image:

```bash
docker build -t onememe-launchpad .

docker run -d \
  --name onememe-launchpad \
  --restart unless-stopped \
  -p 3001:3001 \
  --env-file .env \
  onememe-launchpad
```

### Required env additions for production

```env
# Points export — set a strong random secret
ADMIN_SECRET=your-strong-random-secret

# Restrict CORS to your frontend
ALLOWED_ORIGINS=https://app.1coin.meme

# Rate limiter reads real client IP from Cloudflare headers
TRUST_PROXY=true
```

### TLS / SSL

TLS is terminated externally by Cloudflare. Do **not** set `SSL_CERT_PATH` or `SSL_KEY_PATH` unless you are running without Cloudflare; setting them to a path that doesn't exist will crash the API on startup.

### Updating on VPS

```bash
git pull
docker build -t onememe-launchpad .
docker stop onememe-launchpad && docker rm onememe-launchpad
docker run -d \
  --name onememe-launchpad \
  --restart unless-stopped \
  -p 3001:3001 \
  --env-file .env \
  onememe-launchpad
docker logs -f onememe-launchpad
```

The API is stateless — no volumes needed. All persistent state is in PostgreSQL (off-chain tables) and The Graph subgraph (on-chain data).

---

## Environment Variables

**Core**

| Variable | Required | Description |
|---|---|---|
| `SUBGRAPH_URL` | Yes | The Graph subgraph GraphQL endpoint — primary on-chain data source |
| `SUBGRAPH_API_KEY` | No | Bearer auth token for self-hosted subgraph nodes |
| `BSC_RPC_URL` | Yes | BSC HTTP RPC — used for live quote simulation and PancakeSwap price reads |
| `BONDING_CURVE_ADDRESS` | Yes | `BondingCurve` contract address (required for `/quote/*` endpoints) |
| `DATABASE_URL` | Yes | PostgreSQL connection string (off-chain tables only) |
| `CHAIN_ID` | No | EVM chain ID, defaults to `56` |
| `CHAIN_SLUG` | No | Chain name in API routes, defaults to `bsc` |
| `API_PORT` | No | REST API port, defaults to `3001` |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins (e.g. `https://app.1coin.meme`); unset = all origins allowed |
| `TRUST_PROXY` | No | Set `true` when behind Cloudflare/nginx so rate limiter reads `X-Forwarded-For` |
| `SSL_CERT_PATH` | No | TLS certificate path (omit when Cloudflare terminates TLS) |
| `SSL_KEY_PATH` | No | TLS private key path |
| `PINATA_JWT` | No | Required for metadata upload endpoint |
| `IPFS_GATEWAY` | No | Custom IPFS gateway URL |
| `BETTERSTACK_TOKEN` | No | Better Stack log shipping token |
| `POINTS_START_BLOCK` | No | Only award points for events at/after this block (season start) |
| `START_BLOCK` | No | Fallback for `POINTS_START_BLOCK` when that var is unset |
| `ADMIN_SECRET` | No | Enables `GET /points/export`; pass as `X-Admin-Key` header |

**DEX layer** (all optional — omit to disable `/dex/*` endpoints)

| Variable | Description |
|---|---|
| `AGGREGATOR_SUBGRAPH_URL` | Aggregator subgraph endpoint (FourMEME / Flap.SH / OneMEMEAggregator data) |
| `AGGREGATOR_SUBGRAPH_API_KEY` | Bearer auth for the aggregator subgraph |
| `THE_GRAPH_API_KEY` | The Graph decentralised network key for PancakeSwap V3/V4 and Uniswap subgraphs |
| `PANCAKE_V2_SUBGRAPH_URL` | Override for PancakeSwap V2 subgraph |
| `PANCAKE_V3_SUBGRAPH_URL` | Override for PancakeSwap V3 subgraph |
| `PANCAKE_V4_SUBGRAPH_URL` | Override for PancakeSwap V4 subgraph |
| `UNISWAP_V2_SUBGRAPH_URL` | Override for Uniswap V2 subgraph |
| `UNISWAP_V3_SUBGRAPH_URL` | Override for Uniswap V3 subgraph |
| `UNISWAP_V4_SUBGRAPH_URL` | Override for Uniswap V4 subgraph |
| `AGGREGATOR_ADDRESS` | `OneMEMEAggregator` contract address (required for swap calldata) |
| `METATX_ADDRESS` | `OneMEMEMetaTx` contract address (required for gasless relay) |
| `RELAYER_PRIVATE_KEY` | 0x-prefixed EOA private key for the gas-paying relayer account |
| `PANCAKE_V2_ROUTER_ADDRESS` | Override PancakeSwap V2 router (default: BSC mainnet) |
| `PANCAKE_V3_QUOTER_ADDRESS` | Override PancakeSwap V3 quoter (default: BSC mainnet) |
| `UNISWAP_V2_ROUTER_ADDRESS` | Override Uniswap V2 router (default: BSC mainnet) |
| `UNISWAP_V3_QUOTER_ADDRESS` | Uniswap V3 quoter (no BSC default — set for your deployment) |
| `PANCAKE_V4_QUOTER_ADDRESS` | PancakeSwap V4 quoter |
| `UNISWAP_V4_QUOTER_ADDRESS` | Uniswap V4 quoter |
| `FOURMEME_HELPER_ADDRESS` | Override FourMEME TokenManagerHelper3 (default: BSC mainnet) |
| `FLAPSH_PORTAL_ADDRESS` | Override Flap.SH Portal contract (default: BSC mainnet) |

---

## Project Structure

```
├── abis/                        # Contract ABIs (used by rpc.ts + dex-rpc.ts)
├── src/api/
│   ├── main.ts
│   ├── app.module.ts
│   ├── db.ts                    # postgres.js client (off-chain tables only)
│   ├── rpc.ts                   # Viem client, bonding curve quotes, PancakeSwap price
│   ├── subgraph.ts              # Launchpad subgraph GraphQL client + pagination
│   ├── helpers.ts
│   ├── metadata.ts
│   ├── common/
│   │   ├── client-ip.ts         # IP extraction (TRUST_PROXY-aware)
│   │   └── rate-limit.middleware.ts
│   └── modules/
│       ├── tokens/              # /api/v1/{chain}/tokens, /creators/:addr/tokens
│       ├── trades/              # /api/v1/{chain}/trades, /traders/:addr/trades
│       ├── migrations/          # /api/v1/{chain}/migrations
│       ├── activity/            # /api/v1/{chain}/activity — GET + SSE + WebSocket
│       ├── discover/            # /api/v1/{chain}/discover/*
│       ├── stats/               # /api/v1/{chain}/stats
│       ├── charts/              # /api/v1/{chain}/charts/* — TradingView UDF
│       ├── quotes/              # /api/v1/{chain}/tokens/:addr/quote/*
│       ├── price/               # /api/v1/{chain}/price/bnb
│       ├── leaderboard/         # /api/v1/{chain}/leaderboard/*
│       ├── vesting/             # /api/v1/{chain}/vesting/:token, /creators/:addr/vesting
│       ├── chat/                # /api/v1/{chain}/chat/:token/messages + WS (EIP-191 auth)
│       ├── upload/              # /api/v1/{chain}/metadata/upload
│       ├── points/              # /api/v1/{chain}/points/* (background poller + export)
│       ├── referrals/           # /api/v1/{chain}/referrals/*
│       ├── dex/                 # /api/v1/{chain}/dex/* — aggregator, quotes, swap, meta-tx
│       │   ├── dex.service.ts
│       │   ├── dex.controller.ts
│       │   ├── dex-subgraph.ts  # per-protocol subgraph clients
│       │   ├── dex-rpc.ts       # viem quoters, swap builders, relay execution
│       │   ├── metatx.service.ts
│       │   └── metatx.controller.ts
│       └── index/               # GET /api/v1/{chain} — route index
├── docker-compose.yml           # local Postgres for off-chain tables
├── Dockerfile
├── ecosystem.config.js
├── tsconfig.json
├── tsconfig.api.json
└── .env.example
```

---

## License

MIT — Copyright 2026 OneMEME Launchpad Contributors
