# OneMEME Launchpad Indexer

> Real-time on-chain indexer for the [OneMEME Launchpad](https://github.com/timedbase/OneMEMELaunchpad-Core) on Binance Smart Chain (BSC), built with [Ponder](https://ponder.sh).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Ponder](https://img.shields.io/badge/built%20with-Ponder-blueviolet)](https://ponder.sh)
[![NestJS](https://img.shields.io/badge/API-NestJS-red)](https://nestjs.com)
[![Chain: BSC](https://img.shields.io/badge/chain-BSC-F0B90B)](https://bscscan.com)

---

## Overview

The **OneMEME Launchpad Indexer** listens to events emitted by the `LaunchpadFactory` and `BondingCurve` contracts and persists them to PostgreSQL. It exposes two APIs:

- **GraphQL API** (via Ponder) at `http://localhost:42069` — flexible querying with a built-in playground
- **REST API** (NestJS) at `https://api.1coin.meme/api/v1` — structured HTTPS endpoints with WebSocket (WSS) activity streaming

### Key Features

- **HTTPS + WSS** — handled by Cloudflare in front of the server; see [CLOUDFLARE.md](CLOUDFLARE.md)
- **Real-time activity stream** — SSE (`GET /activity/stream`) and WebSocket (`wss://.../activity/ws`) push every new create/buy/sell event
- **Live quote simulation** — calls `getAmountOut` / `getAmountOutSell` on the live contract, not from cached DB state
- **Discovery endpoints** — trending, new, bonding-curve, and migrated token feeds
- **Origin guard** — discovery, activity, and stats endpoints are restricted to configured launchpad UI domains
- **Per-IP rate limiting** — isolated fixed-window counters per route group; IP-keyed so rotating token addresses cannot bypass limits

### What Gets Indexed

| Event | Contract | Table | Description |
|---|---|---|---|
| `TokenCreated` | `LaunchpadFactory` | `token` | New meme token deployed |
| `TokenBought` | `BondingCurve` | `trade` | Bonding-curve buy; includes antibot burn amount |
| `TokenSold` | `BondingCurve` | `trade` | Bonding-curve sell |
| `TokenMigrated` | `BondingCurve` | `migration` | Token graduates to PancakeSwap V2 |
| `Transfer` | `MemeToken` (ERC-20) | `holder` | Every token transfer — maintains exact onchain balances |
| `VestingAdded` | `VestingWallet` | `vesting` | Creator allocation locked (5% of supply, 365-day linear) |
| `Claimed` | `VestingWallet` | `vesting` | Creator claims unlocked tokens |
| `VestingVoided` | `VestingWallet` | `vesting` | Schedule voided; unvested remainder burned to dead address |

### Database Schema

```
token      — one row per deployed meme token (tokenType, virtualBNB, migrationTarget, creatorTokens, buyCount, sellCount, volumeBNB, raisedBNB)
trade      — one row per bonding-curve buy or sell transaction
migration  — one row per migrated token (PancakeSwap pair + liquidity)
holder     — current onchain balance per (token, wallet) — updated from ERC-20 Transfer events
vesting    — creator vesting schedule per token (amount, claimed, voided, burned — 365-day linear, no cliff)
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
| `BSC_RPC_URL` | **Yes** | BSC HTTP endpoint — fallback transport + used by API for live quotes |
| `CHAIN_ID` | **Yes** | EVM chain ID (`56` = BSC mainnet, `97` = BSC testnet) |
| `FACTORY_ADDRESS` | **Yes** | Deployed `LaunchpadFactory` contract address |
| `BONDING_CURVE_ADDRESS` | **Yes** | Deployed `BondingCurve` contract address |
| `VESTING_WALLET_ADDRESS` | **Yes** | Deployed `VestingWallet` contract address |
| `START_BLOCK` | Recommended | Factory deployment block — skips unnecessary historical scan |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string |
| `API_PORT` | No | REST API port (default `3001`) |
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

API available at `https://api.1coin.meme/api/v1`. TLS is handled by Cloudflare — see [CLOUDFLARE.md](CLOUDFLARE.md).

---

## GraphQL API

Once the indexer is running, the built-in GraphQL API is available at:

```
http://localhost:42069/graphql
```

> **Note:** Port `42069` is Ponder's internally fixed port — it is not configurable via environment variables. If you need to expose the GraphQL API externally, proxy it through nginx or Cloudflare.

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
      virtualBNB
      migrationTarget
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

Base URL: `https://api.1coin.meme/api/v1`

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
X-RateLimit-Reset:      1741824060   ← Unix timestamp (seconds) when the window resets
Retry-After:            42           ← seconds until retry (only present on 429 responses)
```

`X-RateLimit-Reset` is a **Unix timestamp in seconds** indicating when the current rate-limit window expires. `Retry-After` is only sent with `429 Too Many Requests` responses.

When exceeded the API returns `429 Too Many Requests` with a `Retry-After` header.

| Route group | Limit | Reason |
|---|---|---|
| `/tokens/*/quote/*` | **20 req/min** | Each request makes a live RPC call to BSC |
| `/stats` | **10 req/min** | Executes 6 parallel aggregation queries |
| All other endpoints | **60 req/min** | Paginated DB queries |

### Origin Restriction

Origin enforcement is handled by **Cloudflare WAF** — see [CLOUDFLARE.md](CLOUDFLARE.md) Step 5.1. The app itself allows all origins; the WAF rule at the edge blocks requests whose `Origin` header is not in your configured UI domains.

### Endpoints

#### Info

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | public | Health check |
| `GET` | `/api/v1` | public | Route index — list of all available route groups |
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

#### BNB Price

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/price/bnb` | Aggregated BNB/USDT price averaged across Binance, OKX and Bybit — refreshed every 10 s |

Use this to convert all BNB wei amounts to USD on the frontend. If an exchange is unreachable its price is excluded from the average. If all fail, the last cached value is returned with `stale: true`.

#### Charts _(TradingView UDF)_

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/charts/config` | TradingView datafeed configuration |
| `GET` | `/api/v1/charts/symbols` | Token symbol info and pricescale — `?symbol=<address>` |
| `GET` | `/api/v1/charts/history` | OHLCV candles from bonding-curve trades — `?symbol&resolution&from&to&countback` |
| `GET` | `/api/v1/charts/search` | Token address search — `?query=<prefix>&limit=10` |
| `GET` | `/api/v1/charts/time` | Server unix timestamp |

Supported resolutions: `1`, `5`, `15`, `30`, `60`, `240`, `D`. Point TradingView's `datafeed` URL at `https://api.1coin.meme/api/v1/charts`. Migrated tokens return `{ s: "no_data" }` — chart goes blank.

#### Chat

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/chat/:token/messages` | Last 50 messages for a token, oldest-first |
| `WS`  | `/api/v1/chat/ws` | WebSocket chat — subscribe to a token room, send and receive messages in real time |

#### Vesting

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/vesting/:token` | Creator vesting schedule for a token — amount, claimed, claimable, progress |
| `GET` | `/api/v1/creators/:address/vesting` | All vesting schedules for a creator across all their tokens |

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
const ws = new WebSocket("wss://api.1coin.meme/api/v1/activity/ws?type=buy");
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
│   ├── LaunchpadFactory.json        # TokenCreated event + standardImpl/taxImpl/reflectionImpl
│   ├── BondingCurve.json            # TokenBought, TokenSold, TokenMigrated + getToken, getAmountOut, getSpotPrice
│   ├── ERC20.json                   # Transfer event (holder balance tracking)
│   ├── VestingWallet.json           # VestingAdded, Claimed, VestingVoided events + view functions
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
│           ├── price/               # /price/bnb — aggregated BNB/USDT (Binance+OKX+Bybit)
│           ├── charts/              # /charts/* — TradingView UDF (OHLCV from trades)
│           ├── chat/                # /chat/:token/messages (REST) + /chat/ws (WebSocket)
│           ├── vesting/             # /vesting/:token + /creators/:addr/vesting
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

> `tokenType` is derived at index time from the token's EIP-1167 implementation bytecode compared against the factory's `standardImpl` / `taxImpl` / `reflectionImpl` addresses — no longer emitted in the `TokenCreated` event directly.

---

## Bonding Curve Mechanics

During the pre-migration phase every token is traded through a constant-product bonding curve maintained by the factory:

- **Buy** → user sends BNB, receives tokens. During the *antibot window* (first N blocks after `tradingBlock`) a percentage of tokens is burned to the dead address (`tokensToDead`).
- **Sell** → user sends tokens back, receives BNB.
- **Migration** → once `raisedBNB` reaches the migration target, any caller can trigger `migrate()`. The factory deposits all raised BNB + 38% of token supply into a new PancakeSwap V2 pair as permanent liquidity.

---

## Deployment

### Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 20+ | `node --version` to verify |
| npm 9+ | Comes with Node.js 20 |
| Docker + Docker Compose | Latest stable — `docker compose version` to verify |
| git | Any version |
| BSC RPC (HTTP + WSS) | Archive-capable — QuickNode, Ankr, NodeReal, or GetBlock |
| VPS | Ubuntu 24.04 LTS — DigitalOcean, OVHcloud, or Netcup |

---

### Step 1 — Neon PostgreSQL

The indexer requires PostgreSQL. Use [Neon](https://neon.tech) — serverless Postgres with a free tier.

#### Create a Neon project

1. Sign up at [neon.tech](https://neon.tech)
2. Click **New Project** → give it a name (e.g. `onememe-indexer`) → select the region closest to your VPS
3. Neon creates a default database (`neondb`) and a default branch (`main`)

#### Get your connection string

1. Open the project dashboard
2. Click **Connection Details** (top right)
3. Select **Connection string** tab → copy the full URL:

```
postgresql://neondb_owner:<password>@ep-xxx-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

4. Save this as `DATABASE_URL` in your `.env`

#### Neon free tier limits

| Resource | Free tier | Launch plan ($19/mo) |
|---|---|---|
| Storage | 0.5 GB | 10 GB |
| Compute | 0.25 vCPU | 2 vCPU |
| Branches | 10 | Unlimited |

> 0.5 GB is enough for development and early-stage launch. Upgrade to the **Launch plan** before going public — the `trade` table grows fast under real volume.

Full Neon setup guide: [NEON.md](NEON.md)

---

### Step 2 — Vercel Domain

If your frontend domain is hosted on Vercel, you need to point your API subdomain to your VPS separately.

#### Add a custom API subdomain

1. Go to your domain registrar (Namecheap, GoDaddy, etc.) **or** your Vercel project's **Domains** tab
2. Add a new **A record**:

| Type | Name | Value | TTL |
|---|---|---|---|
| `A` | `api` | `YOUR_VPS_IP` | Auto |

This makes `api.yourdomain.com` resolve to your VPS.

> Vercel manages DNS for apex (`@`) and `www` — point only the `api` subdomain to the VPS. Do not touch Vercel's existing records.

#### Example (api.1coin.meme)

```
Type: A
Name: api
Value: 1.2.3.4   ← your VPS IP
TTL:  Auto
```

Once the DNS record is created, continue to Cloudflare setup below to enable HTTPS.

---

### Step 3 — Cloudflare TLS

The NestJS API runs plain HTTP on port 3001. Cloudflare terminates TLS and proxies requests to your VPS — no SSL certificates to manage.

#### Requirements

- Your domain is registered on Cloudflare **or** uses Cloudflare nameservers
- Your VPS IP is set as an `A` record with the **orange cloud (proxy) enabled**

#### Setup steps

**1. Add DNS A record** (if not done in Step 2)

In the Cloudflare dashboard → **DNS** → **Add record**:

| Type | Name | IPv4 address | Proxy status |
|---|---|---|---|
| A | `api` | `YOUR_VPS_IP` | Proxied (orange cloud ON) |

**2. Set SSL/TLS mode to Full**

Cloudflare dashboard → **SSL/TLS** → **Overview** → select **Full**

> Do not use Flexible — it sends traffic to your server unencrypted on port 80 and causes redirect loops.

**3. Enable WebSocket proxying**

Cloudflare dashboard → **Network** → toggle **WebSockets** to **On**

Required for `wss://` chat and activity WebSocket connections.

**4. Add cache bypass rule for `/api/*`**

Cloudflare dashboard → **Rules** → **Cache Rules** → **Create rule**:

- **Rule name:** `Bypass API cache`
- **Field:** URI Path → **contains** → `/api`
- **Cache status:** Bypass

This prevents Cloudflare from caching API responses.

**5. Verify**

```bash
curl -I https://api.yourdomain.com/health
# HTTP/2 200 — served via Cloudflare
```

Full Cloudflare guide including WAF, rate limiting, and bot protection: [CLOUDFLARE.md](CLOUDFLARE.md)

---

### Step 4 — VPS Setup

#### Provision Ubuntu 24.04 LTS

Minimum specs:
- **2 vCPU, 4 GB RAM** — fits both Ponder + NestJS
- **40 GB SSD** — Ponder checkpoint files + logs
- **IPv4** address

#### Install dependencies

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose plugin
sudo apt-get install -y docker-compose-plugin

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
npm install -g pm2

# Verify
docker --version && docker compose version && node --version && pm2 --version
```

#### Clone and configure

```bash
git clone https://github.com/timedbase/OneMEMELaunchpad-Indexer.git
cd OneMEMELaunchpad-Indexer
npm install
cp .env.example .env
nano .env   # fill in all required variables (see Environment Variables Reference below)
```

#### Build and start

```bash
# Build the NestJS API
npm run api:build

# Start both processes with PM2
pm2 start "npm run start" --name "ponder-indexer"
pm2 start "npm run api"   --name "onememe-api"

# Save PM2 process list so it survives reboots
pm2 save

# Register PM2 as a system service (follow the printed command)
pm2 startup
```

#### Check status

```bash
pm2 status                 # process overview
pm2 logs ponder-indexer    # Ponder indexer logs
pm2 logs onememe-api       # REST API logs
pm2 monit                  # live CPU/memory dashboard
```

#### Restart processes

```bash
pm2 restart ponder-indexer
pm2 restart onememe-api
pm2 restart all
```

---

### Step 5 — Better Stack Monitoring

Better Stack provides log aggregation, uptime monitoring, and a public status page.

#### Uptime monitor (free)

1. Sign up at [betterstack.com](https://betterstack.com)
2. Go to **Uptime** → **New monitor**
3. Set URL to `https://api.yourdomain.com/health`
4. Set check interval to **1 minute**
5. Add your email or Telegram for alerts

#### Log shipping

Log shipping is built into the API — no code changes needed. To activate:

1. Go to **Logs** → **Connect source** → **Node.js**
2. Copy the **Source token**
3. Set `BETTERSTACK_TOKEN=<token>` in `.env`
4. Restart the API — logs appear in Better Stack Live Tail within seconds

> If `BETTERSTACK_TOKEN` is not set the API still starts normally, logging to console only.

#### Status page

1. Go to **Status Pages** → **New status page**
2. Add your uptime monitor as a component
3. Publish at `status.yourdomain.com` or the provided Better Stack URL
4. Share with your community

Full Better Stack setup guide: [BETTERSTACK.md](BETTERSTACK.md)

---

### Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `BSC_WSS_URL` | **Yes** | BSC WebSocket endpoint (`wss://…`) — primary real-time streaming |
| `BSC_RPC_URL` | **Yes** | BSC HTTP endpoint — fallback transport + live quote RPC |
| `CHAIN_ID` | **Yes** | EVM chain ID (`56` = BSC mainnet, `97` = BSC testnet) |
| `FACTORY_ADDRESS` | **Yes** | Deployed `LaunchpadFactory` contract address |
| `BONDING_CURVE_ADDRESS` | **Yes** | Deployed `BondingCurve` contract address |
| `VESTING_WALLET_ADDRESS` | **Yes** | Deployed `VestingWallet` contract address |
| `START_BLOCK` | Recommended | Factory deployment block — avoids scanning from genesis |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string (Neon: `postgresql://...?sslmode=require`) |
| `API_PORT` | No | REST API port (default `3001`) |
| `NODE_ENV` | Recommended | Set to `production` on VPS |
| `PINATA_JWT` | For uploads | Pinata API JWT — required for `POST /metadata/upload` |
| `IPFS_GATEWAY` | No | Custom IPFS gateway (default: `https://gateway.pinata.cloud/ipfs/`) |
| `BETTERSTACK_TOKEN` | No | Better Stack log source token for log shipping |
| `PONDER_TELEMETRY_DISABLED` | No | Set to `1` to disable Ponder anonymous telemetry |

---

### Health Check

After deployment, verify all services are running:

```bash
# 1. REST API health
curl https://api.yourdomain.com/health
# → {"status":"ok","service":"onememe-launchpad-api","timestamp":...}

# 2. Route index
curl https://api.yourdomain.com/api/v1
# → {"service":"onememe-launchpad-api","version":"v1","routes":[...]}

# 3. BNB price feed (confirms external exchange connectivity)
curl https://api.yourdomain.com/api/v1/price/bnb
# → {"bnbUsdt":"610.42","sources":[...],"stale":false}

# 4. Stats (confirms DB connectivity)
curl https://api.yourdomain.com/api/v1/stats
# → {"totalTokens":...,"totalTrades":...}
```

If step 4 fails, check `pm2 logs ponder-indexer` — the indexer may still be syncing from `START_BLOCK`.

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
