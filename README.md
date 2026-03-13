# OneMEME Launchpad Indexer

> Real-time on-chain indexer for the [OneMEME Launchpad](https://github.com/timedbase/OneMEMELaunchpad-Core) on Binance Smart Chain (BSC), built with [Ponder](https://ponder.sh).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Ponder](https://img.shields.io/badge/built%20with-Ponder-blueviolet)](https://ponder.sh)
[![Chain: BSC](https://img.shields.io/badge/chain-BSC-F0B90B)](https://bscscan.com)

---

## Overview

The **OneMEME Launchpad Indexer** listens to all events emitted by the `LaunchpadFactory` contract and persists them to PostgreSQL. It exposes two APIs:

- **GraphQL API** (via Ponder) at `http://localhost:42069` — flexible querying with a built-in playground
- **REST API** (Hono) at `http://localhost:3001/api/v1` — structured endpoints for tokens, trades, migrations, TWAP history, factory events, and platform stats

### What Gets Indexed

| Event | Table | Description |
|---|---|---|
| `TokenCreated` | `token` | New meme token deployed (Standard / Tax / Reflection) |
| `TokenBought` | `trade` | Bonding-curve buy; includes antibot burn amount |
| `TokenSold` | `trade` | Bonding-curve sell |
| `TokenMigrated` | `migration` | Token graduates to PancakeSwap V2 |
| `TWAPUpdated` | `twap_update` | Factory TWAP oracle refresh |
| `DefaultParamsUpdated` | `factory_event` | Factory default virtual-BNB / migration-target changed |
| `FeesWithdrawn` | `factory_event` | Platform fees collected by the owner |
| `RouterUpdated` | `factory_event` | PancakeSwap router address changed |
| `FeeRecipientUpdated` | `factory_event` | Fee recipient address changed |
| `TradeFeeUpdated` | `factory_event` | Bonding-curve trade fee (bps) changed |
| `UsdcPairUpdated` | `factory_event` | TWAP oracle USDC/WBNB pair reconfigured |
| `TwapMaxAgeBlocksUpdated` | `factory_event` | TWAP staleness threshold changed |

### Database Schema (tables)

```
token           — one row per deployed meme token (+ running buy/sell stats)
trade           — one row per bonding-curve buy or sell transaction
migration       — one row per migrated token (PancakeSwap pair + liquidity)
twap_update     — one row per TWAP oracle refresh
factory_event   — one row per admin / config-change event
```

---

## Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9 (or pnpm / yarn)
- **Docker + Docker Compose** (for the local PostgreSQL instance)
- A BSC JSON-RPC endpoint (archive node recommended for historical sync)

---

## Quick Start

### 1. Clone and install dependencies

```bash
git clone https://github.com/timedbase/OneMEMELaunchpad-Indexer.git
cd OneMEMELaunchpad-Indexer
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `BSC_WSS_URL` | **Yes** | BSC WebSocket endpoint (`wss://…`) — primary real-time streaming transport |
| `BSC_RPC_URL` | **Yes** | BSC HTTP endpoint — automatic fallback for the indexer; used by REST API for quotes |
| `FACTORY_ADDRESS` | **Yes** | Deployed `LaunchpadFactory` contract address on BSC |
| `START_BLOCK` | Recommended | Factory deployment block — skips unnecessary historical scan |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string |
| `API_PORT` | No | REST API port (default `3001`) |

> Both `BSC_WSS_URL` and `BSC_RPC_URL` are required — the indexer throws at startup if either is missing. Ponder streams events over WebSocket and automatically switches to HTTP polling if the WSS connection drops, then resumes over WSS once it recovers.

### 3. Start PostgreSQL (local dev)

```bash
docker compose up -d
```

This starts a PostgreSQL 16 instance on `localhost:5432` with the credentials from `.env.example`.

### 4. Run the indexer

```bash
# Development mode — live reload on file changes
npm run dev

# Production mode
npm run start
```

Ponder will:
1. Run database migrations automatically.
2. Begin syncing events from `START_BLOCK` to the chain tip.
3. Expose the **GraphQL playground** at [http://localhost:42069](http://localhost:42069).

### 5. Run the REST API

In a separate terminal (Ponder must be running and synced first):

```bash
# Development mode — auto-restarts on file changes
npm run api:dev

# Production mode
npm run api
```

The REST API is available at [http://localhost:3001/api/v1](http://localhost:3001/api/v1).

---

## GraphQL API

Once the indexer is running, the built-in GraphQL API is available at:

```
http://localhost:42069/graphql
```

### Example queries

**All tokens, most-recently created first:**

```graphql
{
  tokens(orderBy: "createdAtBlock", orderDirection: "desc", limit: 20) {
    items {
      id
      tokenType
      creator
      totalSupply
      migrated
      buyCount
      sellCount
      volumeBNB
      raisedBNB
    }
  }
}
```

**Recent bonding-curve trades for a specific token:**

```graphql
{
  trades(
    where: { token: "0xYourTokenAddress" }
    orderBy: "timestamp"
    orderDirection: "desc"
    limit: 50
  ) {
    items {
      tradeType
      trader
      bnbAmount
      tokenAmount
      tokensToDead
      raisedBNB
      txHash
      timestamp
    }
  }
}
```

**Migrated tokens with their PancakeSwap pair info:**

```graphql
{
  migrations(orderBy: "timestamp", orderDirection: "desc") {
    items {
      token
      pair
      liquidityBNB
      liquidityTokens
      txHash
      timestamp
    }
  }
}
```

**TWAP price history (most recent 10):**

```graphql
{
  twapUpdates(orderBy: "blockNumber", orderDirection: "desc", limit: 10) {
    items {
      priceAvg
      priceBlockNumber
      blockNumber
      timestamp
    }
  }
}
```

---

## REST API

Base URL: `http://localhost:3001/api/v1`

All list endpoints return a consistent paginated envelope:

```json
{
  "data": [ ... ],
  "pagination": { "page": 1, "limit": 20, "total": 342, "pages": 18, "hasMore": true }
}
```

All `uint256` / BNB amounts are returned as **strings** to preserve full precision.

### Rate Limits

Every response includes standard rate-limit headers:

```
X-RateLimit-Limit:      60
X-RateLimit-Remaining:  59
X-RateLimit-Reset:      1741824060
```

When exceeded, the API returns `429 Too Many Requests` with a `Retry-After` header.

| Route group | Limit | Reason |
|---|---|---|
| `/tokens/*/quote/*` | **20 req/min** | Each request makes a live RPC call to BSC |
| `/stats` | **10 req/min** | Executes 6 parallel aggregation queries |
| Single-item detail | **120 req/min** | Fast primary-key DB lookup |
| All other list endpoints | **60 req/min** | Paginated DB queries |

---

### Endpoints

#### Info

| Method | Path | Limit | Description |
|---|---|---|---|
| `GET` | `/health` | none | Health check |
| `GET` | `/api/v1` | none | Route index |
| `GET` | `/api/v1/stats` | 10/min | Platform-wide aggregated statistics |

#### Tokens

| Method | Path | Limit | Description |
|---|---|---|---|
| `GET` | `/api/v1/tokens` | 60/min | List all tokens (filterable, sortable) |
| `GET` | `/api/v1/tokens/:address` | 120/min | Single token detail |
| `GET` | `/api/v1/tokens/:address/trades` | 60/min | Bonding-curve trades for a token |
| `GET` | `/api/v1/tokens/:address/traders` | 60/min | Top traders leaderboard for a token |
| `GET` | `/api/v1/tokens/:address/migration` | 120/min | PancakeSwap migration record |
| `GET` | `/api/v1/creators/:address/tokens` | 60/min | Tokens deployed by a creator |

#### Live Quote Simulation _(requires BSC RPC)_

| Method | Path | Limit | Description |
|---|---|---|---|
| `GET` | `/api/v1/tokens/:address/quote/price` | **20/min** | Live spot price from contract |
| `GET` | `/api/v1/tokens/:address/quote/buy` | **20/min** | Simulate BNB → tokens (with price impact + slippage) |
| `GET` | `/api/v1/tokens/:address/quote/sell` | **20/min** | Simulate tokens → BNB (with price impact + slippage) |

#### Trades / Migrations / TWAP / Factory

| Method | Path | Limit | Description |
|---|---|---|---|
| `GET` | `/api/v1/trades` | 60/min | All trades (filterable by token, trader, type) |
| `GET` | `/api/v1/traders/:address/trades` | 60/min | All trades by a wallet |
| `GET` | `/api/v1/migrations` | 60/min | All PancakeSwap migrations |
| `GET` | `/api/v1/twap` | 60/min | TWAP oracle history |
| `GET` | `/api/v1/twap/latest` | 120/min | Most recent TWAP reading |
| `GET` | `/api/v1/factory/events` | 60/min | Factory admin / config-change events |

### Common query parameters

| Param | Type | Description |
|---|---|---|
| `page` | int | Page number (default `1`) |
| `limit` | int | Items per page (default `20`, max `100`) |
| `orderBy` | string | Column to sort by (endpoint-specific) |
| `orderDir` | `asc`\|`desc` | Sort direction (default `desc`) |
| `from` | int | Unix timestamp lower bound (trades/twap/factory) |
| `to` | int | Unix timestamp upper bound |

### Examples

**Simulate a buy — 1 BNB in, with 1% slippage tolerance:**

```bash
# bnbIn is in wei (1 BNB = 1e18 wei), slippage in basis points (100 = 1%)
curl "http://localhost:3001/api/v1/tokens/0xabc...1111/quote/buy?bnbIn=1000000000000000000&slippage=100"
```

```json
{
  "data": {
    "token":               "0xabc...1111",
    "type":                "buy",
    "migrated":            false,
    "bnbIn":               "1000000000000000000",
    "bnbInFormatted":      "1.0",
    "tokensOut":           "12345678000000000000000",
    "tokensOutFormatted":  "12345.678",
    "spotPriceWei":        "81000000000000",
    "spotPriceBNB":        "0.000081",
    "effectivePriceWei":   "81040000000000",
    "effectivePriceBNB":   "0.00008104",
    "priceImpactBps":      "49",
    "priceImpactPct":      "0.49%",
    "slippageBps":         "100",
    "minimumOutput":       "12222221220000000000000",
    "minimumOutputFormatted": "12222.22122",
    "antibotEnabled":      true,
    "tradingBlock":        "42000100"
  }
}
```

**Simulate a sell — 10 000 tokens back to BNB:**

```bash
curl "http://localhost:3001/api/v1/tokens/0xabc...1111/quote/sell?tokensIn=10000000000000000000000&slippage=200"
```

**Live spot price:**

```bash
curl "http://localhost:3001/api/v1/tokens/0xabc...1111/quote/price"
```

**Top traders leaderboard for a token:**

```bash
curl "http://localhost:3001/api/v1/tokens/0xabc...1111/traders?limit=10&orderBy=totalVolumeBNB"
```

```json
{
  "data": [
    {
      "trader":         "0xdeadbeef...",
      "buyCount":       14,
      "sellCount":      3,
      "totalTrades":    17,
      "totalBNBIn":     "5200000000000000000",
      "totalBNBOut":    "1800000000000000000",
      "totalVolumeBNB": "7000000000000000000",
      "netBNB":         "-3400000000000000000"
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 204, "pages": 21, "hasMore": true }
}
```

**Platform stats:**

```bash
curl http://localhost:3001/api/v1/stats
```

**Tokens — Tax type, not yet migrated, sorted by volume:**

```bash
curl "http://localhost:3001/api/v1/tokens?type=Tax&migrated=false&orderBy=volumeBNB&limit=10"
```

**Factory events — fee withdrawals only:**

```bash
curl "http://localhost:3001/api/v1/factory/events?type=FeesWithdrawn"
```

---

## Project Structure

```
OneMEMELaunchpad-Indexer/
├── abis/
│   └── LaunchpadFactory.json        # Contract ABI (events + key view functions)
├── src/
│   ├── index.ts                     # Ponder event handlers (blockchain → DB)
│   └── api/
│       ├── server.ts                # Hono app: middleware, rate limits, route mounting
│       ├── db.ts                    # postgres.js connection pool
│       ├── helpers.ts               # Pagination, validation, error utilities
│       ├── ratelimit.ts             # Fixed-window rate limiter (per IP + path)
│       ├── rpc.ts                   # viem client + contract read helpers (quotes)
│       └── routes/
│           ├── tokens.ts            # /tokens, /tokens/:addr/traders, /creators/:addr/tokens
│           ├── trades.ts            # /trades, /traders/:addr/trades
│           ├── migrations.ts        # /migrations
│           ├── twap.ts              # /twap, /twap/latest
│           ├── factory.ts           # /factory/events
│           ├── stats.ts             # /stats
│           └── quotes.ts            # /tokens/:addr/quote/price|buy|sell (live RPC)
├── ponder.config.ts                 # Network, contract, and DB configuration
├── ponder.schema.ts                 # Database schema (onchainTable definitions)
├── docker-compose.yml               # Local PostgreSQL for development
├── package.json
├── tsconfig.json
├── .env.example                     # Environment variable template
├── .gitignore
├── LICENSE                          # MIT
└── README.md
```

---

## Token Types

The factory deploys three token implementations (indexed as `tokenType`):

| Value | Name | Description |
|---|---|---|
| `"Standard"` | StandardToken | Plain ERC-20, no taxes or reflection |
| `"Tax"` | TaxToken | Configurable buy/sell tax (max 10% each side), up to 5 recipients |
| `"Reflection"` | ReflectionToken | RFI-style passive distribution to all holders |

---

## Bonding Curve Mechanics

During the pre-migration phase every token is traded through a **constant-product bonding curve** maintained by the factory:

- **Buy** → user sends BNB, receives tokens. During the *antibot window* (first N blocks after `tradingBlock`) a percentage of tokens is burned to the dead address (`tokensToDead`).
- **Sell** → user sends tokens back, receives BNB.
- **Migration** → once `raisedBNB` reaches the migration target, any caller can trigger `migrate()`. The factory deposits all raised BNB + 38% of token supply into a new PancakeSwap V2 pair as permanent liquidity.

---

## Configuration Reference

### `ponder.config.ts`

| Key | Description |
|---|---|
| `networks.bsc.chainId` | `56` (BSC mainnet) |
| `contracts.LaunchpadFactory.startBlock` | Controlled via `START_BLOCK` env var |

### `ponder.schema.ts`

All tables use Ponder's `onchainTable` builder with Drizzle-compatible column types. Indexes are created on the most commonly queried columns.

---

## Deployment

For a production deployment you will need:

1. A **managed PostgreSQL** instance (e.g. Supabase, Railway, Neon, AWS RDS).
2. A **dedicated BSC RPC** with archive access (e.g. QuickNode, Ankr, NodeReal).
3. A process manager (e.g. PM2, Docker, Railway, Render).

```bash
# Set production env vars, then:
npm run start
```

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

---

## Related

- [OneMEMELaunchpad-Core](https://github.com/timedbase/OneMEMELaunchpad-Core) — Smart contracts (BSC)
- [Ponder Documentation](https://ponder.sh/docs) — Indexer framework
- [PancakeSwap V2](https://docs.pancakeswap.finance/) — DEX used for migration

---

## License

[MIT](LICENSE) © 2026 OneMEME Launchpad Contributors
