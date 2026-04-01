# OneMEME Launchpad Indexer

Blockchain indexer and REST API for the OneMEME Launchpad on BSC. Indexes all factory events in real time and exposes a typed HTTP API for the frontend.

---

## Stack

| Layer | Technology |
|---|---|
| Indexer | [Ponder](https://ponder.sh) v0.8.x |
| API | NestJS + Node.js |
| Database | PostgreSQL (Neon) |
| Chain | BSC Mainnet (chainId 56) |
| Contract | `LaunchpadFactory.sol` |

---

## Architecture

```
BSC RPC
  │
  ▼
Ponder Indexer  ──────────────────────►  PostgreSQL (Neon)
  (src/index.ts)                               │
  12 event handlers                            │
  token / trade / holder /                     ▼
  migration / vesting /             NestJS REST API (port 3001)
  token_snapshot tables               └─ /api/v1/<chain>/*
```

Both processes run in the same Docker container under PM2. The indexer writes to Postgres; the API reads from it via raw SQL.

---

## Events Indexed

| Event | Table Updated |
|---|---|
| `TokenCreated` | `token` (insert, including metaURI + metadata fields fetched via RPC + IPFS at index time) |
| `TokenBought` | `token` (buyCount, volumeBNB, raisedBNB), `trade` (insert), `token_snapshot` (upsert) |
| `TokenSold` | `token` (sellCount, volumeBNB, raisedBNB), `trade` (insert), `token_snapshot` (upsert) |
| `TokenMigrated` | `token` (migrated, pairAddress), `migration` (insert) |
| `Transfer` | `holder` (upsert balance, lastUpdatedBlock, lastUpdatedTimestamp) — skipped after migration |
| `VestingAdded` | `vesting` (insert), `token` (creatorTokens) |
| `Claimed` | `vesting` (claimed) |
| `VestingVoided` | `vesting` (voided, burned) |
| `TWAPUpdated` | logged only |
| `DefaultParamsUpdated` | logged only |
| `FeesWithdrawn` | logged only |
| `RouterUpdated` | logged only |

---

## Database Schema

### `token`

| Column | Type | Description |
|---|---|---|
| `id` | hex | Token contract address (PK) |
| `tokenType` | text | `"Standard"` \| `"Tax"` \| `"Reflection"` |
| `creator` | hex | Address that called `createToken` |
| `totalSupply` | bigint | Total supply at launch (wei) |
| `virtualBNB` | bigint | Base virtual BNB liquidity — constant set at creation (wei). Virtual liquidity at any point = `virtualBNB + raisedBNB` |
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
| `raisedBNB` | bigint | Current cumulative BNB raised on bonding curve (wei) |
| `migrationTarget` | bigint | BNB required to trigger migration (wei) |
| `creatorTokens` | bigint | Creator vesting allocation (wei, 5% of supply if enabled) |
| `metaUri` | text | Raw `metaURI` string from the token contract (nullable) |
| `name` | text | Token display name from metadata JSON (nullable) |
| `symbol` | text | Token symbol from metadata JSON (nullable) |
| `description` | text | Token description from metadata JSON (nullable) |
| `image` | text | IPFS CID of the token image (e.g. `QmXxx...` — resolve via your preferred gateway, nullable) |
| `website` | text | Token website URL (nullable) |
| `twitter` | text | Twitter / X link (nullable) |
| `telegram` | text | Telegram link (nullable) |

### `trade`

| Column | Type | Description |
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

| Column | Type | Description |
|---|---|---|
| `token` | hex | Token contract address |
| `address` | hex | Wallet address |
| `balance` | bigint | Current token balance (wei) |
| `lastUpdatedBlock` | bigint | Block number of the most recent Transfer that touched this row |
| `lastUpdatedTimestamp` | integer | Unix timestamp of the most recent Transfer that touched this row |

Composite PK: `(token, address)`. Rows with zero balance are retained. Only populated while the token is on the bonding curve — Transfer tracking stops after migration.

### `migration`

| Column | Type | Description |
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

| Column | Type | Description |
|---|---|---|
| `token` | hex | Token address |
| `beneficiary` | hex | Creator wallet (vesting recipient) |
| `amount` | bigint | Total tokens locked at start (wei) |
| `blockNumber` | bigint | Block number of the `VestingAdded` event |
| `start` | integer | Unix timestamp vesting began |
| `claimed` | bigint | Tokens claimed so far (wei) |
| `voided` | boolean | Whether schedule was voided early |
| `burned` | bigint | Tokens burned on void (wei) |

Composite PK: `(token, beneficiary)`.

### `token_snapshot`

One row per `(token, block)`. Written on every bonding-curve trade. Stores the AMM state at each block so historical price charts can be rendered accurately using the bonding-curve formula rather than raw per-trade price ratios.

| Column | Type | Description |
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

The API exposes `virtualLiquidityBNB` (= `virtualBNB + raisedBNB`) as a pre-computed field on every token and snapshot response.

---

## REST API

**Base URL:** `https://api.1coin.meme/api/v1/bsc`

The `bsc` segment is the chain slug, set via the `CHAIN_SLUG` environment variable (default: `bsc`). All routes are served under `/api/v1/<chain>/` — deploying a second chain means spinning up a new instance with a different `CHAIN_SLUG`.

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

Numeric fields stored as `bigint` or `numeric` in Postgres are returned as **strings** to preserve precision.

### Rate Limits

| Route pattern | Limit |
|---|---|
| `/api/v1/{chain}/tokens/*/quote/*` | 20 req / min (live RPC) |
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
| `virtualLiquidityBNB` | Current virtual liquidity = `virtualBNB + raisedBNB` (wei string). Represents the effective BNB depth of the bonding curve at this moment. |
| `priceBnb` | BNB per token. Bonding curve: `virtualLiquidity² / (virtualBNB × totalSupply)`. Migrated (list): migration-time liquidity ratio. Migrated (single token): live `getReserves()` from PancakeSwap. |
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

OHLCV price is computed from the bonding-curve AMM formula using `token_snapshot` data — not raw per-trade ratios. This gives accurate market price at each point in time.

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

Sources: Binance, OKX, Bybit, CoinGecko, MEXC, GateIO. Refreshed every 10 seconds. Returns trimmed average with per-source breakdown.

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

```jsonc
// Client → server
{ "type": "subscribe", "token": "0x..." }           // join token room
{ "type": "message", "sender": "0x...", "text": "…" } // send message (must subscribe first)

// Server → client
{ "type": "history", "messages": [...] }             // sent after subscribe
{ "type": "message", "id": "…", "token": "…", "sender": "…", "text": "…", "timestamp": 0 }
{ "type": "error", "message": "…" }
{ "type": "keepalive" }                              // every 15 s
```

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

The export endpoint requires the `X-Admin-Key: <ADMIN_SECRET>` header and returns every wallet's full breakdown for reward issuance. Disabled when `ADMIN_SECRET` is not set.

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
cp .env.example .env   # fill in required vars
docker compose up -d   # start local Postgres
npm run dev            # indexer
npm run api:dev        # API (separate terminal)
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
  -v ponder_cache:/app/.ponder \
  --env-file .env \
  onememe-launchpad
```

### Required env additions for production

```env
# Isolates Ponder's internal metadata so it doesn't conflict with other
# Ponder apps sharing the same Postgres schema (required on first run or
# if you see "Schema 'public' was previously used by a different Ponder app").
PONDER_SCHEMA=onememe

# Points export — set a strong random secret
ADMIN_SECRET=your-strong-random-secret
```

### TLS / SSL

TLS is terminated externally by Cloudflare. Do **not** set `SSL_CERT_PATH` or
`SSL_KEY_PATH` unless you are running without Cloudflare; setting them to a
path that doesn't exist will crash the API on startup.

### Updating on VPS

```bash
git pull
docker build -t onememe-launchpad .
docker stop onememe-launchpad && docker rm onememe-launchpad
docker run -d \
  --name onememe-launchpad \
  --restart unless-stopped \
  -p 3001:3001 \
  -v ponder_cache:/app/.ponder \
  --env-file .env \
  onememe-launchpad
docker logs -f onememe-launchpad
```

The named volume `ponder_cache` persists Ponder's checkpoint so the indexer
resumes from where it left off rather than re-syncing from the start block.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `BSC_RPC_URL` | Yes | BSC HTTP RPC endpoint |
| `BSC_WSS_URL` | No | BSC WebSocket RPC |
| `FACTORY_ADDRESS` | Yes | `LaunchpadFactory` contract address |
| `BONDING_CURVE_ADDRESS` | Yes | `BondingCurve` contract address (required for quotes) |
| `VESTING_WALLET_ADDRESS` | Yes | `VestingWallet` contract address |
| `START_BLOCK` | Yes | Block number to start indexing from |
| `CHAIN_ID` | No | EVM chain ID, defaults to `56` |
| `CHAIN_SLUG` | No | Chain name in API routes, defaults to `bsc` |
| `API_PORT` | No | REST API port, defaults to `3001` |
| `SSL_CERT_PATH` | No | TLS certificate path |
| `SSL_KEY_PATH` | No | TLS private key path |
| `PINATA_JWT` | No | Required for metadata upload |
| `IPFS_GATEWAY` | No | Custom IPFS gateway URL |
| `BETTERSTACK_TOKEN` | No | Better Stack log shipping token |
| `POINTS_START_BLOCK` | No | Only award points for events at/after this block; falls back to `START_BLOCK` |
| `ADMIN_SECRET` | No | Enables `GET /points/export` when set; pass as `X-Admin-Key` header |
| `PONDER_SCHEMA` | No | Postgres schema for Ponder's internal tables (recommended: `onememe`) |

---

## Project Structure

```
├── abis/LaunchpadFactory.json
├── src/
│   ├── index.ts                 # Ponder event handlers (12 events)
│   └── api/
│       ├── main.ts
│       ├── app.module.ts
│       ├── db.ts
│       ├── rpc.ts               # Viem client, bonding curve quotes, PancakeSwap price
│       ├── helpers.ts
│       ├── metadata.ts
│       └── modules/
│           ├── tokens/          # /api/v1/{chain}/tokens, /creators/:addr/tokens
│           ├── trades/          # /api/v1/{chain}/trades, /traders/:addr/trades
│           ├── migrations/      # /api/v1/{chain}/migrations
│           ├── activity/        # /api/v1/{chain}/activity — GET + SSE + WebSocket
│           ├── discover/        # /api/v1/{chain}/discover/*
│           ├── stats/           # /api/v1/{chain}/stats
│           ├── charts/          # /api/v1/{chain}/charts/* — TradingView UDF
│           ├── quotes/          # /api/v1/{chain}/tokens/:addr/quote/*
│           ├── price/           # /api/v1/{chain}/price/bnb
│           ├── leaderboard/     # /api/v1/{chain}/leaderboard/*
│           ├── vesting/         # /api/v1/{chain}/vesting/:token, /creators/:addr/vesting
│           ├── chat/            # /api/v1/{chain}/chat/:token/messages + WS
│           ├── upload/          # /api/v1/{chain}/metadata/upload
│           ├── points/          # /api/v1/{chain}/points/* (background poller + export)
│           ├── referrals/       # /api/v1/{chain}/referrals/*
│           └── index/           # GET /api/v1/{chain} — route index
├── ponder.config.ts
├── ponder.schema.ts
├── docker-compose.yml
├── Dockerfile
├── ecosystem.config.js
└── .env.example
```

---

## License

MIT — Copyright 2026 OneMEME Launchpad Contributors
