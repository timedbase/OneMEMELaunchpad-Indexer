# OneMEME Launchpad API — Examples

Complete reference of every endpoint with `curl` commands and expected JSON responses.

> **Base URL:** `http://localhost:3001`
> **All BNB / token amounts** are returned as strings (wei, 18 decimals) to preserve uint256 precision.
> **Pagination** is available on all list endpoints via `?page=` and `?limit=` (max 100).

---

## Table of Contents

1. [Health Check](#1-health-check)
2. [Route Index](#2-route-index)
3. [Platform Stats](#3-platform-stats)
4. [Tokens](#4-tokens)
   - [List tokens](#41-list-tokens)
   - [Single token](#42-single-token)
   - [Token trades](#43-token-trades)
   - [Top traders leaderboard](#44-top-traders-leaderboard)
   - [Migration record](#45-migration-record)
5. [Quote Simulation (Live RPC)](#5-quote-simulation-live-rpc)
   - [Spot price](#51-spot-price)
   - [Buy quote](#52-buy-quote)
   - [Sell quote](#53-sell-quote)
6. [Trades](#6-trades)
   - [All trades](#61-all-trades)
   - [Trades by wallet](#62-trades-by-wallet)
7. [Migrations](#7-migrations)
8. [TWAP Oracle](#8-twap-oracle)
   - [Latest TWAP](#81-latest-twap)
   - [TWAP history](#82-twap-history)
9. [Factory Events](#9-factory-events)
10. [Creators](#10-creators)
11. [Rate Limit Response](#11-rate-limit-response)

---

## 1. Health Check

Verify the API server is running. No rate limit applied.

```bash
curl http://localhost:3001/health
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

## 2. Route Index

Returns every available endpoint and current rate-limit policy. No rate limit applied.

```bash
curl http://localhost:3001/api/v1
```

**Response `200 OK`**

```json
{
  "version": "1.0.0",
  "description": "OneMEME Launchpad REST API",
  "rateLimits": {
    "quotes":  "20 req/min per IP  (triggers live RPC calls to BSC)",
    "stats":   "10 req/min per IP  (heavy aggregation query)",
    "detail":  "120 req/min per IP (lightweight DB lookup)",
    "default": "60 req/min per IP  (paginated list endpoints)"
  },
  "endpoints": {
    "GET /api/v1":                             "This route index",
    "GET /health":                             "Health check",
    "GET /api/v1/tokens":                      "List all tokens",
    "GET /api/v1/tokens/:address":             "Token detail",
    "GET /api/v1/tokens/:address/trades":      "Bonding-curve trades for a token",
    "GET /api/v1/tokens/:address/traders":     "Top traders leaderboard for a token",
    "GET /api/v1/tokens/:address/migration":   "PancakeSwap migration record",
    "GET /api/v1/tokens/:address/quote/price": "Live spot price from contract",
    "GET /api/v1/tokens/:address/quote/buy":   "Simulate buy — BNB → tokens (live RPC)",
    "GET /api/v1/tokens/:address/quote/sell":  "Simulate sell — tokens → BNB (live RPC)",
    "GET /api/v1/trades":                      "All bonding-curve trades",
    "GET /api/v1/migrations":                  "All PancakeSwap migrations",
    "GET /api/v1/twap":                        "TWAP oracle history",
    "GET /api/v1/twap/latest":                 "Most recent TWAP reading",
    "GET /api/v1/factory/events":              "Factory admin/config events",
    "GET /api/v1/stats":                       "Platform-wide aggregated stats",
    "GET /api/v1/creators/:address/tokens":    "Tokens deployed by a creator",
    "GET /api/v1/traders/:address/trades":     "Trades by a wallet"
  }
}
```

---

## 3. Platform Stats

Aggregated platform-wide statistics. **Rate limit: 10 req/min per IP.**

```bash
curl http://localhost:3001/api/v1/stats
```

**Response `200 OK`**

```json
{
  "data": {
    "totalTokens": 128,
    "migratedTokens": 34,
    "activeTokens": 94,
    "tokensByType": {
      "Standard": 60,
      "Tax": 45,
      "Reflection": 23
    },
    "totalTrades": 14502,
    "totalBuys": 9871,
    "totalSells": 4631,
    "uniqueTraders": 3204,
    "totalVolumeBNB": "18340000000000000000000",
    "totalLiquidityBNB": "5120000000000000000000",
    "latestTwap": {
      "priceAvg": "312500000000000000000000000",
      "priceBlockNumber": "42000000",
      "blockNumber": "42000001",
      "timestamp": 1741824000
    },
    "topTokenByVolume": {
      "id": "0xd3ad...1111",
      "tokenType": "Tax",
      "creator": "0xabcd...ef01",
      "volumeBNB": "4200000000000000000000",
      "buyCount": 382,
      "sellCount": 91,
      "migrated": true
    }
  }
}
```

---

## 4. Tokens

### 4.1 List tokens

**Rate limit: 60 req/min per IP.**

#### All tokens, newest first (default)

```bash
curl "http://localhost:3001/api/v1/tokens"
```

#### Filter by type, not yet migrated, sorted by bonding-curve volume

```bash
curl "http://localhost:3001/api/v1/tokens?type=Tax&migrated=false&orderBy=volumeBNB&orderDir=desc&limit=10"
```

**Supported `orderBy` values:** `createdAtBlock` `volumeBNB` `raisedBNB` `buyCount` `sellCount` `totalSupply`

**Response `200 OK`**

```json
{
  "data": [
    {
      "id": "0xd3ad...1111",
      "tokenType": "Tax",
      "creator": "0xabcd...ef01",
      "totalSupply": "1000000000000000000000000000",
      "antibotEnabled": true,
      "tradingBlock": "42000100",
      "createdAtBlock": "42000050",
      "createdAtTimestamp": 1741820000,
      "migrated": false,
      "pairAddress": null,
      "buyCount": 84,
      "sellCount": 12,
      "volumeBNB": "3200000000000000000000",
      "raisedBNB": "2800000000000000000000"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 94,
    "pages": 10,
    "hasMore": true
  }
}
```

---

### 4.2 Single token

**Rate limit: 120 req/min per IP.**

```bash
curl "http://localhost:3001/api/v1/tokens/0xd3ad...1111"
```

**Response `200 OK`**

```json
{
  "data": {
    "id": "0xd3adbeef00000000000000000000000000001111",
    "tokenType": "Tax",
    "creator": "0xabcdef0000000000000000000000000000000001",
    "totalSupply": "1000000000000000000000000000",
    "antibotEnabled": true,
    "tradingBlock": "42000100",
    "createdAtBlock": "42000050",
    "createdAtTimestamp": 1741820000,
    "migrated": false,
    "pairAddress": null,
    "buyCount": 84,
    "sellCount": 12,
    "volumeBNB": "3200000000000000000000",
    "raisedBNB": "2800000000000000000000"
  }
}
```

**Response `404 Not Found`**

```json
{
  "error": "Not Found",
  "message": "Token 0xinvalid not found"
}
```

---

### 4.3 Token trades

**Rate limit: 60 req/min per IP.**

#### All trades for a token, most recent first

```bash
curl "http://localhost:3001/api/v1/tokens/0xd3ad...1111/trades"
```

#### Buys only, within a time window

```bash
curl "http://localhost:3001/api/v1/tokens/0xd3ad...1111/trades?type=buy&from=1741800000&to=1741824000&limit=25"
```

**Supported `orderBy` values:** `timestamp` `bnbAmount` `tokenAmount` `blockNumber`

**Response `200 OK`**

```json
{
  "data": [
    {
      "id": "0xabc123...def456-3",
      "token": "0xd3adbeef00000000000000000000000000001111",
      "tradeType": "buy",
      "trader": "0x1234000000000000000000000000000000005678",
      "bnbAmount": "500000000000000000",
      "tokenAmount": "6250000000000000000000",
      "tokensToDead": "312500000000000000000",
      "raisedBNB": "2800000000000000000000",
      "blockNumber": "42001200",
      "txHash": "0xabc123...def456",
      "timestamp": 1741823900
    },
    {
      "id": "0xfed987...cba321-1",
      "token": "0xd3adbeef00000000000000000000000000001111",
      "tradeType": "sell",
      "trader": "0x9999000000000000000000000000000000001111",
      "bnbAmount": "120000000000000000",
      "tokenAmount": "1500000000000000000000",
      "tokensToDead": null,
      "raisedBNB": "2680000000000000000000",
      "blockNumber": "42001100",
      "txHash": "0xfed987...cba321",
      "timestamp": 1741823800
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 96,
    "pages": 4,
    "hasMore": true
  }
}
```

> **Note:** `tokensToDead` is `null` for sell trades. For buy trades it is the amount of tokens burned as antibot penalty (non-zero only during the antibot window).

---

### 4.4 Top traders leaderboard

**Rate limit: 60 req/min per IP.**

#### Top 10 traders by total BNB volume

```bash
curl "http://localhost:3001/api/v1/tokens/0xd3ad...1111/traders?limit=10&orderBy=totalVolumeBNB"
```

**Supported `orderBy` values:** `totalVolumeBNB` `totalTrades` `buyCount` `sellCount` `netBNB`

**Response `200 OK`**

```json
{
  "data": [
    {
      "trader": "0xdeadbeef00000000000000000000000000001234",
      "buyCount": 14,
      "sellCount": 3,
      "totalTrades": 17,
      "totalBNBIn": "5200000000000000000",
      "totalBNBOut": "1800000000000000000",
      "totalVolumeBNB": "7000000000000000000",
      "netBNB": "-3400000000000000000"
    },
    {
      "trader": "0xcafe000000000000000000000000000000009876",
      "buyCount": 6,
      "sellCount": 6,
      "totalTrades": 12,
      "totalBNBIn": "2400000000000000000",
      "totalBNBOut": "2600000000000000000",
      "totalVolumeBNB": "5000000000000000000",
      "netBNB": "200000000000000000"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 61,
    "pages": 7,
    "hasMore": true
  }
}
```

> **`netBNB`**: `totalBNBOut - totalBNBIn`. Positive = net BNB profit from selling; negative = net BNB spent (still holding tokens).

---

### 4.5 Migration record

**Rate limit: 120 req/min per IP.**

```bash
curl "http://localhost:3001/api/v1/tokens/0xd3ad...1111/migration"
```

**Response `200 OK` (migrated token)**

```json
{
  "data": {
    "id": "0xd3adbeef00000000000000000000000000001111",
    "token": "0xd3adbeef00000000000000000000000000001111",
    "pair": "0xpancake000000000000000000000000000pair01",
    "liquidityBNB": "4200000000000000000000",
    "liquidityTokens": "380000000000000000000000000",
    "blockNumber": "42005000",
    "txHash": "0xmigrate...hash",
    "timestamp": 1741850000
  }
}
```

**Response `404 Not Found` (not yet migrated)**

```json
{
  "error": "Not Found",
  "message": "Token 0xd3ad...1111 has not migrated yet"
}
```

---

## 5. Quote Simulation (Live RPC)

> These endpoints call the `LaunchpadFactory` contract directly on BSC via RPC.
> Quotes reflect live on-chain state including current trade fee and any active antibot penalty.
> **Rate limit: 20 req/min per IP** (shared across `/quote/price`, `/quote/buy`, `/quote/sell`).
> Returns `503` if `BSC_RPC_URL` or `FACTORY_ADDRESS` are not configured.
> Returns a redirect message (not an error) if the token has already migrated.

---

### 5.1 Spot price

```bash
curl "http://localhost:3001/api/v1/tokens/0xd3ad...1111/quote/price"
```

**Response `200 OK` (bonding curve active)**

```json
{
  "data": {
    "token": "0xd3adbeef00000000000000000000000000001111",
    "migrated": false,
    "spotPriceWei": "80000000000000",
    "spotPriceBNB": "0.00008",
    "tokensPerBNB": "12500.0",
    "antibotEnabled": true,
    "tradingBlock": "42000100"
  }
}
```

**Response `200 OK` (token migrated — use DEX instead)**

```json
{
  "data": {
    "token": "0xd3adbeef00000000000000000000000000001111",
    "migrated": true,
    "message": "Token has migrated to PancakeSwap. Fetch price from the DEX pair instead.",
    "pair": null
  }
}
```

---

### 5.2 Buy quote

Simulate purchasing tokens with a given amount of BNB.

**Parameters:**

| Param | Required | Description |
|---|---|---|
| `bnbIn` | yes | BNB input in wei (`1 BNB = 1000000000000000000`) |
| `slippage` | no | Tolerance in basis points — default `100` (1%), max `5000` (50%) |

#### 0.5 BNB buy with 1% slippage (default)

```bash
curl "http://localhost:3001/api/v1/tokens/0xd3ad...1111/quote/buy?bnbIn=500000000000000000"
```

#### 2 BNB buy with 0.5% slippage

```bash
curl "http://localhost:3001/api/v1/tokens/0xd3ad...1111/quote/buy?bnbIn=2000000000000000000&slippage=50"
```

**Response `200 OK`**

```json
{
  "data": {
    "token": "0xd3adbeef00000000000000000000000000001111",
    "type": "buy",
    "migrated": false,

    "bnbIn": "500000000000000000",
    "bnbInFormatted": "0.5",

    "tokensOut": "6187500000000000000000",
    "tokensOutFormatted": "6187.5",

    "spotPriceWei": "80000000000000",
    "spotPriceBNB": "0.00008",

    "effectivePriceWei": "80812000000000",
    "effectivePriceBNB": "0.000080812",

    "priceImpactBps": "101",
    "priceImpactPct": "1.01%",

    "slippageBps": "100",
    "minimumOutput": "6125625000000000000000",
    "minimumOutputFormatted": "6125.625",

    "antibotEnabled": true,
    "tradingBlock": "42000100"
  }
}
```

**Response `400 Bad Request` (missing parameter)**

```json
{
  "error": "Bad Request",
  "message": "bnbIn query parameter is required (wei)"
}
```

**Response `400 Bad Request` (invalid value)**

```json
{
  "error": "Bad Request",
  "message": "bnbIn must be greater than 0"
}
```

**Response `503 Service Unavailable` (RPC not configured)**

```json
{
  "error": "Service Unavailable",
  "message": "Quote simulation requires BSC_RPC_URL and FACTORY_ADDRESS to be configured."
}
```

---

### 5.3 Sell quote

Simulate selling tokens back to the bonding curve.

**Parameters:**

| Param | Required | Description |
|---|---|---|
| `tokensIn` | yes | Token input in wei (e.g. `10000000000000000000000` = 10 000 tokens) |
| `slippage` | no | Tolerance in basis points — default `100` (1%), max `5000` (50%) |

#### Sell 10 000 tokens with default 1% slippage

```bash
curl "http://localhost:3001/api/v1/tokens/0xd3ad...1111/quote/sell?tokensIn=10000000000000000000000"
```

#### Sell 50 000 tokens with 3% slippage

```bash
curl "http://localhost:3001/api/v1/tokens/0xd3ad...1111/quote/sell?tokensIn=50000000000000000000000&slippage=300"
```

**Response `200 OK`**

```json
{
  "data": {
    "token": "0xd3adbeef00000000000000000000000000001111",
    "type": "sell",
    "migrated": false,

    "tokensIn": "10000000000000000000000",
    "tokensInFormatted": "10000.0",

    "bnbOut": "793600000000000000",
    "bnbOutFormatted": "0.7936",

    "spotPriceWei": "80000000000000",
    "spotPriceBNB": "0.00008",

    "effectivePriceWei": "79360000000000",
    "effectivePriceBNB": "0.00007936",

    "priceImpactBps": "80",
    "priceImpactPct": "0.80%",

    "slippageBps": "100",
    "minimumOutput": "785664000000000000",
    "minimumOutputFormatted": "0.785664",

    "antibotEnabled": true,
    "tradingBlock": "42000100"
  }
}
```

---

## 6. Trades

### 6.1 All trades

**Rate limit: 60 req/min per IP.**

#### Most recent 20 trades across all tokens

```bash
curl "http://localhost:3001/api/v1/trades"
```

#### Buys only for a specific token, last 24 hours

```bash
SINCE=$(date -d '24 hours ago' +%s)
curl "http://localhost:3001/api/v1/trades?token=0xd3ad...1111&type=buy&from=${SINCE}&limit=50"
```

#### All sells by a specific trader, sorted by BNB amount descending

```bash
curl "http://localhost:3001/api/v1/trades?trader=0xdeadbeef...1234&type=sell&orderBy=bnbAmount&orderDir=desc"
```

**Supported `orderBy` values:** `timestamp` `bnbAmount` `tokenAmount` `blockNumber`

**Response `200 OK`**

```json
{
  "data": [
    {
      "id": "0xabc123...def456-3",
      "token": "0xd3adbeef00000000000000000000000000001111",
      "tradeType": "buy",
      "trader": "0x1234000000000000000000000000000000005678",
      "bnbAmount": "500000000000000000",
      "tokenAmount": "6187500000000000000000",
      "tokensToDead": "0",
      "raisedBNB": "2800000000000000000000",
      "blockNumber": "42001200",
      "txHash": "0xabc123...def456",
      "timestamp": 1741823900
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 14502,
    "pages": 726,
    "hasMore": true
  }
}
```

---

### 6.2 Trades by wallet

**Rate limit: 60 req/min per IP.**

```bash
curl "http://localhost:3001/api/v1/traders/0xdeadbeef...1234/trades"
```

#### Filter to buys within a time range

```bash
curl "http://localhost:3001/api/v1/traders/0xdeadbeef...1234/trades?type=buy&from=1741800000&to=1741824000"
```

**Response** — same shape as [All trades](#61-all-trades).

---

## 7. Migrations

All tokens that have graduated from the bonding curve to PancakeSwap V2.
**Rate limit: 60 req/min per IP.**

```bash
curl "http://localhost:3001/api/v1/migrations"
```

#### Sort by liquidity BNB deposited, ascending

```bash
curl "http://localhost:3001/api/v1/migrations?orderBy=liquidityBNB&orderDir=asc"
```

**Supported `orderBy` values:** `timestamp` `liquidityBNB` `liquidityTokens` `blockNumber`

**Response `200 OK`**

```json
{
  "data": [
    {
      "id": "0xd3adbeef00000000000000000000000000001111",
      "token": "0xd3adbeef00000000000000000000000000001111",
      "pair": "0xpancake000000000000000000000000000pair01",
      "liquidityBNB": "4200000000000000000000",
      "liquidityTokens": "380000000000000000000000000",
      "blockNumber": "42005000",
      "txHash": "0xmigrate...hash",
      "timestamp": 1741850000
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 34,
    "pages": 2,
    "hasMore": true
  }
}
```

---

## 8. TWAP Oracle

### 8.1 Latest TWAP

The most recent 30-minute time-weighted BNB/USD price used by the factory.
**Rate limit: 120 req/min per IP.**

```bash
curl "http://localhost:3001/api/v1/twap/latest"
```

**Response `200 OK`**

```json
{
  "data": {
    "id": "0xtwapTx...hash-2",
    "priceAvg": "312500000000000000000000000",
    "priceBlockNumber": "42000000",
    "blockNumber": "42000001",
    "timestamp": 1741824000
  }
}
```

**Response `404 Not Found`** (no TWAP updates indexed yet)

```json
{
  "error": "Not Found",
  "message": "No TWAP updates indexed yet"
}
```

---

### 8.2 TWAP history

**Rate limit: 60 req/min per IP.**

```bash
curl "http://localhost:3001/api/v1/twap?limit=50"
```

#### Last 24 hours of TWAP updates

```bash
SINCE=$(date -d '24 hours ago' +%s)
curl "http://localhost:3001/api/v1/twap?from=${SINCE}"
```

**Response `200 OK`**

```json
{
  "data": [
    {
      "id": "0xtwapTx...hash-2",
      "priceAvg": "312500000000000000000000000",
      "priceBlockNumber": "42000000",
      "blockNumber": "42000001",
      "timestamp": 1741824000
    },
    {
      "id": "0xtwapTx...hash-1",
      "priceAvg": "310000000000000000000000000",
      "priceBlockNumber": "41997800",
      "blockNumber": "41997801",
      "timestamp": 1741820000
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 288,
    "pages": 6,
    "hasMore": true
  }
}
```

---

## 9. Factory Events

Administrative and configuration-change events emitted by the factory owner.
**Rate limit: 60 req/min per IP.**

#### All factory events, most recent first

```bash
curl "http://localhost:3001/api/v1/factory/events"
```

#### Filter by event type

```bash
# Valid types: DefaultParamsUpdated | FeesWithdrawn | RouterUpdated |
#              FeeRecipientUpdated  | TradeFeeUpdated | UsdcPairUpdated |
#              TwapMaxAgeBlocksUpdated

curl "http://localhost:3001/api/v1/factory/events?type=FeesWithdrawn"
curl "http://localhost:3001/api/v1/factory/events?type=TradeFeeUpdated"
curl "http://localhost:3001/api/v1/factory/events?type=DefaultParamsUpdated"
```

**Response `200 OK` — FeesWithdrawn**

```json
{
  "data": [
    {
      "id": "FeesWithdrawn-0xfees...hash-1",
      "eventType": "FeesWithdrawn",
      "blockNumber": "42010000",
      "txHash": "0xfees...hash",
      "timestamp": 1741860000,
      "withdrawRecipient": "0xfeerecipient000000000000000000000000abcd",
      "withdrawAmount": "850000000000000000",
      "virtualBNBUSD": null,
      "migrationTargetUSD": null,
      "router": null,
      "feeRecipient": null,
      "feeBps": null,
      "usdcToken": null,
      "usdcPair": null,
      "usdcIsToken0": null,
      "twapMaxAgeBlocks": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "pages": 1,
    "hasMore": false
  }
}
```

**Response `200 OK` — TradeFeeUpdated**

```json
{
  "data": [
    {
      "id": "TradeFeeUpdated-0xtrade...hash-0",
      "eventType": "TradeFeeUpdated",
      "blockNumber": "41000000",
      "txHash": "0xtrade...hash",
      "timestamp": 1740000000,
      "feeBps": "100",
      "withdrawRecipient": null,
      "withdrawAmount": null,
      "virtualBNBUSD": null,
      "migrationTargetUSD": null,
      "router": null,
      "feeRecipient": null,
      "usdcToken": null,
      "usdcPair": null,
      "usdcIsToken0": null,
      "twapMaxAgeBlocks": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "pages": 1,
    "hasMore": false
  }
}
```

**Response `400 Bad Request` — invalid type**

```json
{
  "error": "Bad Request",
  "message": "Invalid event type. Valid types: DefaultParamsUpdated, FeesWithdrawn, RouterUpdated, FeeRecipientUpdated, TradeFeeUpdated, UsdcPairUpdated, TwapMaxAgeBlocksUpdated"
}
```

---

## 10. Creators

All tokens deployed by a specific creator address.
**Rate limit: 60 req/min per IP.**

```bash
curl "http://localhost:3001/api/v1/creators/0xabcdef...0001/tokens"
```

**Response `200 OK`**

```json
{
  "data": [
    {
      "id": "0xd3adbeef00000000000000000000000000001111",
      "tokenType": "Tax",
      "creator": "0xabcdef0000000000000000000000000000000001",
      "totalSupply": "1000000000000000000000000000",
      "antibotEnabled": true,
      "tradingBlock": "42000100",
      "createdAtBlock": "42000050",
      "createdAtTimestamp": 1741820000,
      "migrated": false,
      "pairAddress": null,
      "buyCount": 84,
      "sellCount": 12,
      "volumeBNB": "3200000000000000000000",
      "raisedBNB": "2800000000000000000000"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 3,
    "pages": 1,
    "hasMore": false
  }
}
```

---

## 11. Rate Limit Response

When any endpoint's per-IP limit is exceeded.

**Response `429 Too Many Requests`**

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1741824060
Retry-After: 42
Content-Type: application/json
```

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit of 20 req/min exceeded for your IP. Retry in 42s.",
  "retryAfter": 42,
  "ip": "1.2.3.4"
}
```

All successful responses also carry rate-limit headers so clients can implement proactive back-off:

```http
X-RateLimit-Limit:     20
X-RateLimit-Remaining: 17
X-RateLimit-Reset:     1741824060
```

---

## Common error shapes

| Status | `error` field | When |
|---|---|---|
| `400` | `"Bad Request"` | Invalid address, missing required param, out-of-range value |
| `404` | `"Not Found"` | Token / migration not in the index |
| `429` | `"Too Many Requests"` | Per-IP rate limit exceeded |
| `503` | `"Service Unavailable"` | Quote simulation attempted but RPC not configured |
| `500` | `"Internal Server Error"` | Unexpected DB or network error |
