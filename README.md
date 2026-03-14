# OneMEME Launchpad Indexer

> Real-time on-chain indexer for the [OneMEME Launchpad](https://github.com/timedbase/OneMEMELaunchpad-Core) on Binance Smart Chain (BSC), built with [Ponder](https://ponder.sh).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Ponder](https://img.shields.io/badge/built%20with-Ponder-blueviolet)](https://ponder.sh)
[![NestJS](https://img.shields.io/badge/API-NestJS-red)](https://nestjs.com)
[![Chain: BSC](https://img.shields.io/badge/chain-BSC-F0B90B)](https://bscscan.com)

---

## Overview

The **OneMEME Launchpad Indexer** listens to all events emitted by the `LaunchpadFactory` contract and persists them to PostgreSQL. It exposes two APIs:

- **GraphQL API** (via Ponder) at `http://localhost:42069` — flexible querying with a built-in playground
- **REST API** (NestJS) at `https://localhost:3001/api/v1` — structured HTTPS endpoints with WebSocket (WSS) activity streaming

### Key Features

- **HTTPS + WSS** — set `SSL_KEY_PATH` and `SSL_CERT_PATH` to enable TLS automatically; no code changes required
- **Real-time activity stream** — SSE (`GET /activity/stream`) and WebSocket (`wss://.../activity/ws`) push every new create/buy/sell event
- **Live quote simulation** — calls `getAmountOut` / `getAmountOutSell` on the live contract, not from cached DB state
- **Discovery endpoints** — trending, new, bonding-curve, and migrated token feeds
- **Origin guard** — discovery, activity, and stats endpoints are restricted to configured launchpad UI domains
- **Per-IP rate limiting** — isolated fixed-window counters per route group; IP-keyed so rotating token addresses cannot bypass limits

### What Gets Indexed

| Event | Table | Description |
|---|---|---|
| `TokenCreated` | `token` | New meme token deployed (Standard / Tax / Reflection) |
| `TokenBought` | `trade` | Bonding-curve buy; includes antibot burn amount |
| `TokenSold` | `trade` | Bonding-curve sell |
| `TokenMigrated` | `migration` | Token graduates to PancakeSwap V2 |

### Database Schema

```
token      — one row per deployed meme token (+ running buy/sell stats)
trade      — one row per bonding-curve buy or sell transaction
migration  — one row per migrated token (PancakeSwap pair + liquidity)
```

---

## Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9 (or pnpm / yarn)
- **Docker + Docker Compose** (for the local PostgreSQL instance)
- A BSC JSON-RPC endpoint — both HTTP and WebSocket required

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

Edit `.env`:

| Variable | Required | Description |
|---|---|---|
| `BSC_WSS_URL` | **Yes** | BSC WebSocket endpoint (`wss://…`) — primary real-time streaming |
| `BSC_RPC_URL` | **Yes** | BSC HTTP endpoint — fallback transport + used by API for quotes |
| `FACTORY_ADDRESS` | **Yes** | Deployed `LaunchpadFactory` contract address |
| `START_BLOCK` | Recommended | Factory deployment block — skips unnecessary historical scan |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string |
| `API_PORT` | No | REST API port (default `3001`) |
| `ALLOWED_ORIGINS` | Recommended | Comma-separated UI origins for origin-restricted endpoints |
| `SSL_KEY_PATH` | No | Path to TLS private key — enables HTTPS + WSS when set with `SSL_CERT_PATH` |
| `SSL_CERT_PATH` | No | Path to TLS certificate — enables HTTPS + WSS when set with `SSL_KEY_PATH` |
| `IPFS_GATEWAY` | No | Custom IPFS gateway for token metadata resolution (default: `https://ipfs.io/ipfs/`) |

> Both `BSC_WSS_URL` and `BSC_RPC_URL` are required. The indexer throws at startup if either is missing.

### 3. Start PostgreSQL (local dev)

```bash
docker compose up -d
```

Starts PostgreSQL 16 on `localhost:5432` with credentials from `.env.example`.

### 4. Run the indexer

```bash
# Development mode — live reload on file changes
npm run dev

# Production mode
npm run start
```

Ponder will automatically run database migrations, begin syncing from `START_BLOCK`, and expose the **GraphQL playground** at [http://localhost:42069](http://localhost:42069).

### 5. Run the REST API

In a separate terminal (Ponder must be running and synced first):

```bash
# Development (ts-node, hot-reload)
npm run api:dev

# Production (compile first, then run)
npm run api:build
npm run api
```

API available at `https://localhost:3001/api/v1` (HTTP if TLS is not configured).
WebSocket stream at `wss://localhost:3001/api/v1/activity/ws`.

---

## HTTPS / WSS Setup

The API runs in plain HTTP/WS mode by default. To enable TLS:

```bash
# Generate a self-signed cert for local testing
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Set in .env
SSL_KEY_PATH=./key.pem
SSL_CERT_PATH=./cert.pem
```

In production, point these vars at your certificate files from Let's Encrypt or your TLS provider. Restart the API — no code changes needed. WebSocket connections automatically upgrade to WSS when TLS is active.

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

---

## REST API

Base URL: `https://localhost:3001/api/v1`

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

When exceeded the API returns `429 Too Many Requests` with a `Retry-After` header.

| Route group | Limit | Reason |
|---|---|---|
| `/tokens/*/quote/*` | **20 req/min** | Each request makes a live RPC call to BSC |
| `/stats` | **10 req/min** | Executes 6 parallel aggregation queries |
| All other endpoints | **60 req/min** | Paginated DB queries |

### Origin Restriction

The following endpoints are restricted to origins listed in `ALLOWED_ORIGINS`:

- `GET /api/v1/stats`
- `GET /api/v1/activity/*`
- `GET /api/v1/discover/*`

Requests from other origins receive `403 Forbidden`. In development (`NODE_ENV=development`) all `localhost` origins are automatically permitted.

### Endpoints

#### Info

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | public | Health check |
| `GET` | `/api/v1/stats` | UI only | Platform-wide aggregated statistics |

#### Tokens

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/tokens` | List all tokens (filterable, sortable) |
| `GET` | `/api/v1/tokens/:address` | Single token detail + off-chain metadata |
| `GET` | `/api/v1/tokens/:address/trades` | Bonding-curve trades for a token |
| `GET` | `/api/v1/tokens/:address/traders` | Top traders leaderboard for a token |
| `GET` | `/api/v1/tokens/:address/holders` | Estimated token holders (net trade positions) |
| `GET` | `/api/v1/tokens/:address/migration` | PancakeSwap migration record |
| `GET` | `/api/v1/creators/:address/tokens` | Tokens deployed by a creator |

#### Live Quote Simulation _(requires `BSC_RPC_URL`)_

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/tokens/:address/quote/price` | Live spot price from contract |
| `GET` | `/api/v1/tokens/:address/quote/buy` | Simulate BNB → tokens (price impact + slippage) |
| `GET` | `/api/v1/tokens/:address/quote/sell` | Simulate tokens → BNB (price impact + slippage) |

#### Trades & Migrations

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/trades` | All trades (filterable by token, trader, type) |
| `GET` | `/api/v1/traders/:address/trades` | All trades by a wallet |
| `GET` | `/api/v1/migrations` | All PancakeSwap migrations |

#### Activity Feed _(UI only)_

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/activity` | Paginated unified create/buy/sell event feed |
| `GET` | `/api/v1/activity/stream` | SSE real-time push (2 s poll, 15 s keepalive) |
| `WS`  | `/api/v1/activity/ws` | WebSocket (WSS) real-time push — same data as SSE |

#### Metadata Upload _(IPFS via Pinata)_

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/metadata/upload` | Upload image + metadata JSON to IPFS — returns `metaURI` for `setMetaURI()` |

Requires `PINATA_JWT` in `.env`. Accepts `multipart/form-data`. Fields: `image` (required, max 3 MB), `name` (required), `symbol`, `description`, `website`, `x`, `telegram`.

#### Leaderboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/leaderboard/traders` | Traders ranked by BNB volume — `?period=alltime\|1d\|7d\|30d` |

#### Discovery _(UI only)_

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/discover/trending` | Tokens most traded in the last 30 min |
| `GET` | `/api/v1/discover/new` | Freshly launched tokens |
| `GET` | `/api/v1/discover/bonding` | Bonding-curve tokens closest to migrating |
| `GET` | `/api/v1/discover/migrated` | Tokens graduated to PancakeSwap |

### Common query parameters

| Param | Type | Description |
|---|---|---|
| `page` | int | Page number (default `1`) |
| `limit` | int | Items per page (default `20`, max `100`) |
| `orderBy` | string | Column to sort by (endpoint-specific) |
| `orderDir` | `asc`\|`desc` | Sort direction (default `desc`) |
| `from` | int | Unix timestamp lower bound (trades / migrations) |
| `to` | int | Unix timestamp upper bound |

### WebSocket Activity Stream

```js
// Browser
const ws = new WebSocket("wss://api.onememe.io/api/v1/activity/ws?type=buy");
ws.onmessage = (e) => {
  const { event, data } = JSON.parse(e.data);
  if (event === "activity") console.log(data);
};

// Optional query params:
//   type   "create" | "buy" | "sell"
//   token  0x-address to filter by token
```

Each message:
```json
{ "event": "activity", "data": { "eventType": "buy", "token": "0x...", "actor": "0x...", "bnbAmount": "500000000000000000", "tokenAmount": "6172839000000000000000", "blockNumber": "42001234", "timestamp": 1741824012, "txHash": "0x..." } }
```

---

## Project Structure

```
OneMEMELaunchpad-Indexer/
├── abis/
│   ├── LaunchpadFactory.json        # Contract ABI (events + key view functions)
│   └── LaunchpadToken.json          # Token contract ABI (metaURI, name, symbol)
├── src/
│   ├── index.ts                     # Ponder event handlers (blockchain → DB)
│   └── api/
│       ├── main.ts                  # NestJS bootstrap (HTTPS + WS adapter)
│       ├── app.module.ts            # Root module + middleware registration
│       ├── health.controller.ts     # GET /health
│       ├── db.ts                    # postgres.js connection pool
│       ├── helpers.ts               # Pagination, validation (framework-agnostic)
│       ├── rpc.ts                   # viem client + quote helpers (live RPC)
│       ├── metadata.ts              # Token metadata fetcher (IPFS, TTL cache)
│       ├── common/
│       │   ├── origin.guard.ts      # CanActivate — origin allowlist guard
│       │   └── rate-limit.middleware.ts  # Fixed-window rate limiter (per IP)
│       └── modules/
│           ├── tokens/              # /tokens, /tokens/:addr/*, /creators/:addr/tokens
│           ├── trades/              # /trades, /traders/:addr/trades
│           ├── migrations/          # /migrations
│           ├── stats/               # /stats
│           ├── quotes/              # /tokens/:addr/quote/price|buy|sell (live RPC)
│           ├── activity/            # /activity, /activity/stream (SSE), /activity/ws (WSS)
│           ├── discover/            # /discover/trending|new|bonding|migrated
│           ├── leaderboard/         # /leaderboard/traders (alltime|1d|7d|30d)
│           └── upload/              # POST /metadata/upload — IPFS via Pinata
├── ponder.config.ts                 # Network, contract, and transport configuration
├── ponder.schema.ts                 # Database schema (onchainTable definitions)
├── docker-compose.yml               # Local PostgreSQL for development
├── package.json
├── tsconfig.json                    # Ponder / indexer TypeScript config
├── tsconfig.api.json                # NestJS API TypeScript config (CommonJS, decorators)
├── .env.example                     # Environment variable template
├── .gitignore
├── EXAMPLES.md                      # Full API reference with curl examples
├── LICENSE                          # MIT
└── README.md
```

---

## Token Types

| Value | Name | Description |
|---|---|---|
| `"Standard"` | StandardToken | Plain ERC-20, no taxes or reflection |
| `"Tax"` | TaxToken | Configurable buy/sell tax (max 10% each side), up to 5 recipients |
| `"Reflection"` | ReflectionToken | RFI-style passive distribution to all holders |

---

## Bonding Curve Mechanics

During the pre-migration phase every token is traded through a constant-product bonding curve maintained by the factory:

- **Buy** → user sends BNB, receives tokens. During the *antibot window* (first N blocks after `tradingBlock`) a percentage of tokens is burned to the dead address (`tokensToDead`).
- **Sell** → user sends tokens back, receives BNB.
- **Migration** → once `raisedBNB` reaches the migration target, any caller can trigger `migrate()`. The factory deposits all raised BNB + 38% of token supply into a new PancakeSwap V2 pair as permanent liquidity.

---

## Deployment

For production you will need:

1. A **managed PostgreSQL** instance (Supabase, Railway, Neon, AWS RDS, etc.)
2. A **dedicated BSC RPC** with archive access (QuickNode, Ankr, NodeReal, etc.)
3. **TLS certificates** (Let's Encrypt recommended) — set `SSL_KEY_PATH` + `SSL_CERT_PATH`
4. A process manager (PM2, Docker, Railway, Render, etc.)

```bash
# Build the API
npm run api:build

# Start the indexer and API (separate processes)
npm run start       # Ponder indexer
npm run api         # NestJS REST API
```

---

## Contributing

Pull requests are welcome. For major changes please open an issue first to discuss what you would like to change.

---

## Related

- [OneMEMELaunchpad-Core](https://github.com/timedbase/OneMEMELaunchpad-Core) — Smart contracts (BSC)
- [Ponder Documentation](https://ponder.sh/docs) — Indexer framework
- [NestJS Documentation](https://docs.nestjs.com) — API framework
- [PancakeSwap V2](https://docs.pancakeswap.finance/) — DEX used for migration

---

## License

[MIT](LICENSE) © 2026 OneMEME Launchpad Contributors
