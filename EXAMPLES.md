# OneMEME Launchpad API — Examples

Complete `curl` reference and response shapes for every endpoint.

**Base URL:** `https://api.1coin.meme/api/v1`

---

## Table of Contents

1. [Health](#1-health)
2. [Tokens — List](#2-tokens--list)
3. [Tokens — Single](#3-tokens--single)
4. [Tokens — Trades](#4-tokens--trades)
5. [Tokens — Traders](#5-tokens--traders)
6. [Tokens — Holders](#6-tokens--holders)
7. [Tokens — Migration](#7-tokens--migration)
8. [Tokens — Quote](#8-tokens--quote)
9. [Creators — Tokens](#9-creators--tokens)
10. [Trades — Global](#10-trades--global)
11. [Traders — History](#11-traders--history)
12. [Migrations — Global](#12-migrations--global)
13. [Activity Feed](#13-activity-feed)
14. [Activity — SSE Stream](#14-activity--sse-stream)
15. [Activity — WebSocket](#15-activity--websocket)
16. [Discover — Trending](#16-discover--trending)
17. [Discover — New](#17-discover--new)
18. [Discover — Bonding](#18-discover--bonding)
19. [Discover — Migrated](#19-discover--migrated)
20. [Stats](#20-stats)
21. [Leaderboard — Tokens](#21-leaderboard--tokens)
22. [Leaderboard — Creators](#22-leaderboard--creators)
23. [Leaderboard — Traders](#23-leaderboard--traders)
24. [Leaderboard — Users](#24-leaderboard--users)
25. [Charts](#25-charts)
26. [BNB Price](#26-bnb-price)
27. [Salt Mining](#27-salt-mining)
28. [Vesting](#28-vesting)
29. [Chat](#29-chat)
30. [Metadata Upload](#30-metadata-upload)

---

## 1. Health

```bash
curl https://api.1coin.meme/health
```

```json
{
  "status":    "ok",
  "service":   "onememe-launchpad-api",
  "timestamp": 1774058177240
}
```

---

## 2. Tokens — List

```bash
curl 'https://api.1coin.meme/api/v1/tokens?limit=2'
```

```json
{
  "data": [
    {
      "id":                 "0x7cff1dd19e357e7e0c7b0bef189e415d741d1111",
      "tokenType":          "Standard",
      "creator":            "0x25b94c4a7cf44c10ba5ead6f540ee67108ccd4d3",
      "totalSupply":        "1000000000000000000000000",
      "virtualBnb":         "1000000000000000000",
      "antibotEnabled":     false,
      "tradingBlock":       "96789778",
      "createdAtBlock":     "96789778",
      "createdAtTimestamp": 1773995248,
      "creationTxHash":     "0x9791939ed064c76c410c517fc1fa5c7b848ad945674068db8ea46bb1998256dc",
      "migrated":           true,
      "pairAddress":        "0xabc...def",
      "buyCount":           6,
      "sellCount":          0,
      "volumeBnb":          "5102040816326530613",
      "raisedBnb":          "5000000000000000001",
      "migrationTarget":    "5000000000000000000",
      "creatorTokens":      "0",
      "priceBnb":           "0.000001241",
      "marketCapBnb":       "1.241",
      "marketCapUsd":       "724.18"
    }
  ],
  "pagination": {
    "page": 1, "limit": 2, "total": 42, "pages": 21, "hasMore": true
  }
}
```

**Filter by type, migrated status, order:**
```bash
curl 'https://api.1coin.meme/api/v1/tokens?type=Standard&migrated=false&orderBy=volume_bnb&orderDir=desc&limit=10'
```

---

## 3. Tokens — Single

Live PancakeSwap `getReserves()` is called for migrated tokens.

```bash
curl 'https://api.1coin.meme/api/v1/tokens/0x7cff1dd19e357e7e0c7b0bef189e415d741d1111'
```

```json
{
  "data": {
    "id":                 "0x7cff1dd19e357e7e0c7b0bef189e415d741d1111",
    "tokenType":          "Standard",
    "creator":            "0x25b94c4a7cf44c10ba5ead6f540ee67108ccd4d3",
    "totalSupply":        "1000000000000000000000000",
    "virtualBnb":         "1000000000000000000",
    "antibotEnabled":     false,
    "tradingBlock":       "96789778",
    "createdAtBlock":     "96789778",
    "createdAtTimestamp": 1773995248,
    "creationTxHash":     "0x9791939ed064c76c410c517fc1fa5c7b848ad945674068db8ea46bb1998256dc",
    "migrated":           true,
    "pairAddress":        "0xabc...def",
    "buyCount":           6,
    "sellCount":          0,
    "volumeBnb":          "5102040816326530613",
    "raisedBnb":          "5000000000000000001",
    "migrationTarget":    "5000000000000000000",
    "creatorTokens":      "0",
    "priceBnb":           "0.000001253",
    "marketCapBnb":       "1.253",
    "marketCapUsd":       "731.18",
    "metaURI":            "ipfs://QmXyz...",
    "metadata": {
      "name":        "PEPE2",
      "symbol":      "PEPE2",
      "description": "The next pepe",
      "image":       "ipfs://QmImg...",
      "website":     "https://pepe2.io",
      "telegram":    "https://t.me/pepe2"
    }
  }
}
```

---

## 4. Tokens — Trades

```bash
curl 'https://api.1coin.meme/api/v1/tokens/0x7cff...1111/trades?limit=3&type=buy'
```

```json
{
  "data": [
    {
      "id":           "0xtxhash...-12",
      "token":        "0x7cff...1111",
      "tradeType":    "buy",
      "trader":       "0xbuyer...",
      "bnbAmount":    "500000000000000000",
      "tokenAmount":  "6172839000000000000000",
      "tokensToDead": null,
      "raisedBnb":    "3500000000000000000",
      "blockNumber":  "96791234",
      "txHash":       "0xtxhash...",
      "timestamp":    1773996100
    }
  ],
  "pagination": { "page": 1, "limit": 3, "total": 6, "pages": 2, "hasMore": true }
}
```

**Filter by timestamp range:**
```bash
curl 'https://api.1coin.meme/api/v1/tokens/0x7cff...1111/trades?from=1773990000&to=1774000000'
```

---

## 5. Tokens — Traders

Per-trader aggregated stats for a token.

```bash
curl 'https://api.1coin.meme/api/v1/tokens/0x7cff...1111/traders?limit=5&orderBy=totalVolumeBNB'
```

```json
{
  "data": [
    {
      "trader":         "0xbuyer...",
      "buyCount":       4,
      "sellCount":      1,
      "totalTrades":    5,
      "totalBNBIn":     "2000000000000000000",
      "totalBNBOut":    "400000000000000000",
      "totalVolumeBNB": "2400000000000000000",
      "netBNB":         "-1600000000000000000"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 3, "pages": 1, "hasMore": false }
}
```

---

## 6. Tokens — Holders

```bash
curl 'https://api.1coin.meme/api/v1/tokens/0x7cff...1111/holders?limit=5'
```

```json
{
  "data": [
    { "address": "0xholder1...", "balance": "50000000000000000000000" },
    { "address": "0xholder2...", "balance": "20000000000000000000000" }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 18, "pages": 4, "hasMore": true }
}
```

---

## 7. Tokens — Migration

Returns 404 if the token has not migrated yet.

```bash
curl 'https://api.1coin.meme/api/v1/tokens/0x7cff...1111/migration'
```

```json
{
  "data": {
    "id":              "0x7cff...1111",
    "token":           "0x7cff...1111",
    "pair":            "0xpair...",
    "liquidityBnb":    "5000000000000000001",
    "liquidityTokens": "800000000000000000000000",
    "blockNumber":     "96799999",
    "txHash":          "0xmigrationtx...",
    "timestamp":       1774002000
  }
}
```

---

## 8. Tokens — Quote

### Spot Price

```bash
curl 'https://api.1coin.meme/api/v1/tokens/0x7cff...1111/quote/price'
```

```json
{
  "data": {
    "token":          "0x7cff...1111",
    "migrated":       false,
    "spotPriceWei":   "1241000000000",
    "spotPriceBNB":   "0.000001241",
    "tokensPerBNB":   "806.10",
    "antibotEnabled": false,
    "tradingBlock":   "96789778"
  }
}
```

### Buy Quote

```bash
curl 'https://api.1coin.meme/api/v1/tokens/0x7cff...1111/quote/buy?bnbIn=1000000000000000000&slippage=100'
```

```json
{
  "data": {
    "token":          "0x7cff...1111",
    "side":           "buy",
    "bnbIn":          "1000000000000000000",
    "bnbInFormatted": "1.0",
    "tokensOut":      "780000000000000000000",
    "minTokensOut":   "772200000000000000000",
    "slippageBps":    100,
    "priceImpactBps": 142,
    "spotPriceWei":   "1241000000000"
  }
}
```

### Sell Quote

```bash
curl 'https://api.1coin.meme/api/v1/tokens/0x7cff...1111/quote/sell?tokensIn=780000000000000000000&slippage=100'
```

```json
{
  "data": {
    "token":       "0x7cff...1111",
    "side":        "sell",
    "tokensIn":    "780000000000000000000",
    "bnbOut":      "960000000000000000",
    "minBnbOut":   "950400000000000000",
    "slippageBps": 100,
    "priceImpactBps": 98
  }
}
```

---

## 9. Creators — Tokens

```bash
curl 'https://api.1coin.meme/api/v1/creators/0x25b9...d4d3/tokens?limit=5'
```

Same token object shape as `GET /tokens`, including `priceBnb`, `marketCapBnb`, `marketCapUsd`.

```json
{
  "data": [
    { "id": "0x7cff...1111", "tokenType": "Standard", "priceBnb": "0.000001241", "marketCapUsd": "724.18", "..." : "..." }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 3, "pages": 1, "hasMore": false }
}
```

---

## 10. Trades — Global

```bash
curl 'https://api.1coin.meme/api/v1/trades?limit=3&type=buy&orderBy=bnb_amount&orderDir=desc'
```

```json
{
  "data": [
    {
      "id":          "0xtxhash...-12",
      "token":       "0x7cff...1111",
      "tradeType":   "buy",
      "trader":      "0xbuyer...",
      "bnbAmount":   "2000000000000000000",
      "tokenAmount": "1500000000000000000000",
      "raisedBnb":   "4000000000000000000",
      "blockNumber": "96791234",
      "txHash":      "0xtxhash...",
      "timestamp":   1773996100
    }
  ],
  "pagination": { "page": 1, "limit": 3, "total": 28, "pages": 10, "hasMore": true }
}
```

---

## 11. Traders — History

```bash
curl 'https://api.1coin.meme/api/v1/traders/0xbuyer.../trades?limit=5'
```

Same trade object shape as above, filtered to a specific trader's wallet.

---

## 12. Migrations — Global

```bash
curl 'https://api.1coin.meme/api/v1/migrations?limit=5'
```

```json
{
  "data": [
    {
      "id":              "0x7cff...1111",
      "token":           "0x7cff...1111",
      "pair":            "0xpair...",
      "liquidityBnb":    "5000000000000000001",
      "liquidityTokens": "800000000000000000000000",
      "blockNumber":     "96799999",
      "txHash":          "0xmigrationtx...",
      "timestamp":       1774002000
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 1, "pages": 1, "hasMore": false }
}
```

---

## 13. Activity Feed

Returns the 15 most recent create/buy/sell events as a flat array. Used for the header marquee — poll or combine with the SSE stream.

```bash
curl 'https://api.1coin.meme/api/v1/activity'
```

```json
[
  {
    "eventType":   "buy",
    "token":       "0x7cff...1111",
    "actor":       "0xbuyer...",
    "bnbAmount":   "500000000000000000",
    "tokenAmount": "6172839000000000000000",
    "blockNumber": "96791234",
    "timestamp":   1773996100,
    "txHash":      "0xtxhash..."
  },
  {
    "eventType":   "create",
    "token":       "0xbe5b...1111",
    "actor":       "0xcreator...",
    "bnbAmount":   null,
    "tokenAmount": null,
    "blockNumber": "96789563",
    "timestamp":   1773995151,
    "txHash":      "0xcreationtx..."
  }
]
```

---

## 14. Activity — SSE Stream

On connect: replays the 15 most recent events oldest-first, then pushes live events as they are indexed.

```bash
curl -N 'https://api.1coin.meme/api/v1/activity/stream'
# Filter to buys only:
curl -N 'https://api.1coin.meme/api/v1/activity/stream?type=buy'
# Filter to a specific token:
curl -N 'https://api.1coin.meme/api/v1/activity/stream?token=0x7cff...1111'
```

```
event: activity
data: {"eventType":"buy","token":"0x7cff...1111","actor":"0xbuyer...","bnbAmount":"500000000000000000","tokenAmount":"6172839000000000000000","blockNumber":"96791234","timestamp":1773996100,"txHash":"0xtxhash..."}

event: activity
data: {"eventType":"create","token":"0xnew...1111","actor":"0xcreator...","bnbAmount":null,"tokenAmount":null,"blockNumber":"96800001","timestamp":1773997000,"txHash":"0xcreationtx..."}

event: keepalive
data:
```

**Frontend (TypeScript):**

```typescript
const es = new EventSource("https://api.1coin.meme/api/v1/activity/stream");

es.addEventListener("activity", (e) => {
  const event = JSON.parse(e.data);
  console.log(event.eventType, event.token, event.bnbAmount);
});

es.addEventListener("keepalive", () => {
  // connection is alive — no action needed
});

es.onerror = () => {
  // browser auto-reconnects on error
};
```

---

## 15. Activity — WebSocket

```typescript
const ws = new WebSocket("wss://api.1coin.meme/api/v1/activity/ws");

ws.onmessage = (msg) => {
  const { event, data } = JSON.parse(msg.data);
  if (event === "activity") {
    const row = JSON.parse(data); // same shape as SSE data
    console.log(row.eventType, row.token);
  }
};
```

Wire format:
```json
{ "event": "activity", "data": "{\"eventType\":\"buy\",\"token\":\"0x7cff...1111\", ...}" }
```

---

## 16. Discover — Trending

```bash
curl 'https://api.1coin.meme/api/v1/discover/trending?window=3600&limit=5'
```

```json
{
  "data": [
    {
      "id":              "0x7cff...1111",
      "tokenType":       "Standard",
      "creator":         "0xcreator...",
      "raisedBnb":       "4000000000000000000",
      "migrated":        false,
      "recentTrades":    12,
      "recentBuys":      9,
      "recentSells":     3,
      "recentVolumeBNB": "3200000000000000000"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 4, "pages": 1, "hasMore": false },
  "window": 3600
}
```

---

## 17. Discover — New

```bash
curl 'https://api.1coin.meme/api/v1/discover/new?limit=5&type=Standard'
```

Returns newest non-migrated tokens, ordered by `createdAtBlock` descending. Same token shape as `/tokens`.

---

## 18. Discover — Bonding

```bash
curl 'https://api.1coin.meme/api/v1/discover/bonding?limit=5'
```

Non-migrated tokens sorted by `raisedBNB` descending. Includes `recentTrades` and `recentVolumeBNB` for the last 24 hours.

```json
{
  "data": [
    {
      "id":              "0xbe5b...1111",
      "tokenType":       "Standard",
      "raisedBnb":       "3800000000000000000",
      "migrationTarget": "5000000000000000000",
      "recentTrades":    7,
      "recentVolumeBNB": "1200000000000000000"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 2, "pages": 1, "hasMore": false }
}
```

---

## 19. Discover — Migrated

```bash
curl 'https://api.1coin.meme/api/v1/discover/migrated?orderBy=liquidityBNB&orderDir=desc&limit=5'
```

```json
{
  "data": [
    {
      "id":              "0x7cff...1111",
      "tokenType":       "Standard",
      "migrated":        true,
      "pairAddress":     "0xpair...",
      "liquidityBNB":    "5000000000000000001",
      "liquidityTokens": "800000000000000000000000",
      "migratedAtBlock": "96799999",
      "migratedAt":      1774002000,
      "migrationTxHash": "0xmigrationtx..."
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 1, "pages": 1, "hasMore": false }
}
```

---

## 20. Stats

```bash
curl 'https://api.1coin.meme/api/v1/stats'
```

```json
{
  "data": {
    "totalTokens":    42,
    "migratedTokens": 8,
    "activeTokens":   34,
    "tokensByType": {
      "Standard":   30,
      "Tax":        8,
      "Reflection": 4
    },
    "totalTrades":        1284,
    "totalBuys":          902,
    "totalSells":         382,
    "uniqueTraders":      217,
    "totalVolumeBNB":     "142830000000000000000",
    "totalLiquidityBNB":  "40000000000000000000",
    "topTokenByVolume": {
      "id":         "0x7cff...1111",
      "tokenType":  "Standard",
      "creator":    "0xcreator...",
      "volumeBNB":  "51020000000000000000",
      "buyCount":   142,
      "sellCount":  58,
      "migrated":   true
    }
  }
}
```

---

## 21. Leaderboard — Tokens

```bash
curl 'https://api.1coin.meme/api/v1/leaderboard/tokens?period=7d&orderBy=volumeBNB&limit=5'
```

```json
{
  "data": [
    {
      "address":       "0x7cff...1111",
      "tokenType":     "Standard",
      "creator":       "0xcreator...",
      "migrated":      true,
      "volumeBNB":     "51020408163265306130",
      "tradeCount":    200,
      "buyCount":      142,
      "sellCount":     58,
      "uniqueTraders": 34,
      "raisedBNB":     "5000000000000000001",
      "createdAt":     1773995248
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 42, "pages": 9, "hasMore": true },
  "period":  "7d",
  "orderBy": "volumeBNB"
}
```

---

## 22. Leaderboard — Creators

```bash
curl 'https://api.1coin.meme/api/v1/leaderboard/creators?period=30d&limit=5'
```

```json
{
  "data": [
    {
      "address":        "0xcreator...",
      "tokensLaunched": 5,
      "tokensMigrated": 2,
      "totalVolumeBNB": "62000000000000000000",
      "totalRaisedBNB": "12000000000000000000",
      "lastLaunchAt":   1773995248
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 18, "pages": 4, "hasMore": true },
  "period": "30d"
}
```

---

## 23. Leaderboard — Traders

```bash
curl 'https://api.1coin.meme/api/v1/leaderboard/traders?period=1d&limit=5'
```

```json
{
  "data": [
    {
      "address":      "0xtrader...",
      "volumeBNB":    "8200000000000000000",
      "tradeCount":   24,
      "buyCount":     16,
      "sellCount":    8,
      "tokensTraded": 4,
      "lastTradeAt":  1774050000
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 87, "pages": 18, "hasMore": true },
  "period": "1d"
}
```

---

## 24. Leaderboard — Users

Combined traders + creators sorted by volume then tokens launched.

```bash
curl 'https://api.1coin.meme/api/v1/leaderboard/users?period=alltime&limit=5'
```

```json
{
  "data": [
    {
      "address":        "0xuser...",
      "volumeBNB":      "18400000000000000000",
      "tradeCount":     48,
      "buyCount":       32,
      "sellCount":      16,
      "tokensTraded":   7,
      "lastTradeAt":    1774050000,
      "tokensLaunched": 3,
      "tokensMigrated": 1,
      "totalRaisedBNB": "9000000000000000000"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 230, "pages": 46, "hasMore": true },
  "period": "alltime"
}
```

---

## 25. Charts

### Config

```bash
curl 'https://api.1coin.meme/api/v1/charts/config'
```

```json
{
  "supported_resolutions":   ["1", "5", "15", "30", "60", "240", "D"],
  "supports_group_request":  false,
  "supports_marks":          false,
  "supports_search":         true,
  "supports_timescale_marks": false
}
```

### Symbol Metadata

```bash
curl 'https://api.1coin.meme/api/v1/charts/symbols?symbol=0x7cff...1111'
```

```json
{
  "name":                   "0x7cff...1111",
  "ticker":                 "0x7cff...1111",
  "description":            "OneMEME Token (Standard)",
  "type":                   "crypto",
  "session":                "24x7",
  "timezone":               "Etc/UTC",
  "exchange":               "OneMEME",
  "pricescale":             1000000000,
  "minmov":                 1,
  "has_intraday":           true,
  "has_daily":              true,
  "supported_resolutions":  ["1", "5", "15", "30", "60", "240", "D"],
  "data_status":            "streaming"
}
```

### OHLCV History

```bash
curl 'https://api.1coin.meme/api/v1/charts/history?symbol=0x7cff...1111&resolution=15&from=1773990000&to=1774000000'
```

```json
{
  "s": "ok",
  "t": [1773991500, 1773992400, 1773993300],
  "o": ["0.000001200", "0.000001210", "0.000001230"],
  "h": ["0.000001250", "0.000001260", "0.000001270"],
  "l": ["0.000001190", "0.000001200", "0.000001220"],
  "c": ["0.000001210", "0.000001230", "0.000001241"],
  "v": ["500000000000000000", "300000000000000000", "800000000000000000"]
}
```

Returns `{ "s": "no_data" }` when no trades exist in the requested range, or for migrated tokens (price moved to PancakeSwap).

### Search

```bash
curl 'https://api.1coin.meme/api/v1/charts/search?query=0x7cff&limit=5'
```

```json
[
  {
    "symbol":      "0x7cff...1111",
    "full_name":   "0x7cff...1111",
    "description": "OneMEME Token (Standard)",
    "exchange":    "OneMEME",
    "ticker":      "0x7cff...1111",
    "type":        "crypto"
  }
]
```

---

## 26. BNB Price

```bash
curl 'https://api.1coin.meme/api/v1/price/bnb'
```

```json
{
  "bnbUsdt":   583.42,
  "updatedAt": 1774058100,
  "stale":     false,
  "sources": [
    { "exchange": "Binance",   "price": 583.50, "ok": true,  "cachedAt": 1774058095 },
    { "exchange": "OKX",       "price": 583.38, "ok": true,  "cachedAt": 1774058094 },
    { "exchange": "Bybit",     "price": 583.40, "ok": true,  "cachedAt": 1774058096 },
    { "exchange": "CoinGecko", "price": 583.20, "ok": true,  "cachedAt": 1774058040 },
    { "exchange": "MEXC",      "price": 583.55, "ok": true,  "cachedAt": 1774058093 },
    { "exchange": "GateIO",    "price": 583.48, "ok": false, "cachedAt": 1774057800 }
  ]
}
```

---

## 27. Salt Mining

The backend mines a `bytes32` userSalt so the CREATE2-predicted address ends with `0x1111`. Three worker threads run in parallel — one per token type — so the salt is ready for whichever type the user picks.

### Start Mining (SSE)

Open the SSE stream when the user connects to the launch page. Each connection starts a fresh mine.

```bash
curl -N 'https://api.1coin.meme/api/v1/salt/0xAbCd...1234/stream'
```

```
data: {"type":"progress","tokenType":"Standard","attempts":50000}

data: {"type":"progress","tokenType":"Tax","attempts":50000}

data: {"type":"found","tokenType":"Tax","attempts":43210,"salt":"0xabcdef...","predictedAddress":"0x7B2E...1111"}

data: {"type":"progress","tokenType":"Standard","attempts":100000}

data: {"type":"found","tokenType":"Reflection","attempts":88901,"salt":"0x123456...","predictedAddress":"0x9D1F...1111"}

data: {"type":"found","tokenType":"Standard","attempts":71024,"salt":"0xdeadbeef...","predictedAddress":"0xF3a8...1111"}
```

Stream closes automatically once all three types are found.

### Check Current Result (GET)

```bash
curl 'https://api.1coin.meme/api/v1/salt/0xAbCd...1234'
```

**Partial (still mining):**
```json
{
  "address":  "0xAbCd...1234",
  "tax":      { "salt": "0xabcdef...", "predictedAddress": "0x7B2E...1111", "attempts": 43210 }
}
```

**Complete:**
```json
{
  "address":    "0xAbCd...1234",
  "standard":   { "salt": "0xdeadbeef...", "predictedAddress": "0xF3a8...1111", "attempts": 71024 },
  "tax":        { "salt": "0xabcdef...",   "predictedAddress": "0x7B2E...1111", "attempts": 43210 },
  "reflection": { "salt": "0x123456...",   "predictedAddress": "0x9D1F...1111", "attempts": 88901 }
}
```

**No session started yet:**
```json
{ "statusCode": 404, "message": "No salt session for this address. Open the SSE stream to start mining." }
```

### Frontend Integration (TypeScript)

```typescript
// Salts stored per token type as they arrive
const salts: Record<string, { salt: string; predictedAddress: string }> = {};
let eventSource: EventSource | null = null;

function startMining(walletAddress: string) {
  // Close any existing connection first
  eventSource?.close();

  eventSource = new EventSource(
    `https://api.1coin.meme/api/v1/salt/${walletAddress}/stream`
  );

  eventSource.onmessage = (e) => {
    const event = JSON.parse(e.data);

    if (event.type === "progress") {
      console.log(`[${event.tokenType}] ${event.attempts.toLocaleString()} attempts...`);
    }

    if (event.type === "found") {
      salts[event.tokenType] = {
        salt:             event.salt,
        predictedAddress: event.predictedAddress,
      };
      console.log(`[${event.tokenType}] Found! Address: ${event.predictedAddress}`);

      if (Object.keys(salts).length === 3) {
        eventSource!.close(); // all three done
      }
    }
  };
}

// On launch — pass the salt for the chosen token type
function getSaltForLaunch(tokenType: "Standard" | "Tax" | "Reflection") {
  const result = salts[tokenType];
  if (!result) throw new Error(`Salt for ${tokenType} not yet mined`);
  return result.salt; // pass to LaunchpadFactory.createToken()
}
```

---

## 28. Vesting

### By Token

```bash
curl 'https://api.1coin.meme/api/v1/vesting/0x7cff...1111'
```

```json
{
  "data": {
    "token":       "0x7cff...1111",
    "beneficiary": "0xcreator...",
    "amount":      "50000000000000000000000",
    "start":       1773995248,
    "claimed":     "0",
    "voided":      false,
    "burned":      "0"
  }
}
```

### By Creator

```bash
curl 'https://api.1coin.meme/api/v1/creators/0xcreator.../vesting?limit=5'
```

```json
{
  "data": [
    {
      "token":       "0x7cff...1111",
      "beneficiary": "0xcreator...",
      "amount":      "50000000000000000000000",
      "start":       1773995248,
      "claimed":     "10000000000000000000000",
      "voided":      false,
      "burned":      "0"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 3, "pages": 1, "hasMore": false }
}
```

---

## 29. Chat

```bash
curl 'https://api.1coin.meme/api/v1/chat/0x7cff...1111/messages'
```

```json
{
  "data": [
    {
      "id":        "msg_001",
      "token":     "0x7cff...1111",
      "sender":    "0xuser...",
      "message":   "gm, this is going to moon",
      "timestamp": 1774050000
    }
  ]
}
```

---

## 30. Metadata Upload

Upload token metadata and image to IPFS before creating the token on-chain. Returns an `ipfs://` URI to pass to `setMetaURI()`.

```bash
curl -X POST 'https://api.1coin.meme/api/v1/metadata/upload' \
  -F 'image=@./pepe.png' \
  -F 'name=PEPE2' \
  -F 'symbol=PEPE2' \
  -F 'description=The next pepe on BSC' \
  -F 'website=https://pepe2.io' \
  -F 'x=https://x.com/pepe2bsc' \
  -F 'telegram=https://t.me/pepe2bsc'
```

```json
{
  "data": {
    "metaURI":    "ipfs://QmXyz123...",
    "ipfsHash":   "QmXyz123...",
    "gatewayUrl": "https://ipfs.io/ipfs/QmXyz123...",
    "imageUri":   "ipfs://QmImg456...",
    "instructions": {
      "nextStep": "Call setMetaURI(metaURI) on your token contract with the metaURI value above.",
      "example":  "tokenContract.setMetaURI(\"ipfs://QmXyz123...\")"
    }
  }
}
```

### TypeScript Upload Example

```typescript
async function uploadMetadata(imageFile: File, fields: {
  name: string;
  symbol: string;
  description: string;
  website?: string;
  x?: string;
  telegram?: string;
}): Promise<{ metaURI: string; predictedAddress: string }> {
  const form = new FormData();
  form.append("image",       imageFile);
  form.append("name",        fields.name);
  form.append("symbol",      fields.symbol);
  form.append("description", fields.description);
  if (fields.website)  form.append("website",  fields.website);
  if (fields.x)        form.append("x",        fields.x);
  if (fields.telegram) form.append("telegram", fields.telegram);

  const res = await fetch("https://api.1coin.meme/api/v1/metadata/upload", {
    method: "POST",
    body:   form,
  });

  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const { data } = await res.json();
  return data;
}
```

### Full Launch Flow (TypeScript)

```typescript
import { parseEther, createWalletClient } from "viem";

async function launchToken(
  walletAddress: `0x${string}`,
  tokenType: "Standard" | "Tax" | "Reflection",
  imageFile: File,
  metadata: { name: string; symbol: string; description: string },
) {
  // 1. Upload metadata to IPFS
  const { metaURI } = await uploadMetadata(imageFile, metadata);

  // 2. Get the pre-mined salt for this token type
  const salt = getSaltForLaunch(tokenType); // from salt mining session

  // 3. Call LaunchpadFactory.createToken()
  const walletClient = createWalletClient({ ... });
  const tx = await walletClient.writeContract({
    address:      FACTORY_ADDRESS,
    abi:          FACTORY_ABI,
    functionName: "createToken",
    args: [
      tokenTypeIndex(tokenType), // 0=Standard, 1=Tax, 2=Reflection
      salt,
      metaURI,
    ],
    value: parseEther("0.01"), // creation fee
  });

  return tx;
}
```
