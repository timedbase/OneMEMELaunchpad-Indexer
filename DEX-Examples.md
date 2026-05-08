# DEX API — Endpoint Reference & Examples

Base URL: `https://api.1coin.meme/api/v1/bsc/dex`

All responses use JSON. Paginated responses wrap data in `{ data, pagination }`.
Numeric amounts are always **strings in wei** unless noted otherwise.

**Native BNB:** Pass `0x0000000000000000000000000000000000000000` as `tokenIn` or `tokenOut` in any swap, quote, or route endpoint. The API normalises it to WBNB internally for quoting. Responses include `nativeIn: true` / `nativeOut: true` flags and a `value` field (wei string) indicating how much `msg.value` the caller must attach.

---

## Table of Contents

1. [GET /dex/platforms](#get-dexplatforms)
2. [GET /dex/stats](#get-dexstats)
3. [GET /dex/tokens](#get-dextokens)
4. [GET /dex/tokens/:address](#get-dextokensaddress)
5. [GET /dex/tokens/:address/pools](#get-dextokensaddresspools)
6. [GET /dex/tokens/:address/trades](#get-dextokensaddresstrades)
7. [GET /dex/tokens/:address/security](#get-dextokensaddresssecurity)
8. [POST /dex/tokens/:address/security/refresh](#post-dextokensaddresssecurityrefresh)
9. [GET /dex/swaps](#get-dexswaps)
10. [GET /dex/quote](#get-dexquote)
11. [POST /dex/swap](#post-dexswap)
12. [GET /dex/route](#get-dexroute)

---

## GET /dex/platforms

Returns all supported routing platform names and their categories.
No configuration required — this is a static response.

> **Note:** `PANCAKE_V4` and `UNISWAP_V4` are defined but currently excluded from automatic routing (pool discovery disabled). All other platforms are active.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/platforms'
```

```json
{
  "data": [
    { "name": "PANCAKE_V2",  "category": "amm-v2" },
    { "name": "UNISWAP_V2",  "category": "amm-v2" },
    { "name": "PANCAKE_V3",  "category": "amm-v3" },
    { "name": "UNISWAP_V3",  "category": "amm-v3" },
    { "name": "PANCAKE_V4",  "category": "amm-v4" },
    { "name": "UNISWAP_V4",  "category": "amm-v4" },
    { "name": "ONEMEME_BC",  "category": "bonding-curve" },
    { "name": "FOURMEME",    "category": "bonding-curve" },
    { "name": "FLAPSH",      "category": "bonding-curve" }
  ]
}
```

---

## GET /dex/stats

Platform-level aggregator statistics.
Requires `AGGREGATOR_SUBGRAPH_URL`.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/stats'
```

```json
{
  "data": {
    "bnbPriceUSD": "612.45",
    "lastUpdated": 1745123456,
    "totalSwaps": 48291,
    "totalVolumeBNB": "94823.741",
    "totalFeesBNB": "948.237",
    "uniqueUsers": 7634
  }
}
```

---

## GET /dex/tokens

Paginated list of tokens across all platforms.

**Subgraph routing**

| `platform` filter | Data source |
|---|---|
| `1MEME` | `SUBGRAPH_URL` — main launchpad subgraph |
| `FOURMEME` or `FLAPSH` | `AGGREGATOR_SUBGRAPH_URL` |
| `PANCAKESWAP-V2/V3/V4` | respective PancakeSwap subgraph (The Graph gateway) |
| `UNISWAP-V2/V3/V4` | respective Uniswap subgraph (The Graph gateway) |
| _(omitted)_ | `1MEME` + `FOURMEME` + `FLAPSH` merged; AGGREGATOR wins on duplicate address |

Tokens from the main launchpad subgraph (`source: "main"`) and DEX protocol subgraphs
(`source: "dex"`) have live price/market-cap fields set to `null`.

**Query Parameters**

| Parameter    | Type    | Default              | Description |
|---|---|---|---|
| `platform`   | string  | —                    | `1MEME` \| `FOURMEME` \| `FLAPSH` \| `PANCAKESWAP-V2` \| `PANCAKESWAP-V3` \| `PANCAKESWAP-V4` \| `UNISWAP-V2` \| `UNISWAP-V3` \| `UNISWAP-V4` |
| `bondingPhase` | bool  | —                    | `true` = still on bonding curve, `false` = migrated |
| `search`     | string  | —                    | Case-insensitive symbol substring match |
| `orderBy`    | string  | `createdAtTimestamp` | `createdAtTimestamp` \| `totalVolumeBNB` \| `tradeCount` \| `currentMarketCapBNB` \| `currentLiquidityBNB` |
| `orderDir`   | string  | `desc`               | `asc` \| `desc` |
| `page`       | number  | `1`                  | Page number |
| `limit`      | number  | `20`                 | Items per page (max 100) |

**FOURMEME tokens on bonding curve**

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/tokens?platform=FOURMEME&bondingPhase=true&orderBy=totalVolumeBNB&limit=2'
```

```json
{
  "data": [
    {
      "address": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
      "name": "PepeBSC",
      "symbol": "PEPEBSC",
      "decimals": 18,
      "platforms": ["FOURMEME"],
      "bondingPhase": true,
      "bondingCurve": null,
      "pairAddress": null,
      "currentPriceBNB": "0.000000812",
      "currentPriceUSD": "0.000497",
      "currentMarketCapBNB": "8.12",
      "currentMarketCapUSD": "4972.54",
      "currentLiquidityBNB": "12.48",
      "totalVolumeBNB": "841200000000000000000",
      "dexVolumeBNB": "12.48",
      "tradeCount": 1847,
      "createdAtTimestamp": 1745001234,
      "source": "aggregator"
    },
    {
      "address": "0xb4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3",
      "name": "MoonDoge",
      "symbol": "MDOGE",
      "decimals": 18,
      "platforms": ["FOURMEME"],
      "bondingPhase": true,
      "bondingCurve": null,
      "pairAddress": null,
      "currentPriceBNB": "0.000001204",
      "currentPriceUSD": "0.000737",
      "currentMarketCapBNB": "12.04",
      "currentMarketCapUSD": "7371.18",
      "currentLiquidityBNB": "18.76",
      "totalVolumeBNB": "694200000000000000000",
      "dexVolumeBNB": "0",
      "tradeCount": 1203,
      "createdAtTimestamp": 1745009876,
      "source": "aggregator"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 2,
    "total": 1482,
    "pages": 741,
    "hasMore": true
  }
}
```

**1MEME tokens** — price/market-cap fields are `null` for MAIN-sourced tokens

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/tokens?platform=1MEME&bondingPhase=true&limit=1'
```

```json
{
  "data": [
    {
      "address": "0xc5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
      "name": "StarMeme",
      "symbol": "STAR",
      "decimals": 18,
      "platforms": ["ONEMEME"],
      "bondingPhase": true,
      "bondingCurve": null,
      "pairAddress": null,
      "currentPriceBNB": null,
      "currentPriceUSD": null,
      "currentMarketCapBNB": null,
      "currentMarketCapUSD": null,
      "currentLiquidityBNB": null,
      "totalVolumeBNB": "38.74",
      "tradeCount": 412,
      "createdAtTimestamp": 1745020100,
      "source": "main"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 1,
    "total": 834,
    "pages": 834,
    "hasMore": true
  }
}
```

---

## GET /dex/tokens/:address

Full detail for a single token.
Lookup order: AGGREGATOR → MAIN → all 6 DEX protocol subgraphs (parallel).

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/tokens/0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0'
```

**Response — FOURMEME / FLAPSH token (from aggregator)**
```json
{
  "data": {
    "address": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "name": "PepeBSC",
    "symbol": "PEPEBSC",
    "decimals": 18,
    "platforms": ["FOURMEME"],
    "bondingPhase": true,
    "bondingCurve": null,
    "pairAddress": null,
    "currentPriceBNB": "0.000000812",
    "currentPriceUSD": "0.000497",
    "currentMarketCapBNB": "8.12",
    "currentMarketCapUSD": "4972.54",
    "currentLiquidityBNB": "12.48",
    "totalVolumeBNB": "841200000000000000000",
    "dexVolumeBNB": "12.48",
    "tradeCount": 1847,
    "createdAtTimestamp": 1745001234,
    "source": "aggregator"
  }
}
```

**Response — 1MEME token (from main launchpad subgraph)**
```json
{
  "data": {
    "address": "0xc5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
    "name": "StarMeme",
    "symbol": "STAR",
    "decimals": 18,
    "platforms": ["ONEMEME"],
    "bondingPhase": true,
    "bondingCurve": null,
    "pairAddress": null,
    "currentPriceBNB": null,
    "currentPriceUSD": null,
    "currentMarketCapBNB": null,
    "currentMarketCapUSD": null,
    "currentLiquidityBNB": null,
    "totalVolumeBNB": "38.74",
    "tradeCount": 412,
    "createdAtTimestamp": 1745020100,
    "source": "main"
  }
}
```

**Response — DEX protocol token (e.g. PANCAKESWAP-V2)**
```json
{
  "data": {
    "address": "0x55d398326f99059ff775485246999027b3197955",
    "name": "Tether USD",
    "symbol": "USDT",
    "decimals": 18,
    "platforms": ["PANCAKESWAP-V2"],
    "bondingPhase": false,
    "bondingCurve": null,
    "pairAddress": null,
    "currentPriceBNB": null,
    "currentPriceUSD": null,
    "currentMarketCapBNB": null,
    "currentMarketCapUSD": null,
    "currentLiquidityBNB": null,
    "totalVolumeBNB": null,
    "dexVolumeBNB": null,
    "tradeCount": 248193,
    "createdAtTimestamp": 0,
    "source": "dex"
  }
}
```

**Error — not found**
```json
{ "statusCode": 404, "message": "Token 0x... not found" }
```

---

## GET /dex/tokens/:address/pools

DEX pools containing this token across all supported AMMs (V2/V3/V4).
Each protocol is queried from its own subgraph (V3/V4 via The Graph gateway, V2 via NodeReal).
Requires `THE_GRAPH_API_KEY` for V3/V4 endpoints unless per-protocol URL overrides are set.

**Query Parameters**

| Parameter | Type   | Default | Description |
|---|---|---|---|
| `dex`     | string | —       | Filter by protocol: `PANCAKE_V2` \| `PANCAKE_V3` \| `PANCAKE_V4` \| `UNISWAP_V2` \| `UNISWAP_V3` \| `UNISWAP_V4` |
| `page`    | number | `1`     | |
| `limit`   | number | `20`    | |

**Pool shape**

| Field              | V2                    | V3 / V4              |
|---|---|---|
| `feeTier`          | `null`                | fee in bps (e.g. 500) |
| `liquidity`        | reserve in USD (`reserveUSD`) | raw sqrt-price liquidity |
| `volumeUSD`        | cumulative volume USD | cumulative volume USD |
| `txCount`          | swap count            | swap count           |

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/tokens/0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0/pools'
```

```json
{
  "data": [
    {
      "address": "0xf9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0",
      "dex": "PANCAKE_V2",
      "poolType": "V2",
      "feeTier": null,
      "token0": {
        "address": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
        "symbol": "PEPEBSC"
      },
      "token1": {
        "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "symbol": "WBNB"
      },
      "liquidity": "184293.52",
      "volumeUSD": "112847.30",
      "txCount": 3841,
      "createdAtTimestamp": 1745002100
    },
    {
      "address": "0xe0d1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9",
      "dex": "PANCAKE_V3",
      "poolType": "V3",
      "feeTier": 500,
      "token0": {
        "address": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
        "symbol": "PEPEBSC"
      },
      "token1": {
        "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "symbol": "WBNB"
      },
      "liquidity": "2391847000000000000000",
      "volumeUSD": "35418.91",
      "txCount": 924,
      "createdAtTimestamp": 1745003600
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 2,
    "pages": 1,
    "hasMore": false
  }
}
```

---

## GET /dex/tokens/:address/trades

Combined bonding-curve trades and aggregator swaps for a token, sorted by timestamp descending.

**Subgraph routing**

| Trade type | Source |
|---|---|
| 1MEME bonding-curve buys/sells | `SUBGRAPH_URL` (main launchpad) |
| FOURMEME / FLAPSH bonding-curve buys/sells | `AGGREGATOR_SUBGRAPH_URL` |
| DEX swaps | `AGGREGATOR_SUBGRAPH_URL` |

Bonding trades are deduplicated by `txHash` — the aggregator subgraph may re-index 1MEME
trades, so AGGREGATOR always wins when both sources have the same hash.

**Query Parameters**

| Parameter | Type   | Default | Description |
|---|---|---|---|
| `source`  | string | —       | `bonding` = bonding-curve only, `dex` = aggregator swaps only, omit for all |
| `page`    | number | `1`     | |
| `limit`   | number | `20`    | |

**Response shape differs by source**

Bonding trade (`source: "bonding"`):
```
id, token, tokenName, tokenSymbol, trader, tradeType, bnbAmount, tokenAmount, platform, timestamp, txHash, source
```

DEX swap (`source: "dex"`):
```
id, user, adapterId, adapterName, tokenIn, tokenOut, grossAmountIn, feeCharged, amountOut, timestamp, txHash, source
```

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/tokens/0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0/trades?limit=2'
```

```json
{
  "data": [
    {
      "id": "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc123-3",
      "user": "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
      "adapterId": "0xa1b2a1b2...",
      "adapterName": "PANCAKE_V2",
      "tokenIn": {
        "address": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
        "symbol": "PEPEBSC"
      },
      "tokenOut": {
        "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "symbol": "WBNB"
      },
      "grossAmountIn": "500000000000000000000000",
      "feeCharged": "2500000000000000000000",
      "amountOut": "405000000000000000",
      "timestamp": 1745123400,
      "txHash": "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc123",
      "source": "dex"
    },
    {
      "id": "0xdef789abc012def789abc012def789abc012def789abc012def789abc012def789-1",
      "token": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
      "tokenName": "PepeBSC",
      "tokenSymbol": "PEPEBSC",
      "trader": "0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b",
      "tradeType": "buy",
      "bnbAmount": "500000000000000000",
      "tokenAmount": "612345000000000000000000",
      "platform": "FOURMEME",
      "timestamp": 1745123100,
      "txHash": "0xdef789abc012def789abc012def789abc012def789abc012def789abc012def789",
      "source": "bonding"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 2,
    "total": 1847,
    "pages": 924,
    "hasMore": true
  }
}
```

---

## GET /dex/tokens/:address/security

GoPlus Security report for a token. Returns honeypot status, transfer tax rates, ownership risks, trading restrictions, and a derived `riskLevel` + `warnings[]` array ready for frontend display.

**`dataAvailable: false`** means GoPlus has no record for this address (token is very new or not yet indexed). All flags will be `false` / `null` — this does **not** mean the token is safe; treat it as unknown.

Tax rates from this endpoint are also used internally by `GET /dex/quote`, `GET /dex/route`, and `POST /dex/swap` to correct `minOut` for fee-on-transfer tokens.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/tokens/0xe43ef1fe041ba9e8da87e8c5bfd583b3b46a1111/security'
```

```json
{
  "address":               "0xe43ef1fe041ba9e8da87e8c5bfd583b3b46a1111",
  "tokenName":             "1COIN",
  "tokenSymbol":           "1COIN",
  "isHoneypot":            false,
  "cannotBuy":             false,
  "cannotSellAll":         false,
  "transferPausable":      false,
  "buyTax":                "0.05",
  "sellTax":               "0.05",
  "buyTaxBps":             500,
  "sellTaxBps":            500,
  "isBlacklisted":         true,
  "isMintable":            false,
  "isProxy":               false,
  "isOpenSource":          true,
  "canTakeBackOwnership":  false,
  "ownerChangeBalance":    false,
  "hiddenOwner":           false,
  "selfDestruct":          false,
  "externalCall":          false,
  "isFakeToken":           false,
  "isAntiWhale":           false,
  "antiWhaleModifiable":   false,
  "tradingCooldown":       false,
  "slippageModifiable":    false,
  "holderCount":           "1842",
  "totalSupply":           "1000000000000000000000000000",
  "ownerAddress":          "0x0000000000000000000000000000000000000000",
  "creatorAddress":        "0xdeadbeef...",
  "isInDex":               true,
  "dex": [
    { "name": "PancakeV2", "liquidity": "142300", "pair": "0xpair..." }
  ],
  "holders": [
    { "address": "0x...", "tag": "PancakeV2", "is_locked": 0, "balance": "5e+26", "percent": "0.5", "is_contract": 1 }
  ],
  "riskLevel":   "medium",
  "warnings": [
    "Contract has a blacklist function",
    "Buy tax: 5.00%",
    "Sell tax: 5.00%"
  ],
  "note":          null,
  "dataAvailable": true
}
```

**`riskLevel` values:**

| Level | Triggered by |
|---|---|
| `unknown` | GoPlus has no data for this token |
| `low` | Minor flags only (small tax, anti-whale, unverified source) |
| `medium` | Tax > 10%, mintable supply, upgradeable proxy, owner can modify balances or slippage |
| `high` | Blacklist, cannot buy, cannot sell all, hidden owner, pausable transfers, owner can reclaim ownership |
| `critical` | Honeypot or fake/imitation token |

**`taxBps` in swap responses:**

When a V2 route involves a fee-on-transfer token, each step in `steps[]` will include a `taxBps` field:

```json
{
  "adapter":   "PANCAKE_V2",
  "tokenIn":   "0xe43ef1fe041ba9e8da87e8c5bfd583b3b46a1111",
  "tokenOut":  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  "amountOut": "47500000000000000",
  "minOut":    "47025000000000000",
  "taxBps":    500
}
```

`taxBps` is `null` for non-tax tokens and non-V2 adapters.

---

## POST /dex/tokens/:address/security/refresh

Evicts the cached GoPlus report for a token and immediately re-fetches from GoPlus. Returns the fresh `TokenSecurityReport` in the same shape as `GET /dex/tokens/:address/security`.

Use this when a token's on-chain properties have changed (e.g. ownership renounced, liquidity locked) and the 12-hour cached report is stale.

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/dex/tokens/0xe43ef1fe041ba9e8da87e8c5bfd583b3b46a1111/security/refresh'
```

Response is identical in shape to `GET /dex/tokens/:address/security` — see that section for the full field reference.

---

## GET /dex/swaps

Paginated list of all aggregator swaps indexed from the aggregator subgraph.
Always reads from `AGGREGATOR_SUBGRAPH_URL`.

**Query Parameters**

| Parameter  | Type   | Default | Description |
|---|---|---|---|
| `user`     | string | —       | Filter by trader address |
| `adapter`  | string | —       | Filter by adapter name (e.g. `PANCAKE_V3`) |
| `tokenIn`  | string | —       | Filter by input token address |
| `tokenOut` | string | —       | Filter by output token address |
| `from`     | number | —       | Unix timestamp lower bound (inclusive) |
| `to`       | number | —       | Unix timestamp upper bound (inclusive) |
| `page`     | number | `1`     | |
| `limit`    | number | `20`    | Max 100 |

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/swaps?adapter=PANCAKE_V3&limit=2'
```

```json
{
  "data": [
    {
      "id": "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc123-2",
      "user": "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
      "adapterId": "0xc3d4c3d4...",
      "adapterName": "PANCAKE_V3",
      "tokenIn": {
        "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "symbol": "WBNB"
      },
      "tokenOut": {
        "address": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
        "symbol": "PEPEBSC"
      },
      "grossAmountIn": "1000000000000000000",
      "feeCharged": "5000000000000000",
      "amountOut": "1218432000000000000000000",
      "timestamp": 1745123456,
      "txHash": "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc123"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 2,
    "total": 48291,
    "pages": 24146,
    "hasMore": true
  }
}
```

---

## GET /dex/quote

Live on-chain quote — simulates expected output before committing to a swap.
Use this to calculate `amountOut` and `minOut` before calling `POST /dex/swap`.

Queries all liquidity sources in parallel and returns the best price. `sources[]` lists every source tried, sorted best-first.

**Query Parameters**

| Parameter  | Type   | Required | Description |
|---|---|---|---|
| `tokenIn`  | string | Yes | Input token address |
| `amountIn` | string | Yes | Input amount in wei (must be a string) |
| `tokenOut` | string | Yes | Output token address |
| `slippage` | number | No  | Slippage tolerance in basis points, default `100` (1%) |

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/quote?tokenIn=0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c&amountIn=1000000000000000000&tokenOut=0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0&slippage=100'
```

```json
{
  "data": {
    "adapter":        "PANCAKE_V3",
    "tokenIn":        "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "tokenOut":       "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "nativeIn":       false,
    "nativeOut":      false,
    "value":          "0",
    "amountIn":       "1000000000000000000",
    "amountOut":      "1248300000000000000000000",
    "minOut":         "1235817000000000000000000",
    "aggregatorFee":  "5000000000000000",
    "bondingFee":     null,
    "slippageBps":    "100",
    "quotedBy":       "aggregation",
    "path":           ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0"],
    "fees":           [500],
    "tickSpacing":    null,
    "hooks":          null,
    "sources": [
      { "adapter": "PANCAKE_V3", "fees": [500],  "amountOut": "1248300000000000000000000" },
      { "adapter": "PANCAKE_V2", "fees": null,   "amountOut": "1231847000000000000000000" },
      { "adapter": "UNISWAP_V3", "fees": [3000], "amountOut": "1219400000000000000000000" }
    ]
  }
}
```

**Error — no liquidity found**
```json
{ "statusCode": 503, "message": "No route found — no liquidity source returned a valid quote for this pair" }
```

---

## POST /dex/swap

Builds ABI-encoded calldata for `OneDex.execute()`.
The caller broadcasts this transaction themselves — no relayer, not gasless.

OneDex charges a **0.5% protocol fee** on `amountIn`; the response includes `feeEstimate`.
The `feeOnInput` flag (encoded into `executionData`) tells OneDex whether to deduct the fee from the input (known-safe tokens: WBNB, USDT, USDC, etc.) or the output (fee-on-transfer tokens).

**Body:** `{ tokenIn, amountIn, tokenOut, to, deadline, slippage? }`

Aggregates all sources, picks the best, computes `minOut` from `slippage`. `sources[]` shows all tried. When the best route is a two-step bridge (tokenIn → WBNB → tokenOut via a BC adapter), multi-step `executionData` is returned automatically and `singleStep` is `false`.

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/dex/swap' \
  -H 'Content-Type: application/json' \
  -d '{
  "tokenIn":  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  "amountIn": "1000000000000000000",
  "tokenOut": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
  "to":       "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
  "deadline": "1745130000",
  "slippage": "100"
}'
```

> **Gas limit:** Always use the `gasLimit` field from the response when broadcasting. Do **not** rely on `eth_estimateGas` — if the simulation state differs from execution state the estimate fails and wallets fall back to a dangerously low default, causing out-of-gas reverts.

**Response — single-step route (WBNB → token via PANCAKE_V3)**
```json
{
  "data": {
    "to":          "0xOneDexContractAddress",
    "calldata":    "0x...",
    "value":       "0",
    "gasLimit":    "250000",
    "nativeIn":    false,
    "nativeOut":   false,
    "singleStep":  true,
    "tokenIn":     "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "tokenOut":    "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "amountIn":    "1000000000000000000",
    "feeEstimate": "5000000000000000",
    "netAmountIn": "995000000000000000",
    "minOut":      "1235817000000000000000000",
    "slippageBps": "100",
    "deadline":    "1745130000",
    "steps": [
      {
        "adapter":     "PANCAKE_V3",
        "tokenIn":     "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "tokenOut":    "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
        "amountIn":    "1000000000000000000",
        "amountOut":   "1248300000000000000000000",
        "minOut":      "1235817000000000000000000",
        "fees":        [500],
        "tickSpacing": null,
        "hooks":       null
      }
    ],
    "sources": [
      { "adapter": "PANCAKE_V3", "fees": [500],  "amountOut": "1248300000000000000000000" },
      { "adapter": "PANCAKE_V2", "fees": null,   "amountOut": "1231847000000000000000000" }
    ]
  }
}
```

**Response — native BNB → 1MEME bonding-curve token (single step)**

Pass `tokenIn: "0x0000000000000000000000000000000000000000"` for native BNB.
Set `value` equal to `amountIn` when broadcasting.

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/dex/swap' \
  -H 'Content-Type: application/json' \
  -d '{
  "tokenIn":  "0x0000000000000000000000000000000000000000",
  "amountIn": "500000000000000000",
  "tokenOut": "0xc5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
  "to":       "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
  "deadline": "1745130000",
  "slippage": "150"
}'
```

```json
{
  "data": {
    "to":          "0xOneDexContractAddress",
    "calldata":    "0x...",
    "value":       "500000000000000000",
    "gasLimit":    "250000",
    "nativeIn":    true,
    "nativeOut":   false,
    "singleStep":  true,
    "tokenIn":     "0x0000000000000000000000000000000000000000",
    "tokenOut":    "0xc5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
    "amountIn":    "500000000000000000",
    "feeEstimate": "2500000000000000",
    "netAmountIn": "497500000000000000",
    "minOut":      "3451820000000000000000",
    "slippageBps": "150",
    "deadline":    "1745130000",
    "steps": [
      {
        "adapter":  "ONEMEME_BC",
        "tokenIn":  "0x0000000000000000000000000000000000000000",
        "tokenOut": "0xc5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
        "amountIn": "500000000000000000",
        "amountOut": "3504386000000000000000",
        "minOut":   "3451820000000000000000",
        "fees":     null
      }
    ],
    "sources": [
      { "adapter": "ONEMEME_BC", "fees": null, "amountOut": "3504386000000000000000" },
      { "adapter": "PANCAKE_V2", "fees": null, "amountOut": "3201000000000000000000" }
    ]
  }
}
```

**Response — two-step bridge route** (ERC20 tokenIn → WBNB → BC token, `singleStep: false`)

When neither tokenIn nor tokenOut is WBNB/BNB and a bonding-curve adapter wins, the router automatically prepends a tokenIn → WBNB AMM hop. OneDex unwraps WBNB to native BNB internally before the BC buy step.

```json
{
  "data": {
    "to":          "0xOneDexContractAddress",
    "calldata":    "0x...",
    "value":       "0",
    "gasLimit":    "550000",
    "nativeIn":    false,
    "nativeOut":   false,
    "singleStep":  false,
    "tokenIn":     "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    "tokenOut":    "0xc5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
    "amountIn":    "5000000000000000000",
    "feeEstimate": "25000000000000000",
    "netAmountIn": "4975000000000000000",
    "minOut":      "3505576500000000000000",
    "slippageBps": "150",
    "deadline":    "1745130000",
    "steps": [
      {
        "adapter":  "PANCAKE_V3",
        "tokenIn":  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        "tokenOut": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "amountIn": "5000000000000000000",
        "amountOut": "8621500000000000",
        "minOut":   "8492277500000000",
        "fees":     [500]
      },
      {
        "adapter":  "ONEMEME_BC",
        "tokenIn":  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "tokenOut": "0xc5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
        "amountIn": "8621500000000000",
        "amountOut": "3558900000000000000000",
        "minOut":   "3505576500000000000000",
        "fees":     null
      }
    ],
    "sources": [
      { "adapter": "PANCAKE_V3→ONEMEME_BC", "fees": [500], "amountOut": "3558900000000000000000" },
      { "adapter": "PANCAKE_V2",            "fees": null,  "amountOut": "3102000000000000000000" }
    ]
  }
}
```

---

## GET /dex/route

Returns an optimally routed swap plan for inspection — does **not** build calldata.
Use `POST /dex/swap` to get ready-to-broadcast calldata.

Queries PancakeSwap V2/V3, Uniswap V2/V3, and bonding-curve protocols (ONEMEME_BC, FOURMEME, FLAPSH) in parallel. V3 pool candidates are discovered from their subgraphs first so only real pools with liquidity are quoted. When neither tokenIn nor tokenOut is WBNB and a BC adapter wins, a two-step bridge route is returned automatically (`singleStep: false`). `sources[]` lists every source with its quoted output.

**Query Parameters**

| Parameter  | Required | Description |
|---|---|---|
| `tokenIn`  | Yes | Input token address |
| `amountIn` | Yes | Input amount in wei (string) |
| `tokenOut` | Yes | Output token address |
| `slippage` | No  | Slippage in basis points (default `100` = 1%) |

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/route?tokenIn=0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c&amountIn=1000000000000000000&tokenOut=0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0&slippage=100'
```

```json
{
  "data": {
    "singleStep":    true,
    "nativeIn":      false,
    "nativeOut":     false,
    "value":         "0",
    "steps": [
      {
        "adapter":     "PANCAKE_V3",
        "tokenIn":     "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "tokenOut":    "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
        "amountIn":    "1000000000000000000",
        "amountOut":   "1248300000000000000000000",
        "minOut":      "1235817000000000000000000",
        "fees":        [500],
        "tickSpacing": null,
        "hooks":       null
      }
    ],
    "amountIn":      "1000000000000000000",
    "minFinalOut":   "1235817000000000000000000",
    "aggregatorFee": "5000000000000000",
    "slippageBps":   "100",
    "sources": [
      { "adapter": "PANCAKE_V3", "fees": [500],  "amountOut": "1248300000000000000000000" },
      { "adapter": "PANCAKE_V2", "fees": null,   "amountOut": "1231847000000000000000000" },
      { "adapter": "UNISWAP_V3", "fees": [3000], "amountOut": "1219400000000000000000000" }
    ]
  }
}
```

Step fields: `adapter`, `tokenIn`, `tokenOut`, `amountIn`, `amountOut`, `minOut`, `fees`, `tickSpacing`, `hooks`, `taxBps` (V2 FOT tokens only). No `adapterId` or `adapterData` — calldata is built server-side by `POST /dex/swap`.

**Error — no liquidity found**
```json
{ "statusCode": 503, "message": "No route found — no liquidity source returned a valid quote for this pair" }
```

**Native BNB** — pass `0x0000000000000000000000000000000000000000` as `tokenIn` or `tokenOut`. When `nativeIn: true`, attach `value` wei as `msg.value` when broadcasting via `POST /dex/swap`.

**Two-step bridge example** — USDC → 1MEME bonding-curve token:

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/route?tokenIn=0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d&amountIn=5000000000000000000&tokenOut=0xMEME&slippage=150'
```

```json
{
  "data": {
    "singleStep":    false,
    "nativeIn":      false,
    "nativeOut":     false,
    "value":         "0",
    "steps": [
      {
        "adapter":  "PANCAKE_V3",
        "tokenIn":  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        "tokenOut": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "amountIn": "5000000000000000000",
        "amountOut": "8621500000000000",
        "minOut":   "8492277500000000",
        "fees":     [500]
      },
      {
        "adapter":  "ONEMEME_BC",
        "tokenIn":  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "tokenOut": "0x000000000000000000000000000000000000meme",
        "amountIn": "8621500000000000",
        "amountOut": "3558900000000000000000",
        "minOut":   "3505576500000000000000",
        "fees":     null
      }
    ],
    "amountIn":      "5000000000000000000",
    "minFinalOut":   "3505576500000000000000",
    "aggregatorFee": "25000000000000000",
    "slippageBps":   "150",
    "sources": [
      { "adapter": "PANCAKE_V3→ONEMEME_BC", "fees": [500], "amountOut": "3558900000000000000000" },
      { "adapter": "PANCAKE_V2",            "fees": null,  "amountOut": "3102000000000000000000" }
    ]
  }
}
```

---

## Error Reference

| Status | Cause |
|---|---|
| `400 Bad Request` | Invalid address, bad amounts, unknown adapter name, missing fees, expired deadline |
| `404 Not Found` | Token address not found in either subgraph |
| `503 Service Unavailable` | Required env var not set (`AGGREGATOR_SUBGRAPH_URL`, `THE_GRAPH_API_KEY`, `BSC_RPC_URL`, `ONEDEX_ADDRESS`, etc.) or upstream RPC/subgraph unreachable |

---

## Environment Variables

### Subgraph endpoints

| Variable | Required | Description |
|---|---|---|
| `SUBGRAPH_URL` | Yes (read: 1MEME tokens/trades) | Main launchpad subgraph GraphQL endpoint |
| `SUBGRAPH_API_KEY` | No | Bearer token for the main launchpad subgraph |
| `AGGREGATOR_SUBGRAPH_URL` | Yes (read: FOURMEME/FLAPSH + DEX swaps) | Aggregator subgraph endpoint |
| `AGGREGATOR_SUBGRAPH_API_KEY` | No | Bearer token for the aggregator subgraph |
| `THE_GRAPH_API_KEY` | Yes (V3 pools) | The Graph gateway API key for PancakeSwap V3 and Uniswap V2/V3 subgraphs |
| `PANCAKE_V2_SUBGRAPH_URL` | No | Override default NodeReal PancakeSwap V2 endpoint |
| `PANCAKE_V3_SUBGRAPH_URL` | No | Override default The Graph PancakeSwap V3 endpoint |
| `PANCAKE_V4_SUBGRAPH_URL` | No | Override default The Graph PancakeSwap V4 endpoint _(unused while V4 routing is disabled)_ |
| `UNISWAP_V2_SUBGRAPH_URL` | No | Override default The Graph Uniswap V2 endpoint |
| `UNISWAP_V3_SUBGRAPH_URL` | No | Override default The Graph Uniswap V3 endpoint |
| `UNISWAP_V4_SUBGRAPH_URL` | No | Override default The Graph Uniswap V4 endpoint _(unused while V4 routing is disabled)_ |

### Contracts and RPC

| Variable | Required | Description |
|---|---|---|
| `ONEDEX_ADDRESS` | Yes (`POST /dex/swap`) | OneDex contract address |
| `BSC_RPC_URL` | Yes (quotes) | BSC HTTP RPC for contract reads |
| `BONDING_CURVE_ADDRESS` | Yes (ONEMEME_BC routes) | OneMEME BondingCurve contract address |
| `FOURMEME_HELPER_ADDRESS` | No | FourMEME TokenManagerHelper3 (default: BSC mainnet) |
| `FLAPSH_PORTAL_ADDRESS` | No | Flap.SH Portal (default: BSC mainnet) |
| `PANCAKE_V2_ROUTER_ADDRESS` | No | PancakeSwap V2 Router (default: BSC mainnet) |
| `PANCAKE_V3_ROUTER_ADDRESS` | No | PancakeSwap V3 SmartRouter for execution (default: BSC mainnet) |
| `PANCAKE_V3_QUOTER_ADDRESS` | No | PancakeSwap V3 QuoterV2 for quoting (default: BSC mainnet) |
| `UNISWAP_V2_ROUTER_ADDRESS` | No | Uniswap V2 Router (default: BSC mainnet) |
| `UNISWAP_V3_ROUTER_ADDRESS` | No | Uniswap V3 Router for execution (no BSC default; set if deployed) |
| `UNISWAP_V3_QUOTER_ADDRESS` | No | Uniswap V3 Quoter for quoting (no BSC default; set if deployed) |
| `PANCAKE_V4_QUOTER_ADDRESS` | No | PancakeSwap V4 Quoter _(unused while V4 routing is disabled)_ |
| `UNISWAP_V4_QUOTER_ADDRESS` | No | Uniswap V4 Quoter _(unused while V4 routing is disabled)_ |

### Security

| Variable | Required | Description |
|---|---|---|
| `GOPLUS_APP_KEY` | No | GoPlus app key. Paired with `GOPLUS_APP_SECRET` to obtain a Bearer access token via `POST /api/v1/token` (sign = SHA1(app_key + unix_time + app_secret)). Omit both to use the unauthenticated free tier (rate-limited). Get credentials at [docs.gopluslabs.io](https://docs.gopluslabs.io). |
| `GOPLUS_APP_SECRET` | No | GoPlus app secret. Required alongside `GOPLUS_APP_KEY`. |
