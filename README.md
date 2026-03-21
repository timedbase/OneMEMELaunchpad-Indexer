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
  migration / vesting tables         NestJS REST API (port 3001)
                                       └─ /api/v1/*
```

Both processes run in the same Docker container under PM2. The indexer writes to Postgres; the API reads from it via raw SQL.

---

## Events Indexed

| Event | Table Updated |
|---|---|
| `TokenCreated` | `token` (insert) |
| `TokenBought` | `token` (buyCount, volumeBNB, raisedBNB), `trade` (insert) |
| `TokenSold` | `token` (sellCount, volumeBNB, raisedBNB), `trade` (insert) |
| `TokenMigrated` | `token` (migrated, pairAddress), `migration` (insert) |
| `Transfer` | `holder` (upsert balance) |
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
| `virtualBNB` | bigint | Initial virtual BNB reserve for AMM pricing (wei) |
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

Composite PK: `(token, address)`. Rows with zero balance are retained.

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
| `start` | integer | Unix timestamp vesting began |
| `claimed` | bigint | Tokens claimed so far (wei) |
| `voided` | boolean | Whether schedule was voided early |
| `burned` | bigint | Tokens burned on void (wei) |

Composite PK: `(token, beneficiary)`.

---

## REST API

**Base URL:** `https://api.1coin.meme/api/v1`

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

| Route | Limit |
|---|---|
| `/tokens/*/quote/*` | 20 req / min (live RPC) |
| `/stats` | 10 req / min (heavy aggregation) |
| Everything else | 60 req / min |

---

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |

---

### Tokens

| Method | Path | Description |
|---|---|---|
| `GET` | `/tokens` | Paginated token list with pricing |
| `GET` | `/tokens/:address` | Single token — live PancakeSwap price if migrated |
| `GET` | `/tokens/:address/trades` | Trades for a token |
| `GET` | `/tokens/:address/traders` | Per-trader stats for a token |
| `GET` | `/tokens/:address/holders` | Token holder balances |
| `GET` | `/tokens/:address/migration` | Migration details (404 if not migrated) |
| `GET` | `/tokens/:address/quote/price` | Live bonding-curve spot price (RPC) |
| `GET` | `/tokens/:address/quote/buy` | Buy quote with price impact (RPC) |
| `GET` | `/tokens/:address/quote/sell` | Sell quote with price impact (RPC) |

**`GET /tokens` query params:**

| Param | Default | Description |
|---|---|---|
| `page` | `1` | Page number |
| `limit` | `20` | Results per page (max 100) |
| `type` | — | `Standard` \| `Tax` \| `Reflection` |
| `migrated` | — | `true` \| `false` |
| `orderBy` | `created_at_block` | `created_at_block` \| `volume_bnb` \| `buy_count` \| `sell_count` \| `raised_bnb` \| `total_supply` |
| `orderDir` | `desc` | `asc` \| `desc` |

**Computed pricing fields on every token object:**

| Field | Description |
|---|---|
| `priceBnb` | BNB per token. Bonding curve: AMM formula `(virtualBNB + raisedBNB)² / (virtualBNB × totalSupply)`. Migrated (list): migration-time liquidity ratio. Migrated (single token): live `getReserves()` from PancakeSwap. |
| `marketCapBnb` | `priceBnb × totalSupply` in BNB |
| `marketCapUsd` | `marketCapBnb × bnbSpotPrice` (2 decimal string) |

**`GET /tokens/:address/trades` query params:**

| Param | Default | Description |
|---|---|---|
| `page` / `limit` | 1 / 20 | Pagination |
| `type` | — | `buy` \| `sell` |
| `from` / `to` | — | Unix timestamp range |
| `orderBy` | `timestamp` | `timestamp` \| `bnb_amount` \| `token_amount` \| `block_number` |
| `orderDir` | `desc` | `asc` \| `desc` |

**`GET /tokens/:address/traders` query params:**

| Param | Default | Description |
|---|---|---|
| `page` / `limit` | 1 / 20 | Pagination |
| `orderBy` | `totalVolumeBNB` | `totalVolumeBNB` \| `totalTrades` \| `buyCount` \| `sellCount` \| `netBNB` |
| `orderDir` | `desc` | `asc` \| `desc` |

**`GET /tokens/:address/quote/buy` query params:**

| Param | Required | Description |
|---|---|---|
| `bnbIn` | Yes | BNB input in wei |
| `slippage` | No | Basis points (default `100` = 1%) |

**`GET /tokens/:address/quote/sell` query params:**

| Param | Required | Description |
|---|---|---|
| `tokensIn` | Yes | Token input in wei |
| `slippage` | No | Basis points (default `100` = 1%) |

---

### Creators

| Method | Path | Description |
|---|---|---|
| `GET` | `/creators/:address/tokens` | Tokens launched by this address (includes pricing) |
| `GET` | `/creators/:address/vesting` | Vesting schedules for this creator |

---

### Trades

| Method | Path | Description |
|---|---|---|
| `GET` | `/trades` | All trades, paginated |
| `GET` | `/traders/:address/trades` | All trades by a specific wallet |

---

### Migrations

| Method | Path | Description |
|---|---|---|
| `GET` | `/migrations` | All migration events, paginated |

---

### Activity Feed

| Method | Path | Description |
|---|---|---|
| `GET` | `/activity` | Last 15 create/buy/sell events — flat array for header marquee |
| `GET` | `/activity/stream` | SSE — pushes new events as they are indexed |
| `WS` | `/activity/ws` | WebSocket — same real-time feed |

**`GET /activity/stream` / WS query params:**

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
| `GET` | `/discover/trending` | Tokens with the most trades in a recent window |
| `GET` | `/discover/new` | Newest non-migrated tokens |
| `GET` | `/discover/bonding` | Active bonding-curve tokens sorted by `raisedBNB` |
| `GET` | `/discover/migrated` | Migrated tokens with liquidity details |

**`GET /discover/trending` query params:**

| Param | Default | Description |
|---|---|---|
| `window` | `1800` | Lookback window in seconds (60–86400) |
| `page` / `limit` | 1 / 20 | Pagination |

Trending objects include: `recentTrades`, `recentBuys`, `recentSells`, `recentVolumeBNB`.

**`GET /discover/new` / `/discover/bonding` query params:**

| Param | Description |
|---|---|
| `type` | `Standard` \| `Tax` \| `Reflection` |
| `page` / `limit` | Pagination |

**`GET /discover/migrated` query params:**

| Param | Default | Description |
|---|---|---|
| `orderBy` | `migratedAt` | `migratedAt` \| `liquidityBNB` \| `volumeBNB` |
| `orderDir` | `desc` | `asc` \| `desc` |
| `type` | — | Token type filter |

---

### Stats

| Method | Path | Description |
|---|---|---|
| `GET` | `/stats` | Platform-wide aggregated statistics |

Returns: `totalTokens`, `migratedTokens`, `activeTokens`, `tokensByType`, `totalTrades`, `totalBuys`, `totalSells`, `uniqueTraders`, `totalVolumeBNB`, `totalLiquidityBNB`, `topTokenByVolume`.

---

### Leaderboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/leaderboard/tokens` | Tokens ranked by trading activity |
| `GET` | `/leaderboard/creators` | Creators ranked by tokens launched and BNB raised |
| `GET` | `/leaderboard/traders` | Traders ranked by BNB volume |
| `GET` | `/leaderboard/users` | Combined traders + creators |

**Common query params:**

| Param | Default | Description |
|---|---|---|
| `period` | `alltime` | `1d` \| `7d` \| `30d` \| `alltime` |
| `page` / `limit` | 1 / 20 | Pagination |

**`GET /leaderboard/tokens` additional param:**

| Param | Default | Description |
|---|---|---|
| `orderBy` | `volumeBNB` | `volumeBNB` \| `tradeCount` \| `buyCount` \| `sellCount` \| `raisedBNB` |

---

### Charts (TradingView UDF)

| Method | Path | Description |
|---|---|---|
| `GET` | `/charts/config` | UDF configuration |
| `GET` | `/charts/time` | Server unix timestamp |
| `GET` | `/charts/symbols?symbol=:address` | Symbol metadata |
| `GET` | `/charts/history` | OHLCV bars |
| `GET` | `/charts/search?query=:addr` | Symbol search |

**`GET /charts/history` query params:**

| Param | Required | Description |
|---|---|---|
| `symbol` | Yes | Token address |
| `resolution` | Yes | `1` \| `5` \| `15` \| `30` \| `60` \| `240` \| `D` |
| `from` | No | Start unix timestamp |
| `to` | No | End unix timestamp (default: now) |
| `countback` | No | Number of bars |

---

### BNB Price

| Method | Path | Description |
|---|---|---|
| `GET` | `/price/bnb` | BNB/USDT aggregated from 6 exchanges |

Sources: Binance, OKX, Bybit, CoinGecko, MEXC, GateIO. Refreshed every 10 seconds. Returns trimmed average with per-source breakdown.

---

### Salt Mining

| Method | Path | Description |
|---|---|---|
| `GET` | `/salt/:address` | Current session result — 404 if no session started |
| `GET` | `/salt/:address/stream` | SSE — starts a fresh mine on every connect |

Each SSE connection clears any previous session and spawns 3 worker threads in parallel (Standard, Tax, Reflection). Each mines a `bytes32` userSalt until `CREATE2(factory, keccak256(creator, salt), initCodeHash)` produces an address ending in `0x1111`. Workers are killed on disconnect.

**SSE events:**
```
data: {"type":"progress","tokenType":"Standard","attempts":50000}
data: {"type":"found","tokenType":"Tax","attempts":43210,"salt":"0xabcdef...","predictedAddress":"0x7B2E...1111"}
```

**GET result:**
```json
{
  "address":    "0xWallet...",
  "standard":   { "salt": "0x...", "predictedAddress": "0x...1111", "attempts": 71024 },
  "tax":        { "salt": "0x...", "predictedAddress": "0x...1111", "attempts": 43210 },
  "reflection": { "salt": "0x...", "predictedAddress": "0x...1111", "attempts": 88901 }
}
```

---

### Vesting

| Method | Path | Description |
|---|---|---|
| `GET` | `/vesting/:token` | Vesting schedule for a specific token |
| `GET` | `/creators/:address/vesting` | All vesting schedules for a creator |

---

### Chat

| Method | Path | Description |
|---|---|---|
| `GET` | `/chat/:token/messages` | Last 50 messages for a token (oldest-first) |

---

### Metadata Upload

| Method | Path | Description |
|---|---|---|
| `POST` | `/metadata/upload` | Pin token metadata and image to IPFS via Pinata |

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

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `BSC_RPC_URL` | Yes | BSC HTTP RPC endpoint |
| `BSC_WSS_URL` | No | BSC WebSocket RPC |
| `FACTORY_ADDRESS` | Yes | `LaunchpadFactory` contract address |
| `BONDING_CURVE_ADDRESS` | Yes | `BondingCurve` contract address (required for quotes) |
| `START_BLOCK` | Yes | Block number to start indexing from |
| `CHAIN_ID` | No | Defaults to `56` |
| `API_PORT` | No | Defaults to `3001` |
| `SSL_CERT_PATH` | No | TLS certificate path |
| `SSL_KEY_PATH` | No | TLS private key path |
| `PINATA_JWT` | No | Required for metadata upload |
| `PINATA_GATEWAY` | No | Custom Pinata IPFS gateway |

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
│           ├── tokens/          # /tokens, /creators/:addr/tokens
│           ├── trades/          # /trades, /traders/:addr/trades
│           ├── migrations/      # /migrations
│           ├── activity/        # GET + SSE + WebSocket gateway
│           ├── discover/        # trending / new / bonding / migrated
│           ├── stats/           # /stats
│           ├── charts/          # TradingView UDF
│           ├── quotes/          # /tokens/:addr/quote/*
│           ├── price/           # /price/bnb
│           ├── leaderboard/     # /leaderboard/*
│           ├── salt/            # CREATE2 vanity address mining
│           ├── vesting/         # /vesting, /creators/:addr/vesting
│           ├── chat/            # /chat/:token/messages
│           ├── upload/          # /metadata/upload
│           └── index/           # GET /api/v1 route index
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
