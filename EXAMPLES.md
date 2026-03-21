# OneMEME Launchpad API — Examples

Complete reference of every endpoint with `curl` commands and expected JSON responses.

> **Base URL:** `https://api.1coin.meme` (HTTP if TLS is not configured — see [HTTPS Setup](#https--wss-setup))
> **All BNB / token amounts** are returned as strings (wei, 18 decimals) to preserve uint256 precision.
> **Pagination** is available on all list endpoints via `?page=` and `?limit=` (max 100).
> **Origin enforcement** is handled by Cloudflare WAF — requests from unlisted origins are blocked at the edge before reaching the API.

---

## Table of Contents

1. [Health Check](#1-health-check)
2. [Platform Stats](#2-platform-stats)
3. [Tokens](#3-tokens)
   - [List tokens](#31-list-tokens)
   - [Single token + metadata](#32-single-token--metadata)
   - [Token trades](#33-token-trades)
   - [Top traders leaderboard](#34-top-traders-leaderboard)
   - [Token holders](#35-token-holders)
   - [Migration record](#36-migration-record)
4. [Quote Simulation (Live RPC)](#4-quote-simulation-live-rpc)
   - [Spot price](#41-spot-price)
   - [Buy quote](#42-buy-quote)
   - [Sell quote](#43-sell-quote)
5. [Trades](#5-trades)
   - [All trades](#51-all-trades)
   - [Trades by wallet](#52-trades-by-wallet)
6. [Migrations](#6-migrations)
7. [Creators](#7-creators)
8. [Activity Feed](#8-activity-feed)
   - [Paginated feed](#81-paginated-feed)
   - [Real-time SSE stream](#82-real-time-sse-stream)
   - [Real-time WebSocket (WSS)](#83-real-time-websocket-wss)
9. [Discovery](#9-discovery)
   - [Trending](#91-trending)
   - [New tokens](#92-new-tokens)
   - [Bonding](#93-bonding)
   - [Migrated](#94-migrated)
10. [Leaderboard](#10-leaderboard)
    - [Traders by volume](#101-traders-by-volume)
    - [Tokens by volume](#102-tokens-by-volume)
    - [Creators](#103-creators)
    - [Users (combined)](#104-users-traders--creators-combined)
11. [Metadata Upload (IPFS)](#11-metadata-upload-ipfs)
    - [Full flow](#111-full-flow)
    - [Upload](#112-upload)
    - [Frontend integration](#113-frontend-integration)
12. [BNB Price](#12-bnb-price)
13. [Charts (TradingView UDF)](#13-charts-tradingview-udf)
    - [Config](#131-config)
    - [Symbols](#132-symbols)
    - [History (OHLCV)](#133-history-ohlcv)
    - [Search](#134-search)
14. [Token Chat](#14-token-chat)
    - [Fetch message history (REST)](#141-fetch-message-history-rest)
    - [Real-time chat (WebSocket)](#142-real-time-chat-websocket)
15. [Vesting](#15-vesting)
    - [Token vesting schedule](#151-token-vesting-schedule)
    - [Creator vesting schedules](#152-creator-vesting-schedules)
16. [Vanity Salt Mining](#16-vanity-salt-mining)
    - [Get session result](#161-get-session-result)
    - [Stream (start fresh mine)](#162-stream-start-fresh-mine)
    - [Frontend integration](#163-frontend-integration)
17. [Rate Limit Response](#17-rate-limit-response)
18. [Origin Restriction (403)](#18-origin-restriction-403)
19. [Error Shapes](#19-error-shapes)

---

## 1. Health Check

Verify the API server is running. No rate limit, no origin restriction.

```bash
curl https://api.1coin.meme/health
```

**Response `200 OK`**

```json
{
  "status": "ok",
  "service": "onememe-launchpad-api",
  "timestamp": 1741824000000
}
```

---

## 2. Platform Stats

Aggregated platform-wide statistics. Rate limit: **10 req/min**.

```bash
curl https://api.1coin.meme/api/v1/stats \
  -H "Origin: https://1coin.meme"
```

**Response `200 OK`**

```json
{
  "data": {
    "totalTokens":    1042,
    "migratedTokens": 38,
    "activeTokens":   1004,
    "tokensByType": {
      "Standard":   700,
      "Tax":        280,
      "Reflection": 62
    },
    "totalTrades":       84621,
    "totalBuys":         51390,
    "totalSells":        33231,
    "uniqueTraders":     9847,
    "totalVolumeBNB":    "18420000000000000000000",
    "totalLiquidityBNB": "3200000000000000000000",
    "latestTwap": {
      "priceAvg":         "310000000000000000",
      "priceBlockNumber": "42000000",
      "blockNumber":      "42001000",
      "timestamp":        1741823900
    },
    "topTokenByVolume": {
      "id":        "0xdeadbeef...1111",
      "creator":   "0xaaaa...",
      "volumeBNB": "980000000000000000000",
      "buyCount":  3210,
      "sellCount": 1100,
      "migrated":  true
    }
  }
}
```

---

## 3. Tokens

### 3.1 List tokens

```bash
# Newest first (default)
curl "https://api.1coin.meme/api/v1/tokens?limit=5"

# Tax tokens not yet migrated, sorted by volume
curl "https://api.1coin.meme/api/v1/tokens?type=Tax&migrated=false&orderBy=volumeBNB&limit=10"
```

**Query params:**

| Param | Values | Default |
|---|---|---|
| `type` | `Standard` \| `Tax` \| `Reflection` | all — invalid value returns `400` |
| `migrated` | `true` \| `false` | all |
| `orderBy` | `createdAtBlock` \| `volumeBNB` \| `buyCount` \| `sellCount` \| `raisedBNB` \| `totalSupply` | `createdAtBlock` |
| `orderDir` | `asc` \| `desc` | `desc` |
| `page`, `limit` | int | 1, 20 |

**Response `200 OK`**

```json
{
  "data": [
    {
      "id":                 "0xabc...1111",
      "tokenType":          "Tax",
      "creator":            "0xdeadbeef...",
      "totalSupply":        "1000000000000000000000000000",
      "virtualBNB":         "30000000000000000000",
      "antibotEnabled":     true,
      "tradingBlock":       "42000100",
      "createdAtBlock":     "42000000",
      "createdAtTimestamp": 1741820000,
      "migrated":           false,
      "pairAddress":        null,
      "buyCount":           142,
      "sellCount":          41,
      "volumeBNB":          "820000000000000000000",
      "raisedBNB":          "610000000000000000000",
      "migrationTarget":    "800000000000000000000",
      "creatorTokens":      "50000000000000000000000000"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 1042, "pages": 209, "hasMore": true }
}
```

---

### 3.2 Single token + metadata

Off-chain metadata (name, image, description, website, socials) is resolved from the token's `metaURI` and merged into the response.

```bash
curl "https://api.1coin.meme/api/v1/tokens/0xabc...1111"
```

**Response `200 OK`**

```json
{
  "data": {
    "id":                 "0xabc...1111",
    "tokenType":          "Tax",
    "creator":            "0xdeadbeef...",
    "totalSupply":        "1000000000000000000000000000",
    "virtualBNB":         "30000000000000000000",
    "antibotEnabled":     true,
    "tradingBlock":       "42000100",
    "createdAtBlock":     "42000000",
    "createdAtTimestamp": 1741820000,
    "migrated":           false,
    "pairAddress":        null,
    "buyCount":           142,
    "sellCount":          41,
    "volumeBNB":          "820000000000000000000",
    "raisedBNB":          "610000000000000000000",
    "migrationTarget":    "800000000000000000000",
    "creatorTokens":      "50000000000000000000000000",
    "metaURI":  "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    "metadata": {
      "name":        "PepeBSC",
      "symbol":      "PEPE",
      "description": "The original Pepe on BSC launchpad.",
      "image":       "https://ipfs.io/ipfs/bafybeid.../pepe.png",
      "imageRaw":    "ipfs://bafybeid.../pepe.png",
      "website":     "https://pepebsc.io",
      "socials": {
        "twitter":  "https://twitter.com/pepebsc",
        "telegram": "https://t.me/pepebsc",
        "discord":  null,
        "github":   null,
        "medium":   null
      }
    }
  }
}
```

> If the token has no `metaURI` or metadata resolution fails, `metaURI` and `metadata` are returned as `null`.

---

### 3.3 Token trades

```bash
curl "https://api.1coin.meme/api/v1/tokens/0xabc...1111/trades?type=buy&limit=10"
```

**Query params:** `type` (`buy`|`sell`), `orderBy` (`timestamp`|`bnbAmount`|`tokenAmount`|`blockNumber`), `orderDir`, `from`, `to`, `page`, `limit`

**Response `200 OK`**

```json
{
  "data": [
    {
      "id":           "0xtxhash...-4",
      "token":        "0xabc...1111",
      "tradeType":    "buy",
      "trader":       "0xbuyer...",
      "bnbAmount":    "500000000000000000",
      "tokenAmount":  "6172839000000000000000",
      "tokensToDead": "617283900000000000000",
      "raisedBNB":    "610000000000000000000",
      "blockNumber":  "42001234",
      "txHash":       "0xtxhash...",
      "timestamp":    1741823000
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 142, "pages": 15, "hasMore": true }
}
```

---

### 3.4 Top traders leaderboard

```bash
curl "https://api.1coin.meme/api/v1/tokens/0xabc...1111/traders?limit=10&orderBy=totalVolumeBNB"
```

**Query params:** `orderBy` (`totalVolumeBNB`|`totalTrades`|`buyCount`|`sellCount`|`netBNB`), `orderDir`, `page`, `limit`

**Response `200 OK`**

```json
{
  "data": [
    {
      "trader":         "0xwhale...",
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

---

### 3.5 Token holders

Derives estimated holder positions from bonding-curve trade history (buys − sells per wallet). Only wallets with a positive net token balance are returned.

```bash
curl "https://api.1coin.meme/api/v1/tokens/0xabc...1111/holders?limit=20"
```

**Query params:**

| Param | Values | Default |
|---|---|---|
| `orderBy` | `estimatedBalance` \| `buyCount` \| `sellCount` \| `totalTrades` | `estimatedBalance` |
| `orderDir` | `asc` \| `desc` | `desc` |
| `page`, `limit` | int | 1, 20 |

**Response `200 OK`**

```json
{
  "data": [
    {
      "address":           "0xwhale...",
      "buyCount":          14,
      "sellCount":         3,
      "totalTrades":       17,
      "estimatedBalance":  "11234567000000000000000",
      "totalBNBIn":        "5200000000000000000",
      "totalBNBOut":       "1800000000000000000",
      "lastTradeAt":       1741823000
    },
    {
      "address":           "0xholder2...",
      "buyCount":          2,
      "sellCount":         0,
      "totalTrades":       2,
      "estimatedBalance":  "2500000000000000000000",
      "totalBNBIn":        "210000000000000000",
      "totalBNBOut":       "0",
      "lastTradeAt":       1741821000
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 89, "pages": 5, "hasMore": true },
  "note": "Derived from bonding-curve trade history. Does not account for P2P token transfers."
}
```

> `estimatedBalance` is in token wei (18 decimals). It represents `totalTokensBought − totalTokensSold` on the bonding curve — it does not reflect tokens received/sent via direct wallet transfers.

---

### 3.6 Migration record

```bash
curl "https://api.1coin.meme/api/v1/tokens/0xabc...1111/migration"
```

**Response `200 OK`** (after migration) / **`404`** (not yet migrated)

```json
{
  "data": {
    "id":               "0xabc...1111",
    "token":            "0xabc...1111",
    "pair":             "0xpancakepair...",
    "liquidityBNB":     "1000000000000000000000",
    "liquidityTokens":  "380000000000000000000000000",
    "blockNumber":      "42005000",
    "txHash":           "0xmigrationtx...",
    "timestamp":        1741850000
  }
}
```

---

## 4. Quote Simulation (Live RPC)

All quote endpoints call the live `BondingCurve` contract via `BSC_RPC_URL`. Rate limit: **20 req/min**.

### 4.1 Spot price

```bash
curl "https://api.1coin.meme/api/v1/tokens/0xabc...1111/quote/price"
```

**Response `200 OK`**

```json
{
  "data": {
    "token":          "0xabc...1111",
    "migrated":       false,
    "spotPriceWei":   "81000000000000",
    "spotPriceBNB":   "0.000081",
    "tokensPerBNB":   "12345.679012345679",
    "antibotEnabled": true,
    "tradingBlock":   "42000100"
  }
}
```

---

### 4.2 Buy quote

Simulate purchasing tokens with BNB. Input amounts are in **wei**.

```bash
# 1 BNB in, 1% slippage
curl "https://api.1coin.meme/api/v1/tokens/0xabc...1111/quote/buy?bnbIn=1000000000000000000&slippage=100"
```

**Query params:**

| Param | Required | Description |
|---|---|---|
| `bnbIn` | Yes | BNB input in wei (e.g. `1000000000000000000` = 1 BNB) |
| `slippage` | No | Tolerance in basis points (default `100` = 1%, range `0`–`5000`) — negative values return `400` |

**Response `200 OK`**

```json
{
  "data": {
    "token":                  "0xabc...1111",
    "type":                   "buy",
    "migrated":               false,
    "bnbIn":                  "1000000000000000000",
    "bnbInFormatted":         "1.0",
    "tokensOut":              "12345678000000000000000",
    "tokensOutFormatted":     "12345.678",
    "spotPriceWei":           "81000000000000",
    "spotPriceBNB":           "0.000081",
    "effectivePriceWei":      "81040000000000",
    "effectivePriceBNB":      "0.00008104",
    "priceImpactBps":         "49",
    "priceImpactPct":         "0.49%",
    "slippageBps":            "100",
    "minimumOutput":          "12222221220000000000000",
    "minimumOutputFormatted": "12222.22122",
    "antibotEnabled":         true,
    "tradingBlock":           "42000100"
  }
}
```

---

### 4.3 Sell quote

```bash
# 10 000 tokens in, 2% slippage
curl "https://api.1coin.meme/api/v1/tokens/0xabc...1111/quote/sell?tokensIn=10000000000000000000000&slippage=200"
```

**Response `200 OK`**

```json
{
  "data": {
    "token":                  "0xabc...1111",
    "type":                   "sell",
    "migrated":               false,
    "tokensIn":               "10000000000000000000000",
    "tokensInFormatted":      "10000.0",
    "bnbOut":                 "808080000000000000",
    "bnbOutFormatted":        "0.80808",
    "spotPriceWei":           "81000000000000",
    "spotPriceBNB":           "0.000081",
    "effectivePriceWei":      "80808000000000",
    "effectivePriceBNB":      "0.000080808",
    "priceImpactBps":         "24",
    "priceImpactPct":         "0.24%",
    "slippageBps":            "200",
    "minimumOutput":          "791918400000000000",
    "minimumOutputFormatted": "0.7919184",
    "antibotEnabled":         true,
    "tradingBlock":           "42000100"
  }
}
```

> If the token has migrated, all quote endpoints return `{ migrated: true, message: "Token has migrated to PancakeSwap..." }` instead of a 404.

---

## 5. Trades

### 5.1 All trades

```bash
# All trades, newest first
curl "https://api.1coin.meme/api/v1/trades?limit=20"

# Buys only for a specific token
curl "https://api.1coin.meme/api/v1/trades?token=0xabc...1111&type=buy"

# Trades in a time window
curl "https://api.1coin.meme/api/v1/trades?from=1741800000&to=1741824000"
```

**Query params:** `token`, `trader`, `type` (`buy`|`sell`), `from`, `to`, `orderBy` (`timestamp`|`bnbAmount`|`tokenAmount`|`blockNumber`), `orderDir`, `page`, `limit`

**Response `200 OK`**

```json
{
  "data": [
    {
      "id":           "0xtxhash...-2",
      "token":        "0xabc...1111",
      "tradeType":    "sell",
      "trader":       "0xseller...",
      "bnbAmount":    "200000000000000000",
      "tokenAmount":  "2500000000000000000000",
      "tokensToDead": null,
      "raisedBNB":    "608000000000000000000",
      "blockNumber":  "42001100",
      "txHash":       "0xtxhash...",
      "timestamp":    1741821000
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 84621, "pages": 4232, "hasMore": true }
}
```

---

### 5.2 Trades by wallet

```bash
curl "https://api.1coin.meme/api/v1/traders/0xwhale.../trades?type=buy&limit=10"
```

**Query params:** `type`, `from`, `to`, `page`, `limit`

---

## 6. Migrations

```bash
curl "https://api.1coin.meme/api/v1/migrations?orderBy=liquidityBNB&limit=10"
```

**Query params:** `orderBy` (`timestamp`|`liquidityBNB`|`liquidityTokens`|`blockNumber`), `orderDir`, `page`, `limit`

**Response `200 OK`**

```json
{
  "data": [
    {
      "id":               "0xabc...1111",
      "token":            "0xabc...1111",
      "pair":             "0xpancakepair...",
      "liquidityBNB":     "1000000000000000000000",
      "liquidityTokens":  "380000000000000000000000000",
      "blockNumber":      "42005000",
      "txHash":           "0xmigrationtx...",
      "timestamp":        1741850000
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 38, "pages": 4, "hasMore": false }
}
```

---

## 7. Creators

Tokens deployed by a specific creator wallet.

```bash
curl "https://api.1coin.meme/api/v1/creators/0xcreator.../tokens?limit=10"
```

**Response** — same paginated token shape as [3.1 List tokens](#31-list-tokens).

---

## 8. Activity Feed

Unified stream of create/buy/sell events across all tokens. Origin-restricted via Cloudflare WAF.

### 8.1 Paginated feed

```bash
curl "https://api.1coin.meme/api/v1/activity" \
  -H "Origin: https://1coin.meme"

# Filter by event type
curl "https://api.1coin.meme/api/v1/activity?type=buy&limit=10" \
  -H "Origin: https://1coin.meme"

# Filter by token
curl "https://api.1coin.meme/api/v1/activity?token=0xabc...1111" \
  -H "Origin: https://1coin.meme"
```

**Query params:** `type` (`create`|`buy`|`sell`), `token` (address), `page`, `limit`

**Response `200 OK`**

```json
{
  "data": [
    {
      "eventType":   "buy",
      "token":       "0xabc...1111",
      "actor":       "0xbuyer...",
      "bnbAmount":   "500000000000000000",
      "tokenAmount": "6172839000000000000000",
      "blockNumber": "42001234",
      "timestamp":   1741823000,
      "txHash":      "0xtxhash..."
    },
    {
      "eventType":   "create",
      "token":       "0xdef...1111",
      "actor":       "0xcreator...",
      "bnbAmount":   null,
      "tokenAmount": null,
      "blockNumber": "42001200",
      "timestamp":   1741822900,
      "txHash":      "0xcreationtx..."
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 86705, "pages": 4336, "hasMore": true }
}
```

---

### 8.2 Real-time SSE stream

Pushes new events as they are indexed (2 s DB poll, 15 s keepalive). Long-lived connection — no rate limit.

```bash
# curl (streams to terminal)
curl -N "https://api.1coin.meme/api/v1/activity/stream" \
  -H "Origin: https://1coin.meme"

# Filter buys for a specific token
curl -N "https://api.1coin.meme/api/v1/activity/stream?type=buy&token=0xabc...1111" \
  -H "Origin: https://1coin.meme"
```

**Browser (EventSource):**

```js
const es = new EventSource("https://api.1coin.meme/api/v1/activity/stream?type=buy");
es.addEventListener("activity",  (e) => console.log(JSON.parse(e.data)));
es.addEventListener("keepalive", ()  => {});
es.onerror = () => console.warn("SSE disconnected, browser will reconnect");
```

**SSE frames:**

```
event: activity
data: {"eventType":"buy","token":"0xabc...1111","actor":"0xbuyer...","bnbAmount":"500000000000000000","tokenAmount":"6172839000000000000000","blockNumber":"42001234","timestamp":1741823000,"txHash":"0xtxhash..."}

event: keepalive
data:
```

---

### 8.3 Real-time WebSocket (WSS)

Same data as SSE but over a persistent WebSocket connection. Automatically WSS when the server has TLS configured.

```

wss://api.1coin.meme/api/v1/activity/ws
```

**Optional query params on connect:**

| Param | Example | Description |
|---|---|---|
| `type` | `?type=buy` | Filter by event type (`create` \| `buy` \| `sell`) |
| `token` | `?token=0xabc...1111` | Filter by token address |

**Browser:**

```js
const ws = new WebSocket("wss://api.1coin.meme/api/v1/activity/ws?type=buy");

ws.onopen    = ()  => console.log("Connected");
ws.onmessage = (e) => {
  const { event, data } = JSON.parse(e.data);
  if (event === "activity")  console.log("New event:", JSON.parse(data));
  if (event === "keepalive") {} // heartbeat, ignore
};
ws.onclose   = ()  => console.log("Disconnected");
```

The `data` field is a **JSON string** — same format as SSE's `e.data` — so `JSON.parse(data)` gives the row object in both transports.

**Message format:**

```
{ "event": "activity",  "data": "{\"eventType\":\"buy\",\"token\":\"0xabc...1111\",\"actor\":\"0xbuyer...\",\"bnbAmount\":\"500000000000000000\",\"tokenAmount\":\"6172839000000000000000\",\"blockNumber\":\"42001234\",\"timestamp\":1741823000,\"txHash\":\"0xtxhash...\"}" }

{ "event": "keepalive", "data": "" }

{ "event": "error",     "data": "Invalid type: foo" }
```

---

## 9. Discovery

All discovery endpoints are restricted to `ALLOWED_ORIGINS` and return paginated token lists. Rate limit: **60 req/min**.

### 9.1 Trending

Tokens ranked by trade count in the last 30 minutes (configurable).

```bash
curl "https://api.1coin.meme/api/v1/discover/trending" \
  -H "Origin: https://1coin.meme"

# Custom window — last 5 minutes
curl "https://api.1coin.meme/api/v1/discover/trending?window=300" \
  -H "Origin: https://1coin.meme"
```

**Query params:** `window` (seconds, default `1800`, max `86400`), `page`, `limit`

**Response `200 OK`**

```json
{
  "data": [
    {
      "id":              "0xabc...1111",
      "tokenType":       "Tax",
      "creator":         "0xdeadbeef...",
      "virtualBNB":      "30000000000000000000",
      "migrationTarget": "800000000000000000000",
      "buyCount":        142,
      "sellCount":       41,
      "volumeBNB":       "820000000000000000000",
      "raisedBNB":       "610000000000000000000",
      "migrated":        false,
      "recentTrades":    23,
      "recentBuys":      18,
      "recentSells":     5,
      "recentVolumeBNB": "9200000000000000000"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 47, "pages": 3, "hasMore": true },
  "window": 1800,
  "since":  1741822200
}
```

---

### 9.2 New tokens

Freshly launched, non-migrated tokens newest first.

```bash
curl "https://api.1coin.meme/api/v1/discover/new" \
  -H "Origin: https://1coin.meme"

# Filter to Tax tokens only
curl "https://api.1coin.meme/api/v1/discover/new?type=Tax" \
  -H "Origin: https://1coin.meme"
```

**Query params:** `type` (`Standard`|`Tax`|`Reflection`), `page`, `limit`

---

### 9.3 Bonding

Active bonding-curve tokens sorted by `raisedBNB` descending — closest to migrating first. Each token includes `migrationTarget` (BNB wei) so the frontend can render bonding progress without an extra on-chain read.

```bash
curl "https://api.1coin.meme/api/v1/discover/bonding" \
  -H "Origin: https://1coin.meme"
```

**Query params:** `type`, `page`, `limit`

**Response extras per token:**

```json
{
  "recentTrades":    12,
  "recentVolumeBNB": "5000000000000000000"
}
```

_(24 h window)_

---

### 9.4 Migrated

Tokens graduated to PancakeSwap V2, joined with migration data.

```bash
curl "https://api.1coin.meme/api/v1/discover/migrated?orderBy=liquidityBNB&limit=10" \
  -H "Origin: https://1coin.meme"
```

**Query params:** `type`, `orderBy` (`migratedAt`|`liquidityBNB`|`volumeBNB`), `orderDir`, `page`, `limit`

**Response extras per token:**

```json
{
  "pairAddress":    "0xpancakepair...",
  "liquidityBNB":   "1000000000000000000000",
  "liquidityTokens":"380000000000000000000000000",
  "migratedAtBlock":"42005000",
  "migratedAt":     1741850000,
  "migrationTxHash":"0xmigrationtx..."
}
```

---

## 10. Leaderboard

Platform leaderboards. All support `?period=alltime|1d|7d|30d`. No origin restriction.

### 10.1 Traders by volume

```bash
curl "https://api.1coin.meme/api/v1/leaderboard/traders"
curl "https://api.1coin.meme/api/v1/leaderboard/traders?period=1d"
curl "https://api.1coin.meme/api/v1/leaderboard/traders?period=7d"
curl "https://api.1coin.meme/api/v1/leaderboard/traders?period=30d"
```

**Response `200 OK`**

```json
{
  "period": "7d",
  "data": [
    {
      "address":      "0xwhale...",
      "volumeBNB":    "42000000000000000000",
      "tradeCount":   38,
      "buyCount":     22,
      "sellCount":    16,
      "tokensTraded": 5,
      "lastTradeAt":  1741900000
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 214, "pages": 5, "hasMore": true }
}
```

### 10.2 Tokens by volume

```bash
curl "https://api.1coin.meme/api/v1/leaderboard/tokens"
curl "https://api.1coin.meme/api/v1/leaderboard/tokens?period=7d&orderBy=tradeCount"
```

**Query params:**

| Param | Values | Default |
|---|---|---|
| `period` | `alltime` \| `1d` \| `7d` \| `30d` | `alltime` |
| `orderBy` | `volumeBNB` \| `tradeCount` \| `buyCount` \| `sellCount` \| `raisedBNB` | `volumeBNB` |
| `page`, `limit` | int | 1, 50 |

**Response `200 OK`**

```json
{
  "period": "7d",
  "orderBy": "volumeBNB",
  "data": [
    {
      "address":       "0xtoken...1111",
      "tokenType":     "Standard",
      "creator":       "0xcreator...",
      "migrated":      false,
      "volumeBNB":     "980000000000000000000",
      "tradeCount":    3210,
      "buyCount":      2100,
      "sellCount":     1110,
      "uniqueTraders": 842,
      "raisedBNB":     "4800000000000000000",
      "createdAt":     1741800000
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1042, "pages": 21, "hasMore": true }
}
```

### 10.3 Creators

```bash
curl "https://api.1coin.meme/api/v1/leaderboard/creators"
curl "https://api.1coin.meme/api/v1/leaderboard/creators?period=30d"
```

**Response `200 OK`**

```json
{
  "period": "30d",
  "data": [
    {
      "address":        "0xcreator...",
      "tokensLaunched": 12,
      "tokensMigrated": 3,
      "totalVolumeBNB": "142000000000000000000",
      "totalRaisedBNB": "15000000000000000000",
      "lastLaunchAt":   1741900000
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 380, "pages": 8, "hasMore": true }
}
```

### 10.4 Users (traders + creators combined)

Combined view merging trading activity and token creation stats per wallet.

```bash
curl "https://api.1coin.meme/api/v1/leaderboard/users"
curl "https://api.1coin.meme/api/v1/leaderboard/users?period=7d"
```

**Response `200 OK`**

```json
{
  "period": "7d",
  "data": [
    {
      "address":        "0xwhale...",
      "volumeBNB":      "42000000000000000000",
      "tradeCount":     38,
      "buyCount":       22,
      "sellCount":      16,
      "tokensTraded":   5,
      "lastTradeAt":    1741900000,
      "tokensLaunched": 2,
      "tokensMigrated": 1,
      "totalRaisedBNB": "10000000000000000000"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 520, "pages": 11, "hasMore": true }
}
```

> Sorted by `volumeBNB` descending, then `tokensLaunched` descending. Wallets with no trades show `volumeBNB: "0"`. Wallets with no launches show `tokensLaunched: 0`.

---

## 11. Metadata Upload (IPFS)

Upload token metadata to IPFS via Pinata. Returns an IPFS URI the token creator passes directly to `setMetaURI()` on their token contract.

**Requires** `PINATA_JWT` in `.env`.

### 11.1 Full flow

```
Token creator
  │
  ├─ 1. POST /api/v1/metadata/upload  ──►  API pins image + JSON to Pinata
  │                                   ◄──  { metaURI: "ipfs://Qm..." }
  │
  └─ 2. Call tokenContract.setMetaURI("ipfs://Qm...")  on-chain
         └─ Future GET /tokens/:address returns resolved metadata
```

---

### 11.2 Upload

**Form fields:**

| Field | Required | Description |
|---|---|---|
| `image` | Yes | Token image — jpeg/png/gif/webp/svg, max 3 MB |
| `name` | Yes | Token display name |
| `symbol` | Yes | Token ticker (e.g. `PEPE`) |
| `description` | Yes | Short token description |
| `website` | No | Project website URL |
| `x` | No | Twitter/X URL |
| `telegram` | No | Telegram link |

```bash
curl -X POST https://api.1coin.meme/api/v1/metadata/upload \
  -F "image=@./pepe.png;type=image/png" \
  -F "name=PepeBSC" \
  -F "symbol=PEPE" \
  -F "description=The original Pepe on BSC launchpad." \
  -F "website=https://pepebsc.io" \
  -F "x=https://x.com/pepebsc" \
  -F "telegram=https://t.me/pepebsc"
```

**Response `200 OK`**

```json
{
  "data": {
    "metaURI":    "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    "ipfsHash":   "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    "gatewayUrl": "https://ipfs.io/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    "imageUri":   "ipfs://bafybeid4x7y3xp2y7h3vkjk5b3b7c3e2i6f2r7n5t4q3y8z6d1a2c9m1k",
    "instructions": {
      "nextStep": "Call setMetaURI(metaURI) on your token contract with the metaURI value above.",
      "example":  "tokenContract.setMetaURI(\"ipfs://bafybeigdyrzt5sfp7...\")"
    }
  }
}
```

**The pinned metadata JSON** (resolvable at `gatewayUrl`):

```json
{
  "name":        "PepeBSC",
  "symbol":      "PEPE",
  "description": "The original Pepe on BSC launchpad.",
  "image":       "ipfs://bafybeid4x7y3xp2y7h3vkjk5b3b7c3e2i6f2r7n5t4q3y8z6d1a2c9m1k",
  "website":     "https://pepebsc.io",
  "socials": {
    "x":        "https://x.com/pepebsc",
    "telegram": "https://t.me/pepebsc"
  }
}
```

---

### 11.3 Frontend integration

```js
// React / Next.js example
async function uploadMetadata({ name, symbol, description, website, x, telegram, imageFile }) {
  const form = new FormData();
  form.append("image",       imageFile);   // File — required
  form.append("name",        name);        // required
  form.append("symbol",      symbol);      // required
  form.append("description", description); // required
  if (website)  form.append("website",  website);
  if (x)        form.append("x",        x);
  if (telegram) form.append("telegram", telegram);
  // Do NOT set Content-Type — browser sets it with boundary automatically.

  const res = await fetch("https://api.1coin.meme/api/v1/metadata/upload", {
    method: "POST",
    body:   form,
  });

  if (!res.ok) throw new Error(await res.text());
  const { data } = await res.json();
  return data.metaURI; // "ipfs://bafybei..."  ← pass this to setMetaURI()
}

// After token creation, call setMetaURI on-chain:
async function setTokenMetadata(tokenContract, metaURI) {
  const tx = await tokenContract.setMetaURI(metaURI);
  await tx.wait();
  console.log("Metadata set:", metaURI);
}
```

**Supported image formats:** jpeg, png, gif, webp, svg — max **3 MB**.

**Form fields:**

| Field | Required | Description |
|---|---|---|
| `image` | **Yes** | Token image file (multipart, max 3 MB) |
| `name` | **Yes** | Token display name |
| `symbol` | No | Token ticker symbol (e.g. `PEPE`) |
| `description` | No | Short token description |
| `website` | No | Project website URL |
| `x` | No | Twitter / X URL or handle |
| `telegram` | No | Telegram invite link |

---

## 12. BNB Price

Aggregated BNB/USDT spot price averaged across Binance, OKX, and Bybit. Refreshed every 10 seconds in the background. Use this to convert all BNB wei amounts displayed to users into USD.

```bash
curl "https://api.1coin.meme/api/v1/price/bnb"
```

**Response `200 OK`**

```json
{
  "bnbUsdt": 612.3267,
  "sources": [
    { "exchange": "Binance", "price": 612.41, "ok": true },
    { "exchange": "OKX",     "price": 612.28, "ok": true },
    { "exchange": "Bybit",   "price": 612.31, "ok": true }
  ],
  "updatedAt": 1741824010,
  "stale": false
}
```

**Fields:**

| Field | Description |
|---|---|
| `bnbUsdt` | Averaged price across all live sources |
| `sources` | Per-exchange breakdown; `price` is `null` and `ok` is `false` if that exchange failed |
| `updatedAt` | Unix timestamp of the last refresh |
| `stale` | `true` if all 3 exchanges failed on the last refresh — cached value is returned |

**Frontend usage — convert BNB wei to USD:**

```js
const { bnbUsdt } = await fetch("/api/v1/price/bnb").then(r => r.json());

// bnbAmount is a wei string returned by any trade/token endpoint
function bnbWeiToUsd(weiStr, bnbUsdt) {
  const bnb = Number(BigInt(weiStr)) / 1e18;
  return (bnb * bnbUsdt).toFixed(2);
}

// e.g. "500000000000000000" → "$306.16"
console.log("$" + bnbWeiToUsd("500000000000000000", bnbUsdt));
```

---

## 13. Charts (TradingView UDF)

OHLCV candle data for bonding-curve tokens, compatible with the TradingView Charting Library.

Point your datafeed at: `https://api.1coin.meme/api/v1/charts`

```js
new TradingView.widget({
  datafeed: new Datafeeds.UDFCompatibleDatafeed("https://api.1coin.meme/api/v1/charts"),
  symbol:   "0xYourTokenAddress1111",
  interval: "15",
});
```

Migrated tokens return `{ s: "no_data" }` — chart goes blank automatically.

---

### 13.1 Config

```bash
curl "https://api.1coin.meme/api/v1/charts/config"
```

**Response `200 OK`**

```json
{
  "supported_resolutions": ["1", "5", "15", "30", "60", "240", "D"],
  "supports_group_request": false,
  "supports_marks": false,
  "supports_search": true,
  "supports_timescale_marks": false
}
```

---

### 13.2 Symbols

```bash
curl "https://api.1coin.meme/api/v1/charts/symbols?symbol=0xabc...1111"
```

**Response `200 OK`**

```json
{
  "name":                   "0xabc...1111",
  "ticker":                 "0xabc...1111",
  "description":            "OneMEME Token (Tax)",
  "type":                   "crypto",
  "session":                "24x7",
  "timezone":               "Etc/UTC",
  "exchange":               "OneMEME",
  "pricescale":             1000000000,
  "minmov":                 1,
  "has_intraday":           true,
  "has_daily":              true,
  "supported_resolutions":  ["1", "5", "15", "30", "60", "240", "D"],
  "volume_precision":       4,
  "data_status":            "streaming"
}
```

---

### 13.3 History (OHLCV)

```bash
# 15-minute candles for the last 6 hours
curl "https://api.1coin.meme/api/v1/charts/history?symbol=0xabc...1111&resolution=15&countback=24&to=1741824000"

# Specific range
curl "https://api.1coin.meme/api/v1/charts/history?symbol=0xabc...1111&resolution=60&from=1741800000&to=1741824000"
```

**Query params:**

| Param | Description |
|---|---|
| `symbol` | Token address (required) |
| `resolution` | `1` `5` `15` `30` `60` `240` `D` |
| `from` | Unix timestamp start |
| `to` | Unix timestamp end |
| `countback` | Number of bars back from `to` (used by TradingView instead of `from`) |

**Response `200 OK`** — data present

```json
{
  "s": "ok",
  "t": [1741800000, 1741800900, 1741801800],
  "o": ["0.000000012345", "0.000000013100", "0.000000012800"],
  "h": ["0.000000014200", "0.000000013500", "0.000000013200"],
  "l": ["0.000000011900", "0.000000012600", "0.000000012100"],
  "c": ["0.000000013100", "0.000000012800", "0.000000013000"],
  "v": ["4500000000000000000", "3200000000000000000", "5100000000000000000"]
}
```

**Response** — no trades in range / migrated token

```json
{ "s": "no_data" }
```

---

### 13.4 Search

```bash
curl "https://api.1coin.meme/api/v1/charts/search?query=0xabc&limit=5"
```

**Response `200 OK`**

```json
[
  {
    "symbol":      "0xabc...1111",
    "full_name":   "0xabc...1111",
    "description": "OneMEME Token (Standard)",
    "exchange":    "OneMEME",
    "ticker":      "0xabc...1111",
    "type":        "crypto"
  }
]
```

---

## 14. Token Chat

Per-token chat with persistent history. Messages are stored in PostgreSQL (capped at 200 per token). Real-time delivery via WebSocket.

### 14.1 Fetch message history (REST)

Load the last 50 messages for a token on page load.

```bash
curl "https://api.1coin.meme/api/v1/chat/0xabc...1111/messages" \
  -H "Origin: https://1coin.meme"
```

**Response `200 OK`**

```json
{
  "data": [
    { "id": "1", "token": "0xabc...1111", "sender": "0xbuyer...", "text": "wen moon?",    "timestamp": 1741820000 },
    { "id": "2", "token": "0xabc...1111", "sender": "0xwhale...", "text": "ser this is it", "timestamp": 1741820003 }
  ]
}
```

Messages are returned oldest-first (chronological order, ready to render top-to-bottom).

---

### 14.2 Real-time chat (WebSocket)

```
wss://api.1coin.meme/api/v1/chat/ws
```

**Protocol:**

```
Client → server:
  { "type": "subscribe", "token": "0xabc...1111" }        — join token room, server replies with history
  { "type": "message", "sender": "0xwallet...", "text": "gm" }  — send a message

Server → client:
  { "type": "history",   "messages": [...] }               — sent immediately after subscribe
  { "type": "message",   "id": "3", "token": "0x...", "sender": "0x...", "text": "gm", "timestamp": 1741820010 }
  { "type": "error",     "message": "Slow down — wait 2s before sending again" }
  { "type": "keepalive" }                                  — every 15 s
```

**Browser integration (with auto-reconnect):**

```js
let ws;
let reconnectDelay = 1_000; // ms — doubles on each failure, caps at 30s
const TOKEN = "0xabc...1111";
const WALLET = "0xyourwallet...";

function connectChat(tokenAddress) {
  ws = new WebSocket("wss://api.1coin.meme/api/v1/chat/ws");

  ws.onopen = () => {
    reconnectDelay = 1_000; // reset on successful connect
    ws.send(JSON.stringify({ type: "subscribe", token: tokenAddress }));
  };

  ws.onmessage = (e) => {
    const frame = JSON.parse(e.data);
    if (frame.type === "history")   renderMessages(frame.messages); // initial load
    if (frame.type === "message")   appendMessage(frame);           // new real-time message
    if (frame.type === "keepalive") {}                              // heartbeat, ignore
    if (frame.type === "error")     console.warn("Chat:", frame.message);
  };

  ws.onclose = () => {
    // Auto-reconnect with exponential backoff
    setTimeout(() => connectChat(tokenAddress), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  };

  ws.onerror = () => ws.close(); // triggers onclose → reconnect
}

// Start
connectChat(TOKEN);

// Post a message
function sendMessage(text) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "message", sender: WALLET, text }));
  }
}
```

**Rules:**
- Rate limit: **1 message per 3 seconds** per IP — server sends `{ type: "error" }` if exceeded
- Max message length: **500 characters** — longer text is silently truncated on save
- Must subscribe before sending — server rejects messages without an active subscription
- History is capped at **200 messages per token** — oldest are pruned on insert
- Max **5 concurrent WebSocket connections per IP** — new connections beyond this are closed with code `1008`

---

## 15. Vesting

Creator token allocations — 5% of supply locked for 365 days, linear, no cliff. Indexed from the `VestingWallet` contract.

### 15.1 Token vesting schedule

```bash
curl https://api.1coin.meme/api/v1/vesting/0xTokenAddress1111 \
  -H "Origin: https://1coin.meme"
```

**Response `200 OK`**

```json
{
  "data": [
    {
      "token":       "0xtokenaddress...1111",
      "beneficiary": "0xcreatorwallet...abcd",
      "amount":      "50000000000000000000000000",
      "start":       1741824000,
      "claimed":     "5000000000000000000000000",
      "voided":      false,
      "burned":      "0",
      "claimable":   "2739726027397260273972",
      "vestingEnds": 1773360000,
      "progressPct": 18
    }
  ]
}
```

| Field | Description |
|---|---|
| `amount` | Total tokens locked at vesting start (wei) |
| `claimed` | Total tokens already claimed (wei) |
| `claimable` | Currently unlocked but unclaimed — computed server-side (wei) |
| `voided` | `true` if the schedule was cancelled by the owner |
| `burned` | Tokens burned to dead address on void (wei) |
| `vestingEnds` | Unix timestamp when all remaining tokens unlock |
| `progressPct` | 0–100% of the 365-day vesting period elapsed |

**`404`** — no vesting schedule for this token (creator opted out of allocation).

---

### 15.2 Creator vesting schedules

All vesting schedules across every token a creator has launched.

```bash
curl "https://api.1coin.meme/api/v1/creators/0xCreatorAddress/vesting?page=1&limit=20" \
  -H "Origin: https://1coin.meme"
```

**Response `200 OK`**

```json
{
  "data": [
    {
      "token":       "0xtokenaddress...1111",
      "beneficiary": "0xcreatorwallet...abcd",
      "amount":      "50000000000000000000000000",
      "start":       1741824000,
      "claimed":     "0",
      "voided":      false,
      "burned":      "0",
      "claimable":   "2739726027397260273972",
      "vestingEnds": 1773360000,
      "progressPct": 18,
      "tokenType":   "Standard",
      "totalSupply": "1000000000000000000000000000",
      "migrated":    false
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 3, "pages": 1, "hasMore": false }
}
```

**Frontend usage — show creator allocation progress:**

```js
const res  = await fetch(`https://api.1coin.meme/api/v1/vesting/${tokenAddress}`);
const { data } = await res.json();
const schedule = data[0];

if (schedule) {
  const totalPct    = 5;   // always 5% of supply
  const claimedPct  = (BigInt(schedule.claimed)   * 100n / BigInt(schedule.amount));
  const claimablePct= (BigInt(schedule.claimable) * 100n / BigInt(schedule.amount));

  console.log(`Creator vesting: ${schedule.progressPct}% unlocked`);
  console.log(`Claimed: ${claimedPct}% of allocation`);
  console.log(`Available to claim: ${claimablePct}% of allocation`);
  console.log(`Fully vested: ${new Date(schedule.vestingEnds * 1000).toLocaleDateString()}`);
}
```

---

## 16. Vanity Salt Mining

The backend mines a `bytes32` userSalt such that the CREATE2-predicted token address ends with `0x1111` (matching the factory's vanity addressing convention). Three worker threads are spawned in parallel — one per token type — so the salt is ready for whichever type the user picks at launch time. The event loop is never blocked.

### How it works

```
CREATE2 address = keccak256(0xff ++ factory ++ keccak256(abi.encode(creator, userSalt)) ++ initCodeHash)[12:]
```

Each token type (`Standard`, `Tax`, `Reflection`) has a different impl address → different `initCodeHash` → independent salt. All three are mined simultaneously.

Expected attempts per type: ~65 536 on average. Typical wall-clock time: < 5 seconds per type on a modern server.

---

### 16.1 Get session result

Returns whatever has been mined so far in the current session. May be partial (some types still running) or complete (all three found). Returns `404` if no session has been started yet.

```bash
curl 'https://api.1coin.meme/api/v1/salt/0xAbCd...1234'
```

**Response `200 OK` (complete — all three types found)**

```json
{
  "data": {
    "address": "0xAbCd...1234",
    "standard": {
      "salt": "0xdeadbeef000000000000000000000000000000000000000000000042000001",
      "predictedAddress": "0xF3a8C9e21b4D7f6A3E0B5C8D9F2A1B4C7E0D3F1111",
      "attempts": 71024
    },
    "tax": {
      "salt": "0xabcdef000000000000000000000000000000000000000000000000cafe0001",
      "predictedAddress": "0x7B2E4A9C1F6D8E3B0C5A2F7D4E1B8C3A6F9D2E1111",
      "attempts": 43210
    },
    "reflection": {
      "salt": "0x1234560000000000000000000000000000000000000000000000000beef0001",
      "predictedAddress": "0x9D1F3C7A4B8E2F6C0A5D3E8B1F4C7A2E9B6D3F1111",
      "attempts": 88901
    }
  }
}
```

**Response `404` (no session started)**

```json
{
  "statusCode": 404,
  "message": "No salt session for this address. Open GET /api/v1/salt/:address/stream to start mining."
}
```

---

### 16.2 Stream (start fresh mine)

SSE endpoint. Every connection clears any previous result and starts a **fresh mine** across all three token types in parallel. Worker threads are terminated immediately when the client disconnects. Stream completes once all three types are found.

```bash
curl -N 'https://api.1coin.meme/api/v1/salt/0xAbCd...1234/stream'
```

**Stream output:**

```
data: {"type":"progress","tokenType":"Standard","attempts":50000}

data: {"type":"progress","tokenType":"Tax","attempts":50000}

data: {"type":"found","tokenType":"Tax","attempts":43210,"salt":"0xabcdef...","predictedAddress":"0x7B2E...1111"}

data: {"type":"progress","tokenType":"Standard","attempts":100000}

data: {"type":"found","tokenType":"Reflection","attempts":88901,"salt":"0x123456...","predictedAddress":"0x9D1F...1111"}

data: {"type":"found","tokenType":"Standard","attempts":71024,"salt":"0xdeadbeef...","predictedAddress":"0xF3a8...1111"}
```

Stream closes after the third `found` event.

---

### 16.3 Frontend integration

```typescript
// Salts keyed by token type — populated as each type is mined.
const minedSalts: Record<string, { salt: string; predictedAddress: string }> = {};

// On wallet connect — open the stream, mine all 3 types in the background.
function startSaltMining(walletAddress: string) {
  const url = `https://api.1coin.meme/api/v1/salt/${walletAddress}/stream`;
  const evtSource = new EventSource(url);

  evtSource.onmessage = (e) => {
    const event = JSON.parse(e.data);

    if (event.type === "progress") {
      console.log(`[${event.tokenType}] Mining... ${event.attempts.toLocaleString()} attempts`);
    }

    if (event.type === "found") {
      console.log(`[${event.tokenType}] Salt ready:`, event.salt);
      minedSalts[event.tokenType] = {
        salt:             event.salt,
        predictedAddress: event.predictedAddress,
      };
    }
  };

  evtSource.onerror = () => evtSource.close();
}

// On token launch — use the salt for the chosen token type.
function getSaltForLaunch(tokenType: "Standard" | "Tax" | "Reflection") {
  const result = minedSalts[tokenType];
  if (!result) throw new Error(`Salt for ${tokenType} not yet mined`);
  return result.salt; // bytes32 hex — pass to LaunchpadFactory.createToken()
}

// Alternatively — fetch from backend if local state was lost (e.g. page refresh).
async function fetchSaltFromBackend(walletAddress: string, tokenType: string) {
  const res = await fetch(`https://api.1coin.meme/api/v1/salt/${walletAddress}`);
  if (!res.ok) throw new Error("Salt session not available — open stream to start mining");
  const { data } = await res.json();
  return data[tokenType.toLowerCase()]; // { salt, predictedAddress, attempts }
}
```

---

## 17. Rate Limit Response


When a rate limit is exceeded the API returns **`429 Too Many Requests`**:

```json
{
  "error":      "Too Many Requests",
  "message":    "Rate limit of 20 req/min exceeded for your IP. Retry in 42s.",
  "retryAfter": 42,
  "ip":         "203.0.113.10"
}
```

**Headers on every response:**

```
X-RateLimit-Limit:      20
X-RateLimit-Remaining:  0
X-RateLimit-Reset:      1741824060
Retry-After:            42          ← only on 429
```

**Rate limit tiers:**

| Route group | Limit | Notes |
|---|---|---|
| `/tokens/*/quote/*` | **20 req/min** | Each request makes a live RPC call to BSC |
| `/stats` | **10 req/min** | 6 parallel aggregation queries |
| Everything else | **60 req/min** | Paginated DB queries |

Limits are keyed by **client IP only** (not IP+path). Rotating token addresses does not bypass the quote limit.

---

## 18. Origin Restriction (403)

Origin enforcement is handled by **Cloudflare WAF** (see [CLOUDFLARE.md](CLOUDFLARE.md) Step 5.1). Requests whose `Origin` header is not in the configured allowlist are blocked at the edge with a `403` before they reach the API.

`GET /health` is exempt so BetterStack uptime monitoring works without an Origin header.

**To update allowed origins**, edit the Cloudflare WAF rule — no code or env changes needed:

```
WAF → Custom Rules → "Enforce allowed origins"
→ update the origin values in the expression
```

In local development the app allows all origins — Cloudflare is not in the path.

---

## 19. Error Shapes

All errors follow the NestJS standard exception shape:

| Status | `error` | Common cause |
|---|---|---|
| `400` | `Bad Request` | Invalid address, missing required param, out-of-range value |
| `403` | `Forbidden` | Origin blocked by Cloudflare WAF |
| `404` | `Not Found` | Token / migration record does not exist |
| `429` | `Too Many Requests` | Rate limit exceeded |
| `500` | `Internal Server Error` | Unexpected DB or runtime error |
| `503` | `Service Unavailable` | `BSC_RPC_URL` or `BONDING_CURVE_ADDRESS` not configured (quote endpoints) |

```json
{
  "statusCode": 404,
  "error":      "Not Found",
  "message":    "Token 0xabc...1111 not found"
}
```
