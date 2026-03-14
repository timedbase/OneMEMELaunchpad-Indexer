# OneMEME Launchpad API — Examples

Complete reference of every endpoint with `curl` commands and expected JSON responses.

> **Base URL:** `https://localhost:3001` (HTTP if TLS is not configured — see [HTTPS Setup](#https--wss-setup))
> **All BNB / token amounts** are returned as strings (wei, 18 decimals) to preserve uint256 precision.
> **Pagination** is available on all list endpoints via `?page=` and `?limit=` (max 100).
> **Origin-restricted endpoints** (`/stats`, `/activity/*`, `/discover/*`) require the request `Origin` header to match `ALLOWED_ORIGINS`. In development, `localhost` origins are always permitted.

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
7. [TWAP Oracle](#7-twap-oracle)
   - [Latest TWAP](#71-latest-twap)
   - [TWAP history](#72-twap-history)
8. [Factory Events](#8-factory-events)
9. [Creators](#9-creators)
10. [Activity Feed](#10-activity-feed)
    - [Paginated feed](#101-paginated-feed)
    - [Real-time SSE stream](#102-real-time-sse-stream)
    - [Real-time WebSocket (WSS)](#103-real-time-websocket-wss)
11. [Discovery](#11-discovery)
    - [Trending](#111-trending)
    - [New tokens](#112-new-tokens)
    - [Bonding](#113-bonding)
    - [Migrated](#114-migrated)
12. [Leaderboard](#12-leaderboard)
    - [Traders by volume](#121-traders-by-volume)
13. [Metadata Upload (IPFS)](#13-metadata-upload-ipfs)
    - [Full flow](#131-full-flow)
    - [Upload](#132-upload)
    - [Frontend integration](#133-frontend-integration)
14. [HTTPS / WSS Setup](#14-https--wss-setup)
15. [Rate Limit Response](#15-rate-limit-response)
16. [Origin Restriction (403)](#16-origin-restriction-403)
17. [Error Shapes](#17-error-shapes)

---

## 1. Health Check

Verify the API server is running. No rate limit, no origin restriction.

```bash
curl https://localhost:3001/health
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

Aggregated platform-wide statistics. Restricted to `ALLOWED_ORIGINS` (UI only). Rate limit: **10 req/min**.

```bash
curl https://localhost:3001/api/v1/stats \
  -H "Origin: https://app.onememe.io"
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
      "tokenType": "Tax",
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
curl "https://localhost:3001/api/v1/tokens?limit=5"

# Tax tokens not yet migrated, sorted by volume
curl "https://localhost:3001/api/v1/tokens?type=Tax&migrated=false&orderBy=volumeBNB&limit=10"
```

**Query params:**

| Param | Values | Default |
|---|---|---|
| `type` | `Standard` \| `Tax` \| `Reflection` | all |
| `migrated` | `true` \| `false` | all |
| `orderBy` | `createdAtBlock` \| `volumeBNB` \| `buyCount` \| `sellCount` \| `raisedBNB` \| `totalSupply` | `createdAtBlock` |
| `orderDir` | `asc` \| `desc` | `desc` |
| `page`, `limit` | int | 1, 20 |

**Response `200 OK`**

```json
{
  "data": [
    {
      "id":               "0xabc...1111",
      "tokenType":        "Tax",
      "creator":          "0xdeadbeef...",
      "totalSupply":      "1000000000000000000000000000",
      "antibotEnabled":   true,
      "tradingBlock":     "42000100",
      "createdAtBlock":   "42000000",
      "createdAtTimestamp": 1741820000,
      "migrated":         false,
      "pairAddress":      null,
      "buyCount":         142,
      "sellCount":        41,
      "volumeBNB":        "820000000000000000000",
      "raisedBNB":        "610000000000000000000"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 1042, "pages": 209, "hasMore": true }
}
```

---

### 3.2 Single token + metadata

Off-chain metadata (name, image, description, website, socials) is resolved from the token's `metaURI` and merged into the response.

```bash
curl "https://localhost:3001/api/v1/tokens/0xabc...1111"
```

**Response `200 OK`**

```json
{
  "data": {
    "id":               "0xabc...1111",
    "tokenType":        "Tax",
    "creator":          "0xdeadbeef...",
    "totalSupply":      "1000000000000000000000000000",
    "antibotEnabled":   true,
    "tradingBlock":     "42000100",
    "createdAtBlock":   "42000000",
    "createdAtTimestamp": 1741820000,
    "migrated":         false,
    "pairAddress":      null,
    "buyCount":         142,
    "sellCount":        41,
    "volumeBNB":        "820000000000000000000",
    "raisedBNB":        "610000000000000000000",
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
curl "https://localhost:3001/api/v1/tokens/0xabc...1111/trades?type=buy&limit=10"
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
curl "https://localhost:3001/api/v1/tokens/0xabc...1111/traders?limit=10&orderBy=totalVolumeBNB"
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
curl "https://localhost:3001/api/v1/tokens/0xabc...1111/holders?limit=20"
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
curl "https://localhost:3001/api/v1/tokens/0xabc...1111/migration"
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

All quote endpoints call the live `LaunchpadFactory` contract via `BSC_RPC_URL`. Rate limit: **20 req/min**.

### 4.1 Spot price

```bash
curl "https://localhost:3001/api/v1/tokens/0xabc...1111/quote/price"
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
curl "https://localhost:3001/api/v1/tokens/0xabc...1111/quote/buy?bnbIn=1000000000000000000&slippage=100"
```

**Query params:**

| Param | Required | Description |
|---|---|---|
| `bnbIn` | Yes | BNB input in wei (e.g. `1000000000000000000` = 1 BNB) |
| `slippage` | No | Tolerance in basis points (default `100` = 1%, max `5000`) |

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
curl "https://localhost:3001/api/v1/tokens/0xabc...1111/quote/sell?tokensIn=10000000000000000000000&slippage=200"
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
curl "https://localhost:3001/api/v1/trades?limit=20"

# Buys only for a specific token
curl "https://localhost:3001/api/v1/trades?token=0xabc...1111&type=buy"

# Trades in a time window
curl "https://localhost:3001/api/v1/trades?from=1741800000&to=1741824000"
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
curl "https://localhost:3001/api/v1/traders/0xwhale.../trades?type=buy&limit=10"
```

**Query params:** `type`, `from`, `to`, `page`, `limit`

---

## 6. Migrations

```bash
curl "https://localhost:3001/api/v1/migrations?orderBy=liquidityBNB&limit=10"
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

## 7. TWAP Oracle

### 7.1 Latest TWAP

```bash
curl "https://localhost:3001/api/v1/twap/latest"
```

**Response `200 OK`**

```json
{
  "data": {
    "id":               "0xtxhash...-0",
    "priceAvg":         "310000000000000000",
    "priceBlockNumber": "42000000",
    "blockNumber":      "42001000",
    "timestamp":        1741823900
  }
}
```

---

### 7.2 TWAP history

```bash
curl "https://localhost:3001/api/v1/twap?limit=5"
```

**Query params:** `from`, `to`, `page`, `limit`

---

## 8. Factory Events

Admin and configuration-change events emitted by the `LaunchpadFactory`.

```bash
# All factory events
curl "https://localhost:3001/api/v1/factory/events"

# Fee withdrawals only
curl "https://localhost:3001/api/v1/factory/events?type=FeesWithdrawn"
```

**Query params:**

| Param | Values |
|---|---|
| `type` | `DefaultParamsUpdated` \| `FeesWithdrawn` \| `RouterUpdated` \| `FeeRecipientUpdated` \| `TradeFeeUpdated` \| `UsdcPairUpdated` \| `TwapMaxAgeBlocksUpdated` |
| `from`, `to` | Unix timestamp bounds |
| `page`, `limit` | Pagination |

**Response `200 OK`**

```json
{
  "data": [
    {
      "id":        "FeesWithdrawn-0xtxhash...-0",
      "eventType": "FeesWithdrawn",
      "recipient": "0xfeerecipient...",
      "amount":    "50000000000000000000",
      "blockNumber": "42003000",
      "txHash":    "0xtxhash...",
      "timestamp": 1741840000
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 7, "pages": 1, "hasMore": false }
}
```

---

## 9. Creators

Tokens deployed by a specific creator wallet.

```bash
curl "https://localhost:3001/api/v1/creators/0xcreator.../tokens?limit=10"
```

**Response** — same paginated token shape as [3.1 List tokens](#31-list-tokens).

---

## 10. Activity Feed

Unified stream of create/buy/sell events across all tokens. Restricted to `ALLOWED_ORIGINS`.

### 10.1 Paginated feed

```bash
curl "https://localhost:3001/api/v1/activity" \
  -H "Origin: https://app.onememe.io"

# Filter by event type
curl "https://localhost:3001/api/v1/activity?type=buy&limit=10" \
  -H "Origin: https://app.onememe.io"

# Filter by token
curl "https://localhost:3001/api/v1/activity?token=0xabc...1111" \
  -H "Origin: https://app.onememe.io"
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
      "txHash":      null
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 86705, "pages": 4336, "hasMore": true }
}
```

---

### 10.2 Real-time SSE stream

Pushes new events as they are indexed (2 s DB poll, 15 s keepalive). Long-lived connection — no rate limit.

```bash
# curl (streams to terminal)
curl -N "https://localhost:3001/api/v1/activity/stream" \
  -H "Origin: https://app.onememe.io"

# Filter buys for a specific token
curl -N "https://localhost:3001/api/v1/activity/stream?type=buy&token=0xabc...1111" \
  -H "Origin: https://app.onememe.io"
```

**Browser (EventSource):**

```js
const es = new EventSource("https://api.onememe.io/api/v1/activity/stream?type=buy");
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

### 10.3 Real-time WebSocket (WSS)

Same data as SSE but over a persistent WebSocket connection. Automatically WSS when the server has TLS configured.

```
ws://localhost:3001/api/v1/activity/ws       (HTTP mode)
wss://api.onememe.io/api/v1/activity/ws      (HTTPS/TLS mode)
```

**Optional query params on connect:**

| Param | Example | Description |
|---|---|---|
| `type` | `?type=buy` | Filter by event type (`create` \| `buy` \| `sell`) |
| `token` | `?token=0xabc...1111` | Filter by token address |

**Browser:**

```js
const ws = new WebSocket("wss://api.onememe.io/api/v1/activity/ws?type=buy");

ws.onopen    = ()  => console.log("Connected");
ws.onmessage = (e) => {
  const { event, data } = JSON.parse(e.data);
  if (event === "activity")  console.log("New event:", data);
  if (event === "keepalive") {} // heartbeat, ignore
};
ws.onclose   = ()  => console.log("Disconnected");
```

**Message format:**

```json
{ "event": "activity", "data": { "eventType": "buy", "token": "0xabc...1111", "actor": "0xbuyer...", "bnbAmount": "500000000000000000", "tokenAmount": "6172839000000000000000", "blockNumber": "42001234", "timestamp": 1741823000, "txHash": "0xtxhash..." } }

{ "event": "keepalive", "data": "" }

{ "event": "error", "data": "Invalid type: foo" }
```

---

## 11. Discovery

All discovery endpoints are restricted to `ALLOWED_ORIGINS` and return paginated token lists. Rate limit: **60 req/min**.

### 11.1 Trending

Tokens ranked by trade count in the last 30 minutes (configurable).

```bash
curl "https://localhost:3001/api/v1/discover/trending" \
  -H "Origin: https://app.onememe.io"

# Custom window — last 5 minutes
curl "https://localhost:3001/api/v1/discover/trending?window=300" \
  -H "Origin: https://app.onememe.io"
```

**Query params:** `window` (seconds, default `1800`, max `86400`), `page`, `limit`

**Response `200 OK`**

```json
{
  "data": [
    {
      "id":               "0xabc...1111",
      "tokenType":        "Tax",
      "buyCount":         142,
      "sellCount":        41,
      "volumeBNB":        "820000000000000000000",
      "raisedBNB":        "610000000000000000000",
      "migrated":         false,
      "recentTrades":     23,
      "recentBuys":       18,
      "recentSells":      5,
      "recentVolumeBNB":  "9200000000000000000"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 47, "pages": 3, "hasMore": true },
  "window": 1800,
  "since":  1741822200
}
```

---

### 11.2 New tokens

Freshly launched, non-migrated tokens newest first.

```bash
curl "https://localhost:3001/api/v1/discover/new" \
  -H "Origin: https://app.onememe.io"

# Filter to Tax tokens only
curl "https://localhost:3001/api/v1/discover/new?type=Tax" \
  -H "Origin: https://app.onememe.io"
```

**Query params:** `type` (`Standard`|`Tax`|`Reflection`), `page`, `limit`

---

### 11.3 Bonding

Active bonding-curve tokens sorted by `raisedBNB` descending — closest to migrating first.

```bash
curl "https://localhost:3001/api/v1/discover/bonding" \
  -H "Origin: https://app.onememe.io"
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

### 11.4 Migrated

Tokens graduated to PancakeSwap V2, joined with migration data.

```bash
curl "https://localhost:3001/api/v1/discover/migrated?orderBy=liquidityBNB&limit=10" \
  -H "Origin: https://app.onememe.io"
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

## 12. Leaderboard

Traders ranked by total BNB trading volume (buys + sells). No origin restriction.

### 12.1 Traders by volume

```bash
# All-time leaderboard (default)
curl "https://localhost:3001/api/v1/leaderboard/traders"

# Last 24 hours
curl "https://localhost:3001/api/v1/leaderboard/traders?period=1d"

# Last 7 days
curl "https://localhost:3001/api/v1/leaderboard/traders?period=7d"

# Last 30 days
curl "https://localhost:3001/api/v1/leaderboard/traders?period=30d"
```

**Query params:**

| Param | Values | Default |
|---|---|---|
| `period` | `alltime` \| `1d` \| `7d` \| `30d` | `alltime` |
| `page`, `limit` | int | 1, 50 |

**Response `200 OK`**

```json
{
  "period": "7d",
  "data": [
    {
      "address":       "0xwhale...",
      "volumeBNB":     "42000000000000000000",
      "tradeCount":    38,
      "buyCount":      22,
      "sellCount":     16,
      "tokensTraded":  5,
      "lastTradeAt":   1741900000
    },
    {
      "address":       "0xtrader2...",
      "volumeBNB":     "17500000000000000000",
      "tradeCount":    14,
      "buyCount":      10,
      "sellCount":     4,
      "tokensTraded":  2,
      "lastTradeAt":   1741895000
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 214, "pages": 5, "hasMore": true }
}
```

> `volumeBNB` is the sum of all BNB across buys and sells in the selected period, in wei.

---

## 13. Metadata Upload (IPFS)

Upload token metadata to IPFS via Pinata. Returns an IPFS URI the token creator passes directly to `setMetaURI()` on their token contract.

**Requires** `PINATA_JWT` in `.env`.

### 13.1 Full flow

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

### 13.2 Upload

```bash
curl -X POST https://localhost:3001/api/v1/metadata/upload \
  -F "image=@./pepe.png;type=image/png" \
  -F "name=PepeBSC" \
  -F "symbol=PEPE" \
  -F "description=The original Pepe on BSC launchpad." \
  -F "website=https://pepebsc.io" \
  -F "x=https://x.com/pepebsc" \
  -F "telegram=https://t.me/pepebsc"
```

**Response `201 Created`**

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

### 13.3 Frontend integration

```js
// React / Next.js example
async function uploadMetadata({ name, symbol, description, website, x, telegram, imageFile }) {
  const form = new FormData();
  form.append("image",       imageFile);          // File from <input type="file"> — required
  form.append("name",        name);
  form.append("symbol",      symbol      ?? "");
  form.append("description", description ?? "");
  form.append("website",     website     ?? "");
  form.append("x",           x           ?? "");
  form.append("telegram",    telegram    ?? "");
  // Do NOT set Content-Type — browser sets it with boundary automatically.

  const res = await fetch("https://api.onememe.io/api/v1/metadata/upload", {
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

## 14. HTTPS / WSS Setup

The API detects TLS at startup based on two environment variables:

```dotenv
SSL_KEY_PATH=./certs/privkey.pem
SSL_CERT_PATH=./certs/fullchain.pem
```

When both are set the server starts in HTTPS mode and WebSocket connections automatically use WSS. No code changes are required — the `WsAdapter` inherits the TLS context from the Express HTTPS server.

**Generate a self-signed cert for local testing:**

```bash
openssl req -x509 -newkey rsa:4096 \
  -keyout certs/privkey.pem \
  -out certs/fullchain.pem \
  -days 365 -nodes \
  -subj "/CN=localhost"
```

**Test HTTPS locally** (ignore self-signed warning):

```bash
curl -k https://localhost:3001/health
```

**Production** — use Let's Encrypt or your provider's certificate files; point the env vars at them and restart.

---

## 15. Rate Limit Response

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

## 16. Origin Restriction (403)

Endpoints restricted to the launchpad UI return `403 Forbidden` when the `Origin` header is not in `ALLOWED_ORIGINS`:

**Restricted endpoints:** `GET /stats`, `GET /activity/*`, `GET /discover/*`

```bash
# No Origin header
curl https://localhost:3001/api/v1/stats
```

```json
{
  "message":    "This endpoint is restricted to the OneMEME Launchpad UI.",
  "error":      "Forbidden",
  "statusCode": 403
}
```

```bash
# Disallowed origin
curl https://localhost:3001/api/v1/stats -H "Origin: https://other.io"
```

```json
{
  "message":    "Origin not permitted: https://other.io",
  "error":      "Forbidden",
  "statusCode": 403
}
```

**To permit an origin**, add it to `.env`:

```dotenv
ALLOWED_ORIGINS=https://app.onememe.io,https://onememe.io
```

In development (`NODE_ENV=development`), all `http://localhost:*` and `http://127.0.0.1:*` origins are automatically permitted.

---

## 17. Error Shapes

All errors follow the NestJS standard exception shape:

| Status | `error` | Common cause |
|---|---|---|
| `400` | `Bad Request` | Invalid address, missing required param, out-of-range value |
| `403` | `Forbidden` | Origin not in `ALLOWED_ORIGINS` |
| `404` | `Not Found` | Token / migration record does not exist |
| `429` | `Too Many Requests` | Rate limit exceeded |
| `500` | `Internal Server Error` | Unexpected DB or runtime error |
| `503` | `Service Unavailable` | `BSC_RPC_URL` or `FACTORY_ADDRESS` not configured (quote endpoints) |

```json
{
  "statusCode": 404,
  "error":      "Not Found",
  "message":    "Token 0xabc...1111 not found"
}
```
