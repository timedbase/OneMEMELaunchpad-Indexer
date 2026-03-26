# OneMEME Launchpad API — Examples

Complete `curl` reference and response shapes for every endpoint.

**Base URL:** `https://api.1coin.meme/api/v1/bsc`

The chain slug (`bsc`) reflects the `CHAIN_SLUG` environment variable. Swap it for any other chain name if running a multi-chain deployment.

---

## Table of Contents

1. [Health](#1-health)
2. [Tokens — List](#2-tokens--list)
3. [Tokens — Single](#3-tokens--single)
4. [Tokens — Trades](#4-tokens--trades)
5. [Tokens — Traders](#5-tokens--traders)
6. [Tokens — Holders](#6-tokens--holders)
7. [Tokens — Migration](#7-tokens--migration)
8. [Tokens — Snapshots](#8-tokens--snapshots)
9. [Tokens — Quote](#9-tokens--quote)
10. [Creators — Tokens](#10-creators--tokens)
11. [Trades — Global](#11-trades--global)
12. [Traders — History](#12-traders--history)
13. [Migrations — Global](#13-migrations--global)
14. [Activity Feed](#14-activity-feed)
15. [Activity — SSE Stream](#15-activity--sse-stream)
16. [Activity — WebSocket](#16-activity--websocket)
17. [Discover — Trending](#17-discover--trending)
18. [Discover — New](#18-discover--new)
19. [Discover — Graduating](#19-discover--graduating)
20. [Discover — Migrated](#20-discover--migrated)
21. [Stats](#21-stats)
22. [Leaderboard — Tokens](#22-leaderboard--tokens)
23. [Leaderboard — Creators](#23-leaderboard--creators)
24. [Leaderboard — Traders](#24-leaderboard--traders)
25. [Leaderboard — Users](#25-leaderboard--users)
26. [Charts](#26-charts)
27. [BNB Price](#27-bnb-price)
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
curl 'https://api.1coin.meme/api/v1/bsc/tokens?limit=2'
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
      "priceUsd":           "0.0007241800",
      "marketCapBnb":       "1.241",
      "marketCapUsd":       "724.18",
      "metaUri":            "ipfs://QmXyz...",
      "name":               "PEPE2",
      "symbol":             "PEPE2",
      "image":              "https://gateway.pinata.cloud/ipfs/QmImg...",
      "website":            "https://pepe2.io",
      "twitter":            "https://x.com/pepe2bsc",
      "telegram":           "https://t.me/pepe2"
    }
  ],
  "pagination": {
    "page": 1, "limit": 2, "total": 42, "pages": 21, "hasMore": true
  }
}
```

**Filter by type, migrated status, order:**
```bash
curl 'https://api.1coin.meme/api/v1/bsc/tokens?type=Standard&migrated=false&orderBy=volume_bnb&orderDir=desc&limit=10'
```

---

## 3. Tokens — Single

Live PancakeSwap `getReserves()` is called for migrated tokens.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/tokens/0x7cff1dd19e357e7e0c7b0bef189e415d741d1111'
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
    "priceUsd":           "0.0007305000",
    "marketCapBnb":       "1.253",
    "marketCapUsd":       "731.18",
    "metaUri":            "ipfs://QmXyz...",
    "name":               "PEPE2",
    "symbol":             "PEPE2",
    "image":              "https://gateway.pinata.cloud/ipfs/QmImg...",
    "website":            "https://pepe2.io",
    "twitter":            "https://x.com/pepe2bsc",
    "telegram":           "https://t.me/pepe2"
  }
}
```

---

## 4. Tokens — Trades

```bash
curl 'https://api.1coin.meme/api/v1/bsc/tokens/0x7cff...1111/trades?limit=3&type=buy'
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
curl 'https://api.1coin.meme/api/v1/bsc/tokens/0x7cff...1111/trades?from=1773990000&to=1774000000'
```

---

## 5. Tokens — Traders

Per-trader aggregated stats for a token.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/tokens/0x7cff...1111/traders?limit=5&orderBy=totalVolumeBNB'
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
curl 'https://api.1coin.meme/api/v1/bsc/tokens/0x7cff...1111/holders?limit=5'
```

```json
{
  "data": [
    {
      "address":              "0xholder1...",
      "balance":              "50000000000000000000000",
      "lastUpdatedBlock":     "96795000",
      "lastUpdatedTimestamp": 1773998400
    },
    {
      "address":              "0xholder2...",
      "balance":              "20000000000000000000000",
      "lastUpdatedBlock":     "96793000",
      "lastUpdatedTimestamp": 1773997200
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 18, "pages": 4, "hasMore": true }
}
```

---

## 7. Tokens — Migration

Returns 404 if the token has not migrated yet.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/tokens/0x7cff...1111/migration'
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

## 8. Tokens — Snapshots

Per-block bonding-curve state. One row per block that had trade activity. Each row includes `virtualLiquidityBNB` (= `virtualBNB + closeRaisedBNB`) and `priceBnb` (= `virtualLiquidity² / (virtualBNB × totalSupply)`). Useful for building accurate historical price charts or querying the curve depth at a specific block.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/tokens/0x7cff...1111/snapshots?limit=5'
```

```json
{
  "data": [
    {
      "blockNumber":     "96799001",
      "timestamp":       1774001800,
      "openRaisedBNB":   "4800000000000000000",
      "closeRaisedBNB":  "4900000000000000000",
      "volumeBNB":       "100000000000000000",
      "buyCount":        2,
      "sellCount":       0,
      "priceBnb":        "0.000033856"
    },
    {
      "blockNumber":     "96798500",
      "timestamp":       1774000300,
      "openRaisedBNB":   "4600000000000000000",
      "closeRaisedBNB":  "4800000000000000000",
      "volumeBNB":       "200000000000000000",
      "buyCount":        1,
      "sellCount":       1,
      "priceBnb":        "0.000033062"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 48, "pages": 10, "hasMore": true }
}
```

**Filter by time range:**
```bash
curl 'https://api.1coin.meme/api/v1/bsc/tokens/0x7cff...1111/snapshots?from=1773990000&to=1774000000&limit=100'
```

---

## 9. Tokens — Quote

### Spot Price

```bash
curl 'https://api.1coin.meme/api/v1/bsc/tokens/0x7cff...1111/quote/price'
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
curl 'https://api.1coin.meme/api/v1/bsc/tokens/0x7cff...1111/quote/buy?bnbIn=1000000000000000000&slippage=100'
```

```json
{
  "data": {
    "token":                  "0x7cff...1111",
    "type":                   "buy",
    "migrated":               false,
    "bnbIn":                  "1000000000000000000",
    "bnbInFormatted":         "1.0",
    "tokensOut":              "780000000000000000000",
    "tokensOutFormatted":     "780.0",
    "spotPriceWei":           "1241000000000",
    "spotPriceBNB":           "0.000001241",
    "effectivePriceWei":      "1282051282051282",
    "effectivePriceBNB":      "0.001282051282051282",
    "priceImpactBps":         "142",
    "priceImpactPct":         "1.42%",
    "slippageBps":            "100",
    "minimumOutput":          "772200000000000000000",
    "minimumOutputFormatted": "772.2",
    "antibotEnabled":         false,
    "tradingBlock":           "96789778"
  }
}
```

### Sell Quote

```bash
curl 'https://api.1coin.meme/api/v1/bsc/tokens/0x7cff...1111/quote/sell?tokensIn=780000000000000000000&slippage=100'
```

```json
{
  "data": {
    "token":                  "0x7cff...1111",
    "type":                   "sell",
    "migrated":               false,
    "tokensIn":               "780000000000000000000",
    "tokensInFormatted":      "780.0",
    "bnbOut":                 "960000000000000000",
    "bnbOutFormatted":        "0.96",
    "spotPriceWei":           "1241000000000",
    "spotPriceBNB":           "0.000001241",
    "effectivePriceWei":      "1230769230769230",
    "effectivePriceBNB":      "0.00123076923076923",
    "priceImpactBps":         "98",
    "priceImpactPct":         "0.98%",
    "slippageBps":            "100",
    "minimumOutput":          "950400000000000000",
    "minimumOutputFormatted": "0.9504",
    "antibotEnabled":         false,
    "tradingBlock":           "96789778"
  }
}
```

---

## 10. Creators — Tokens

```bash
curl 'https://api.1coin.meme/api/v1/bsc/creators/0x25b9...d4d3/tokens?limit=5'
```

Same token object shape as `GET /tokens`, including `priceBnb`, `priceUsd`, `marketCapBnb`, `marketCapUsd`.

```json
{
  "data": [
    {
      "id": "0x7cff...1111",
      "tokenType": "Standard",
      "priceBnb": "0.000001241",
      "priceUsd": "0.0007241800",
      "marketCapUsd": "724.18",
      "...": "..."
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 3, "pages": 1, "hasMore": false }
}
```

---

## 11. Trades — Global

```bash
curl 'https://api.1coin.meme/api/v1/bsc/trades?limit=3&type=buy&orderBy=bnb_amount&orderDir=desc'
```

```json
{
  "data": [
    {
      "id":           "0xtxhash...-12",
      "token":        "0x7cff...1111",
      "tradeType":    "buy",
      "trader":       "0xbuyer...",
      "bnbAmount":    "2000000000000000000",
      "tokenAmount":  "1500000000000000000000",
      "tokensToDead": null,
      "raisedBnb":    "4000000000000000000",
      "blockNumber":  "96791234",
      "txHash":       "0xtxhash...",
      "timestamp":    1773996100
    }
  ],
  "pagination": { "page": 1, "limit": 3, "total": 28, "pages": 10, "hasMore": true }
}
```

---

## 12. Traders — History

```bash
curl 'https://api.1coin.meme/api/v1/bsc/traders/0xbuyer.../trades?limit=5'
```

Same trade object shape as above, filtered to a specific trader's wallet.

---

## 13. Migrations — Global

```bash
curl 'https://api.1coin.meme/api/v1/bsc/migrations?limit=5'
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

## 14. Activity Feed

Returns the 15 most recent create/buy/sell events as a flat array. Used for the header marquee.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/activity'
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

## 15. Activity — SSE Stream

On connect: replays the 15 most recent events oldest-first, then pushes live events as they are indexed.

```bash
curl -N 'https://api.1coin.meme/api/v1/bsc/activity/stream'
# Filter to buys only:
curl -N 'https://api.1coin.meme/api/v1/bsc/activity/stream?type=buy'
# Filter to a specific token:
curl -N 'https://api.1coin.meme/api/v1/bsc/activity/stream?token=0x7cff...1111'
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
const es = new EventSource("https://api.1coin.meme/api/v1/bsc/activity/stream");

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

## 16. Activity — WebSocket

```typescript
const ws = new WebSocket("wss://api.1coin.meme/api/v1/bsc/activity/ws");

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

## 17. Discover — Trending

Tokens with the most buy/sell trades ordered by trade count then volume. Uses a sliding fallback window: `5m` → `1h` → `24h` → `7d` → `30d` — the smallest window with any activity is used. The active window is returned in the `window` field.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/discover/trending?limit=5'
```

```json
{
  "data": [
    {
      "id":                 "0x7cff...1111",
      "tokenType":          "Standard",
      "creator":            "0xcreator...",
      "totalSupply":        "1000000000000000000000000",
      "virtualBnb":         "1000000000000000000",
      "antibotEnabled":     false,
      "tradingBlock":       "96789778",
      "createdAtBlock":     "96789778",
      "createdAtTimestamp": 1773995248,
      "creationTxHash":     "0xcreationtx...",
      "migrated":           false,
      "pairAddress":        null,
      "buyCount":           8,
      "sellCount":          2,
      "volumeBnb":          "3200000000000000000",
      "raisedBnb":          "4000000000000000000",
      "migrationTarget":    "5000000000000000000",
      "creatorTokens":      "0",
      "priceBnb":           "0.000001241",
      "priceUsd":           "0.0007241800",
      "marketCapBnb":       "1.241",
      "marketCapUsd":       "724.18",
      "recentTrades":       12,
      "recentBuys":         9,
      "recentSells":        3,
      "recentVolumeBNB":    "3200000000000000000",
      "metaUri":            "ipfs://QmXyz...",
      "name":               "PEPE2",
      "symbol":             "PEPE2",
      "image":              "https://gateway.pinata.cloud/ipfs/QmImg...",
      "website":            "https://pepe2.io",
      "twitter":            "https://x.com/pepe2bsc",
      "telegram":           "https://t.me/pepe2"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 4, "pages": 1, "hasMore": false },
  "window": "5m"
}
```

---

## 18. Discover — New

```bash
curl 'https://api.1coin.meme/api/v1/bsc/discover/new?limit=5&type=Standard'
```

Returns newest non-migrated tokens, ordered by `createdAtBlock` descending. Same token shape as `/tokens`.

---

## 19. Discover — Graduating

Non-migrated tokens sorted by `raisedBNB` descending (closest to migration target first). Includes `graduatingProgress` (0–100%), `recentTrades` and `recentVolumeBNB` for the last 24 hours. Also available at `/discover/bonding`.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/discover/graduating?limit=5'
```

```json
{
  "data": [
    {
      "id":                   "0xbe5b...1111",
      "tokenType":            "Standard",
      "creator":              "0xcreator...",
      "totalSupply":          "1000000000000000000000000",
      "virtualBnb":           "1000000000000000000",
      "antibotEnabled":       false,
      "tradingBlock":         "96780000",
      "createdAtBlock":       "96780000",
      "createdAtTimestamp":   1773990000,
      "creationTxHash":       "0xcreationtx...",
      "migrated":             false,
      "pairAddress":          null,
      "buyCount":             14,
      "sellCount":            3,
      "volumeBnb":            "4200000000000000000",
      "raisedBnb":            "3800000000000000000",
      "migrationTarget":      "5000000000000000000",
      "creatorTokens":        "0",
      "priceBnb":             "0.000001198",
      "priceUsd":             "0.0006984200",
      "marketCapBnb":         "1.198",
      "marketCapUsd":         "698.42",
      "recentTrades":         7,
      "recentVolumeBNB":      "1200000000000000000",
      "graduatingProgress":   "76.00",
      "metaUri":              "ipfs://QmXyz...",
      "name":                 "PEPE2",
      "symbol":               "PEPE2",
      "image":                "https://gateway.pinata.cloud/ipfs/QmImg...",
      "website":              "https://pepe2.io",
      "twitter":              "https://x.com/pepe2bsc",
      "telegram":             "https://t.me/pepe2"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 2, "pages": 1, "hasMore": false }
}
```

---

## 20. Discover — Migrated

```bash
curl 'https://api.1coin.meme/api/v1/bsc/discover/migrated?orderBy=liquidityBNB&orderDir=desc&limit=5'
```

```json
{
  "data": [
    {
      "id":                 "0x7cff...1111",
      "tokenType":          "Standard",
      "creator":            "0xcreator...",
      "totalSupply":        "1000000000000000000000000",
      "virtualBnb":         "1000000000000000000",
      "antibotEnabled":     false,
      "tradingBlock":       "96789778",
      "createdAtBlock":     "96789778",
      "createdAtTimestamp": 1773995248,
      "creationTxHash":     "0xcreationtx...",
      "migrated":           true,
      "pairAddress":        "0xpair...",
      "buyCount":           6,
      "sellCount":          0,
      "volumeBnb":          "5102040816326530613",
      "raisedBnb":          "5000000000000000001",
      "migrationTarget":    "5000000000000000000",
      "creatorTokens":      "0",
      "priceBnb":           "0.000001241",
      "priceUsd":           "0.0007241800",
      "marketCapBnb":       "1.241",
      "marketCapUsd":       "724.18",
      "liquidityBNB":       "5000000000000000001",
      "liquidityTokens":    "800000000000000000000000",
      "migratedAtBlock":    "96799999",
      "migratedAt":         1774002000,
      "migrationTxHash":    "0xmigrationtx..."
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 1, "pages": 1, "hasMore": false }
}
```

---

## 21. Stats

```bash
curl 'https://api.1coin.meme/api/v1/bsc/stats'
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

## 22. Leaderboard — Tokens

```bash
curl 'https://api.1coin.meme/api/v1/bsc/leaderboard/tokens?period=7d&orderBy=volumeBNB&limit=5'
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

## 23. Leaderboard — Creators

```bash
curl 'https://api.1coin.meme/api/v1/bsc/leaderboard/creators?period=30d&limit=5'
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

## 24. Leaderboard — Traders

```bash
curl 'https://api.1coin.meme/api/v1/bsc/leaderboard/traders?period=1d&limit=5'
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

## 25. Leaderboard — Users

Combined traders + creators sorted by volume then tokens launched.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/leaderboard/users?period=alltime&limit=5'
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

## 26. Charts

### Config

```bash
curl 'https://api.1coin.meme/api/v1/bsc/charts/config'
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
curl 'https://api.1coin.meme/api/v1/bsc/charts/symbols?symbol=0x7cff...1111'
```

```json
{
  "name":                    "0x7cff...1111",
  "ticker":                  "0x7cff...1111",
  "description":             "OneMEME Token (Standard)",
  "type":                    "crypto",
  "session":                 "24x7",
  "timezone":                "Etc/UTC",
  "exchange":                "OneMEME",
  "listed_exchange":         "OneMEME",
  "format":                  "price",
  "pricescale":              1000000000,
  "minmov":                  1,
  "has_intraday":            true,
  "has_daily":               true,
  "has_weekly_and_monthly":  false,
  "supported_resolutions":   ["1", "5", "15", "30", "60", "240", "D"],
  "volume_precision":        4,
  "data_status":             "streaming"
}
```

### OHLCV History

Price is derived from the bonding-curve AMM formula using per-block snapshot data — not raw trade price ratios:
- `virtualLiquidity = virtualBNB + raisedBNB`
- `price (BNB/token) = virtualLiquidity² / (virtualBNB × totalSupply)`

```bash
curl 'https://api.1coin.meme/api/v1/bsc/charts/history?symbol=0x7cff...1111&resolution=15&from=1773990000&to=1774000000'
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

Returns `{ "s": "no_data" }` when no snapshots exist in the requested time range. Migrated tokens return their full bonding-curve history up to the migration block — the chart simply stops updating after that point.

### Search

```bash
curl 'https://api.1coin.meme/api/v1/bsc/charts/search?query=0x7cff&limit=5'
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

## 27. BNB Price

```bash
curl 'https://api.1coin.meme/api/v1/bsc/price/bnb'
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
    { "exchange": "GateIO",    "price": null,   "ok": false, "cachedAt": null }
  ]
}
```

Aggregated from 6 sources: Binance, OKX, Bybit, CoinGecko, MEXC, GateIO. Refreshed every 10 seconds. Average is computed from sources that responded successfully within their TTL window.

---

## 28. Vesting

### By Token

```bash
curl 'https://api.1coin.meme/api/v1/bsc/vesting/0x7cff...1111'
```

```json
{
  "data": [
    {
      "token":       "0x7cff...1111",
      "beneficiary": "0xcreator...",
      "amount":      "50000000000000000000000",
      "blockNumber": "96789778",
      "start":       1773995248,
      "claimed":     "10000000000000000000000",
      "voided":      false,
      "burned":      "0",
      "claimable":   "3561643835616438356164",
      "vestingEnds": 1805531248,
      "progressPct": 36
    }
  ]
}
```

`claimable` — tokens currently unlocked and not yet claimed (linear vesting over 365 days).
`vestingEnds` — unix timestamp when the full schedule unlocks.
`progressPct` — 0–100, percentage of the vesting period elapsed.

### By Creator

```bash
curl 'https://api.1coin.meme/api/v1/bsc/creators/0xcreator.../vesting?limit=5'
```

```json
{
  "data": [
    {
      "token":       "0x7cff...1111",
      "beneficiary": "0xcreator...",
      "amount":      "50000000000000000000000",
      "blockNumber": "96789778",
      "start":       1773995248,
      "claimed":     "10000000000000000000000",
      "voided":      false,
      "burned":      "0",
      "claimable":   "3561643835616438356164",
      "vestingEnds": 1805531248,
      "progressPct": 36,
      "tokenType":   "Standard",
      "totalSupply": "1000000000000000000000000",
      "migrated":    true
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 3, "pages": 1, "hasMore": false }
}
```

---

## 29. Chat

```bash
curl 'https://api.1coin.meme/api/v1/bsc/chat/0x7cff...1111/messages'
```

```json
{
  "data": [
    {
      "id":        "1",
      "token":     "0x7cff...1111",
      "sender":    "0xuser...",
      "text":      "gm, this is going to moon",
      "timestamp": 1774050000
    }
  ]
}
```

---

## 30. Metadata Upload

Upload token metadata and image to IPFS before creating the token on-chain. Returns an `ipfs://` URI to pass to `setMetaURI()`.

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/metadata/upload' \
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
}): Promise<{ metaURI: string }> {
  const form = new FormData();
  form.append("image",       imageFile);
  form.append("name",        fields.name);
  form.append("symbol",      fields.symbol);
  form.append("description", fields.description);
  if (fields.website)  form.append("website",  fields.website);
  if (fields.x)        form.append("x",        fields.x);
  if (fields.telegram) form.append("telegram", fields.telegram);

  const res = await fetch("https://api.1coin.meme/api/v1/bsc/metadata/upload", {
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
  tokenType: "Standard" | "Tax" | "Reflection",
  imageFile: File,
  metadata: { name: string; symbol: string; description: string },
  salt: `0x${string}`, // bytes32 salt passed to the factory
) {
  // 1. Upload metadata to IPFS
  const { metaURI } = await uploadMetadata(imageFile, metadata);

  // 2. Call LaunchpadFactory.createToken()
  const walletClient = createWalletClient({ /* ... */ });
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
