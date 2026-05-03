# DEX API — Endpoint Reference & Examples

Base URL: `https://your-api.example.com/api/v1/bsc/dex`

All responses use JSON. Paginated responses wrap data in `{ data, pagination }`.
Numeric amounts are always **strings in wei** unless noted otherwise.

**Native BNB:** Pass `0x0000000000000000000000000000000000000000` as `tokenIn` or `tokenOut` in any swap, quote, or route endpoint. The API normalises it to WBNB internally. Responses include `nativeIn: true` / `nativeOut: true` flags and a `value` field (wei string) indicating how much `msg.value` the caller must attach.

---

## Table of Contents

1. [GET /dex/adapters](#get-dexadapters)
2. [GET /dex/stats](#get-dexstats)
3. [GET /dex/tokens](#get-dextokens)
4. [GET /dex/tokens/:address](#get-dextokensaddress)
5. [GET /dex/tokens/:address/pools](#get-dextokensaddresspools)
6. [GET /dex/tokens/:address/trades](#get-dextokensaddresstrades)
7. [GET /dex/swaps](#get-dexswaps)
8. [GET /dex/metatx/nonce/:user](#get-dexmetatxnonceuser)
9. [GET /dex/quote](#get-dexquote)
10. [POST /dex/swap](#post-dexswap)
11. [POST /dex/metatx/digest](#post-dexmetatxdigest)
12. [POST /dex/metatx/relay](#post-dexmetatxrelay)
13. [GET /dex/route](#get-dexroute)
14. [POST /dex/batch-swap](#post-dexbatch-swap)
15. [POST /dex/metatx/batch-digest](#post-dexmetatxbatch-digest)
16. [POST /dex/metatx/batch-relay](#post-dexmetatxbatch-relay)

---

## GET /dex/adapters

Returns all supported routing adapters and their on-chain `bytes32` IDs.
No configuration required — this is a static response.

**Request**
```
GET /api/v1/bsc/dex/adapters
```

**Response**
```json
{
  "data": [
    {
      "name": "ONEMEME_BC",
      "id": "0x3a6f3a6f3a6f3a6f3a6f3a6f3a6f3a6f3a6f3a6f3a6f3a6f3a6f3a6f3a6f3a6f",
      "category": "bonding-curve"
    },
    {
      "name": "FOURMEME",
      "id": "0x7b2c7b2c7b2c7b2c7b2c7b2c7b2c7b2c7b2c7b2c7b2c7b2c7b2c7b2c7b2c7b2c",
      "category": "bonding-curve"
    },
    {
      "name": "FLAPSH",
      "id": "0x9d4e9d4e9d4e9d4e9d4e9d4e9d4e9d4e9d4e9d4e9d4e9d4e9d4e9d4e9d4e9d4e",
      "category": "bonding-curve"
    },
    {
      "name": "PANCAKE_V2",
      "id": "0xa1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2",
      "category": "amm-v2"
    },
    {
      "name": "PANCAKE_V3",
      "id": "0xc3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4",
      "category": "amm-v3"
    },
    {
      "name": "PANCAKE_V4",
      "id": "0xe5f6e5f6e5f6e5f6e5f6e5f6e5f6e5f6e5f6e5f6e5f6e5f6e5f6e5f6e5f6e5f6",
      "category": "amm-v4"
    },
    {
      "name": "UNISWAP_V2",
      "id": "0xf7a8f7a8f7a8f7a8f7a8f7a8f7a8f7a8f7a8f7a8f7a8f7a8f7a8f7a8f7a8f7a8",
      "category": "amm-v2"
    },
    {
      "name": "UNISWAP_V3",
      "id": "0x11b211b211b211b211b211b211b211b211b211b211b211b211b211b211b211b211",
      "category": "amm-v3"
    },
    {
      "name": "UNISWAP_V4",
      "id": "0x22c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322",
      "category": "amm-v4"
    }
  ]
}
```

---

## GET /dex/stats

Platform-level aggregator statistics.
Requires `AGGREGATOR_SUBGRAPH_URL`.

**Request**
```
GET /api/v1/bsc/dex/stats
```

**Response**
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

**Request — FOURMEME tokens on bonding curve**
```
GET /api/v1/bsc/dex/tokens?platform=FOURMEME&bondingPhase=true&orderBy=totalVolumeBNB&limit=2
```

**Response**
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

**Request — 1MEME tokens (main launchpad subgraph)**
```
GET /api/v1/bsc/dex/tokens?platform=1MEME&bondingPhase=true&limit=1
```

**Response** — price/market-cap fields are `null` for MAIN-sourced tokens
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

**Request**
```
GET /api/v1/bsc/dex/tokens/0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0
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

**Request**
```
GET /api/v1/bsc/dex/tokens/0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0/pools
```

**Response**
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
| DEX swaps via OneMEMEAggregator | `AGGREGATOR_SUBGRAPH_URL` |

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

**Request**
```
GET /api/v1/bsc/dex/tokens/0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0/trades?limit=2
```

**Response** — mixed bonding and DEX trades
```json
{
  "data": [
    {
      "id": "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc123-3",
      "user": "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
      "adapterId": "0xa1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2",
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
      "feeCharged": "5000000000000000000000",
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

## GET /dex/swaps

Paginated list of all aggregator swaps (OneMEMEAggregator `Swapped` events).
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

**Request**
```
GET /api/v1/bsc/dex/swaps?adapter=PANCAKE_V3&limit=2
```

**Response**
```json
{
  "data": [
    {
      "id": "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc123-2",
      "user": "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
      "adapterId": "0xc3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4",
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
      "feeCharged": "10000000000000000",
      "amountOut": "1218432000000000000000000",
      "timestamp": 1745123456,
      "txHash": "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc123"
    },
    {
      "id": "0xbcd234efa567bcd234efa567bcd234efa567bcd234efa567bcd234efa567bcd234-0",
      "user": "0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
      "adapterId": "0xc3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4",
      "adapterName": "PANCAKE_V3",
      "tokenIn": {
        "address": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
        "symbol": "PEPEBSC"
      },
      "tokenOut": {
        "address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "symbol": "WBNB"
      },
      "grossAmountIn": "250000000000000000000000",
      "feeCharged": "2500000000000000000000",
      "amountOut": "201480000000000000",
      "timestamp": 1745123200,
      "txHash": "0xbcd234efa567bcd234efa567bcd234efa567bcd234efa567bcd234efa567bcd234"
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

## GET /dex/metatx/nonce/:user

Returns the current nonce for a user on the OneMEMEMetaTx contract.
Must be fetched before building a meta-tx digest to avoid replay failures.

**Request**
```
GET /api/v1/bsc/dex/metatx/nonce/0x71be63f3384f5fb98995aa9b7a5b6e1234567890
```

**Response**
```json
{
  "data": {
    "user": "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
    "nonce": "3"
  }
}
```

---

## GET /dex/quote

Live on-chain quote — simulates expected output before committing to a swap.
Use this to calculate `amountOut` and `minOut` before calling `POST /dex/swap` or `POST /dex/metatx/digest`.

**Supported adapters:** `PANCAKE_V2`, `UNISWAP_V2`, `PANCAKE_V3`, `UNISWAP_V3`, `PANCAKE_V4`, `UNISWAP_V4`, `ONEMEME_BC`, `FOURMEME`, `FLAPSH`

**Query Parameters**

| Parameter     | Type   | Required | Description |
|---|---|---|---|
| `adapter`     | string | Yes | Adapter name |
| `tokenIn`     | string | Yes | Input token address |
| `amountIn`    | string | Yes | Input amount in wei |
| `tokenOut`    | string | Yes | Output token address |
| `path`        | string | No  | Comma-separated token addresses for multi-hop (V2/V3/V4 only; defaults to `tokenIn,tokenOut`) |
| `fees`        | string | No  | Comma-separated fee tiers — **required for V3 and V4** (e.g. `500` or `3000,500`) |
| `slippage`    | number | No  | Slippage tolerance in basis points, default `100` (1%) |
| `tickSpacing` | string | V4 only | Comma-separated tick spacings per hop — auto-derived from fee if omitted |
| `hooks`       | string | V4 only | Comma-separated hooks addresses per hop — defaults to zero address |

### V2 single-hop

```
GET /api/v1/bsc/dex/quote?adapter=PANCAKE_V2&tokenIn=0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c&amountIn=1000000000000000000&tokenOut=0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0&slippage=100
```

**Response**
```json
{
  "data": {
    "adapter":        "PANCAKE_V2",
    "tokenIn":        "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "tokenOut":       "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "amountIn":       "1000000000000000000",
    "amountOut":      "1231847000000000000000000",
    "minOut":         "1219528530000000000000000",
    "aggregatorFee":  "10000000000000000",
    "bondingFee":     null,
    "slippageBps":    "100",
    "quotedBy":       "PancakeSwap V2 Router",
    "path":           ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0"],
    "fees":           null
  }
}
```

### V2 multi-hop

```
GET /api/v1/bsc/dex/quote?adapter=PANCAKE_V2&tokenIn=0xa3f1...&amountIn=500000000000000000000000&tokenOut=0x55d3...&path=0xa3f1...,0xbb4c...,0x55d3...&slippage=200
```

### V3 single-hop (0.05% fee tier)

```
GET /api/v1/bsc/dex/quote?adapter=PANCAKE_V3&tokenIn=0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c&amountIn=500000000000000000&tokenOut=0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0&fees=500&slippage=100
```

**Response**
```json
{
  "data": {
    "adapter":        "PANCAKE_V3",
    "tokenIn":        "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "tokenOut":       "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "amountIn":       "500000000000000000",
    "amountOut":      "618204000000000000000000",
    "minOut":         "611921960000000000000000",
    "aggregatorFee":  "5000000000000000",
    "bondingFee":     null,
    "slippageBps":    "100",
    "quotedBy":       "PancakeSwap V3 QuoterV2",
    "path":           ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0"],
    "fees":           [500]
  }
}
```

### V3 multi-hop (two hops)

```
GET /api/v1/bsc/dex/quote?adapter=PANCAKE_V3&tokenIn=0xa3f1...&amountIn=1000000000000000000000000&tokenOut=0x55d3...&path=0xa3f1...,0xbb4c...,0x55d3...&fees=500,100
```

### V4 single-hop

V4 uses a singleton `PoolManager` — the quote requires a `PoolKey` (fee + tickSpacing + hooks)
instead of path bytes. `tickSpacing` is auto-derived from the fee tier if omitted.

```
GET /api/v1/bsc/dex/quote?adapter=PANCAKE_V4&tokenIn=0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c&amountIn=1000000000000000000&tokenOut=0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0&fees=3000
```

**Response**
```json
{
  "data": {
    "adapter":        "PANCAKE_V4",
    "tokenIn":        "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "tokenOut":       "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "amountIn":       "1000000000000000000",
    "amountOut":      "1229081000000000000000000",
    "minOut":         "1216790190000000000000000",
    "aggregatorFee":  "10000000000000000",
    "bondingFee":     null,
    "slippageBps":    "100",
    "quotedBy":       "PancakeSwap V4 Quoter",
    "path":           ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0"],
    "fees":           [3000],
    "tickSpacing":    [60],
    "hooks":          ["0x0000000000000000000000000000000000000000"]
  }
}
```

V4 with explicit tickSpacing and a custom hooks contract:
```
GET ...&fees=3000&tickSpacing=60&hooks=0x1234...
```

### V4 multi-hop

Provide a comma-separated `path` (all intermediate tokens), `fees` per hop,
and optionally `tickSpacing`/`hooks` per hop (one value per hop, comma-separated).

```
GET /api/v1/bsc/dex/quote?adapter=PANCAKE_V4&tokenIn=0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0&amountIn=1000000000000000000000000&tokenOut=0x55d398326f99059ff775485246999027b3197955&path=0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0,0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c,0x55d398326f99059ff775485246999027b3197955&fees=3000,500
```

**Response**
```json
{
  "data": {
    "adapter":        "PANCAKE_V4",
    "tokenIn":        "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "tokenOut":       "0x55d398326f99059ff775485246999027b3197955",
    "amountIn":       "1000000000000000000000000",
    "amountOut":      "793421000000000000000",
    "minOut":         "785486790000000000000",
    "aggregatorFee":  "10000000000000000000000",
    "bondingFee":     null,
    "slippageBps":    "100",
    "quotedBy":       "PancakeSwap V4 Quoter",
    "path":           [
      "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "0x55d398326f99059ff775485246999027b3197955"
    ],
    "fees":           [3000, 500],
    "tickSpacing":    [60, 10],
    "hooks":          [
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000"
    ]
  }
}
```

With explicit per-hop tickSpacing and hooks:
```
GET ...&fees=3000,500&tickSpacing=60,10&hooks=0x0000...,0x1234...
```

**Automatic tickSpacing derivation**

| Fee tier | Auto tickSpacing |
|---|---|
| 100 (0.01%) | 1 |
| 500 (0.05%) | 10 |
| 2500 (0.25%) | 50 |
| 3000 (0.30%) | 60 |
| 10000+ (1%+) | 200 |

### OneMEME bonding-curve (ONEMEME_BC)

`tokenIn` is WBNB for a buy, `tokenOut` is WBNB for a sell.

```
GET /api/v1/bsc/dex/quote?adapter=ONEMEME_BC&tokenIn=0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c&amountIn=1000000000000000000&tokenOut=0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0
```

**Response**
```json
{
  "data": {
    "adapter":        "ONEMEME_BC",
    "tokenIn":        "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "tokenOut":       "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "amountIn":       "1000000000000000000",
    "amountOut":      "1218432000000000000000000",
    "minOut":         "1206247680000000000000000",
    "aggregatorFee":  "10000000000000000",
    "bondingFee":     "3000000000000000",
    "slippageBps":    "100",
    "quotedBy":       "OneMEME BondingCurve",
    "path":           ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0"],
    "fees":           null
  }
}
```

Sell — swap token addresses:
```
GET .../quote?adapter=ONEMEME_BC&tokenIn=0xa3f1...&amountIn=500000000000000000000000&tokenOut=0xbb4c...
```

### FourMEME bonding-curve (FOURMEME)

Quoted via `TokenManagerHelper3.tryBuy` / `trySell` on-chain. No `path` or `fees` required.
`tokenIn` is WBNB for a buy; `tokenOut` is WBNB for a sell.

```
GET /api/v1/bsc/dex/quote?adapter=FOURMEME&tokenIn=0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c&amountIn=1000000000000000000&tokenOut=0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0
```

**Response**
```json
{
  "data": {
    "adapter":        "FOURMEME",
    "tokenIn":        "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "tokenOut":       "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "amountIn":       "1000000000000000000",
    "amountOut":      "984210000000000000000000",
    "minOut":         "974367900000000000000000",
    "aggregatorFee":  "10000000000000000",
    "bondingFee":     null,
    "slippageBps":    "100",
    "quotedBy":       "FourMEME TokenManagerHelper3",
    "path":           ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0"],
    "fees":           null
  }
}
```

### Flap.SH bonding-curve (FLAPSH)

Quoted via `Portal.previewBuy` / `previewSell` on-chain. No `path` or `fees` required.
`tokenIn` is WBNB for a buy; `tokenOut` is WBNB for a sell.

```
GET /api/v1/bsc/dex/quote?adapter=FLAPSH&tokenIn=0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c&amountIn=500000000000000000&tokenOut=0xb4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3
```

**Response**
```json
{
  "data": {
    "adapter":        "FLAPSH",
    "tokenIn":        "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "tokenOut":       "0xb4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3",
    "amountIn":       "500000000000000000",
    "amountOut":      "412847000000000000000000",
    "minOut":         "408718530000000000000000",
    "aggregatorFee":  "5000000000000000",
    "bondingFee":     null,
    "slippageBps":    "100",
    "quotedBy":       "Flap.SH Portal",
    "path":           ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0xb4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3"],
    "fees":           null
  }
}
```

**Error — V3/V4 missing fees**
```json
{ "statusCode": 400, "message": "V3 quote requires 1 fee tier(s) — provide via ?fees=500 (comma-separated for multi-hop)" }
```

---

## POST /dex/swap

Builds ABI-encoded calldata for a direct `OneMEMEAggregator.swap()` call.
The caller broadcasts this transaction themselves — no relayer, not gasless.

The aggregator charges a **1% protocol fee** on `amountIn`; the response includes an estimate.

### V2 single-hop (PANCAKE_V2 / UNISWAP_V2)

**Request**
```json
POST /api/v1/bsc/dex/swap
{
  "adapter":   "PANCAKE_V2",
  "tokenIn":   "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  "amountIn":  "1000000000000000000",
  "tokenOut":  "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
  "minOut":    "1200000000000000000000000",
  "to":        "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
  "deadline":  1745130000
}
```

**Response**
```json
{
  "data": {
    "to":          "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    "calldata":    "0x7c025200000000000000000000000000000000000000000000000000a1b2a1b2...",
    "adapter":     "PANCAKE_V2",
    "adapterId":   "0xa1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2a1b2",
    "tokenIn":     "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "tokenOut":    "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "amountIn":    "1000000000000000000",
    "feeEstimate": "10000000000000000",
    "netAmountIn": "990000000000000000",
    "minOut":      "1200000000000000000000000",
    "deadline":    "1745130000",
    "adapterData": "0x000000000000000000000000000000000000000000000000000000000000002..."
  }
}
```

### V2 multi-hop with explicit path

**Request**
```json
POST /api/v1/bsc/dex/swap
{
  "adapter":  "PANCAKE_V2",
  "tokenIn":  "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
  "amountIn": "500000000000000000000000",
  "tokenOut": "0x55d398326f99059ff775485246999027b3197955",
  "minOut":   "390000000000000000000",
  "to":       "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
  "deadline": 1745130000,
  "path": [
    "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "0x55d398326f99059ff775485246999027b3197955"
  ]
}
```

### V3 single-hop (PANCAKE_V3 / UNISWAP_V3)

**Request**
```json
POST /api/v1/bsc/dex/swap
{
  "adapter":  "PANCAKE_V3",
  "tokenIn":  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  "amountIn": "500000000000000000",
  "tokenOut": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
  "minOut":   "600000000000000000000000",
  "to":       "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
  "deadline": 1745130000,
  "path": [
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0"
  ],
  "fees": [500]
}
```

### Bonding-curve (ONEMEME_BC / FOURMEME / FLAPSH)

No `path` or `fees` required — the adapter resolves the curve from `tokenIn`/`tokenOut`.

**Request**
```json
POST /api/v1/bsc/dex/swap
{
  "adapter":  "FOURMEME",
  "tokenIn":  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  "amountIn": "1000000000000000000",
  "tokenOut": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
  "minOut":   "974367900000000000000000",
  "to":       "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
  "deadline": 1745130000
}
```

---

## POST /dex/metatx/digest

Computes the EIP-712 digest the user must sign for a gasless meta-transaction.

### Gasless swap flow

```
1. GET  /dex/metatx/nonce/:user          → get current nonce
2. POST /dex/metatx/digest               → build order + get digest
3. user.signTypedData(digest)            → sign in wallet (off-chain)
4. POST /dex/metatx/relay { order, sig } → relayer submits on-chain
```

> **Important:** Only Token → BNB and Token → Token swaps are supported (not BNB → Token).
> The user must approve the MetaTx contract for `grossAmountIn` of `tokenIn` before relay.

**Request**
```json
POST /api/v1/bsc/dex/metatx/digest
{
  "user":          "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
  "adapter":       "PANCAKE_V3",
  "tokenIn":       "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
  "grossAmountIn": "500000000000000000000000",
  "tokenOut":      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  "minUserOut":    "390000000000000000",
  "recipient":     "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
  "deadline":      1745133600,
  "swapDeadline":  1745130000,
  "relayerFee":    "2000000000000000000000",
  "path": [
    "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"
  ],
  "fees": [500]
}
```

**Response**
```json
{
  "data": {
    "digest": "0x9f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a0f1e",
    "metaTxContract": "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
    "order": {
      "user":          "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
      "nonce":         "3",
      "deadline":      "1745133600",
      "adapterId":     "0xc3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4",
      "tokenIn":       "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
      "grossAmountIn": "500000000000000000000000",
      "tokenOut":      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "minUserOut":    "390000000000000000",
      "recipient":     "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
      "swapDeadline":  "1745130000",
      "adapterData":   "0x000000000000000000000000000000000000000000000000000000000000002...",
      "relayerFee":    "2000000000000000000000"
    },
    "aggregatorFeeEstimate": "5000000000000000000000"
  }
}
```

**Amount breakdown**

| Field               | Description |
|---|---|
| `grossAmountIn`     | Total user approves and signs for |
| `relayerFee`        | Deducted first — paid to the relayer (covers gas + service) |
| `aggregatorFeeEstimate` | 1% of `grossAmountIn` — taken by the aggregator contract |
| net to swap         | `grossAmountIn - relayerFee - aggregatorFee` — what hits the DEX |
| `minUserOut`        | Minimum `tokenOut` the user must receive (slippage guard) |

---

## POST /dex/metatx/relay

Submits a signed MetaTxOrder to `OneMEMEMetaTx.executeMetaTx()` on-chain.
Requires `RELAYER_PRIVATE_KEY` to be configured on the server.

**Request — no permit (token already approved)**
```json
POST /api/v1/bsc/dex/metatx/relay
{
  "order": {
    "user":          "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
    "nonce":         "3",
    "deadline":      "1745133600",
    "adapterId":     "0xc3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4",
    "tokenIn":       "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "grossAmountIn": "500000000000000000000000",
    "tokenOut":      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "minUserOut":    "390000000000000000",
    "recipient":     "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
    "swapDeadline":  "1745130000",
    "adapterData":   "0x000000000000000000000000000000000000000000000000000000000000002...",
    "relayerFee":    "2000000000000000000000"
  },
  "sig":        "0x4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b1b",
  "permitType": 0,
  "permitData": "0x"
}
```

**Request — EIP-2612 permit (single approve + swap)**
```json
POST /api/v1/bsc/dex/metatx/relay
{
  "order": { ... },
  "sig":        "0x...",
  "permitType": 1,
  "permitData": "0x<abi-encoded EIP-2612 permit signature>"
}
```

**Response**
```json
{
  "data": {
    "txHash": "0xf1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a0f1e2",
    "status": "submitted"
  }
}
```

**Error — relay not enabled**
```json
{ "statusCode": 400, "message": "Meta-tx relay is not enabled on this node (RELAYER_PRIVATE_KEY not set)" }
```

**Error — expired deadline**
```json
{ "statusCode": 400, "message": "Meta-tx deadline has expired" }
```

---

## GET /dex/route

Returns an optimally routed swap plan with pre-encoded `adapterData` for each step.

**Two modes:**

| Mode | When | Behaviour |
|---|---|---|
| Aggregation | `adapter` param omitted | Queries V2, V3, V4, and bonding-curve adapters in parallel; returns the best price. `sources[]` lists every source with its quoted output. |
| Specific adapter | `adapter` param provided | Routes through that adapter only. Bonding-curve adapters with non-WBNB `tokenIn` automatically get a `PANCAKE_V3 → fallback PANCAKE_V2` bridge hop prepended. |

**Query Parameters**

| Parameter     | Required | Description |
|---|---|---|
| `tokenIn`     | Yes | Input token address |
| `amountIn`    | Yes | Input amount in wei (string) |
| `tokenOut`    | Yes | Output token address |
| `adapter`     | No  | Omit for aggregation mode; set to a specific adapter name for single-source routing |
| `fees`        | No  | Fee tier(s) — required when `adapter` is V3 or V4 |
| `tickSpacing` | No  | Tick spacing(s) — V4 only; auto-derived from fee when omitted |
| `hooks`       | No  | Hook addresses — V4 only; defaults to zero address |
| `slippage`    | No  | Slippage in basis points (default `100` = 1%) |

---

### Aggregation mode — no adapter specified

When `adapter` is omitted, the API queries all relevant liquidity sources (PancakeSwap V2/V3/V4, Uniswap V2/V3/V4, and bonding-curve protocols when applicable) in parallel and returns the best price. V3/V4 pool candidates are discovered from their subgraphs first so only real pools with liquidity are quoted.

```
GET /api/v1/bsc/dex/route?tokenIn=0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c&amountIn=1000000000000000000&tokenOut=0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0&slippage=100
```

**Response**
```json
{
  "data": {
    "singleStep": true,
    "nativeIn": false,
    "nativeOut": false,
    "value": "0",
    "steps": [
      {
        "adapter": "PANCAKE_V3",
        "adapterId": "0x70616e63616b655f76330000000000000000000000000000000000000000000000",
        "tokenIn": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "tokenOut": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
        "amountIn": "1000000000000000000",
        "amountOut": "1248300000000000000000000",
        "minOut": "1235817000000000000000000",
        "adapterData": "0x...",
        "fees": [500],
        "tickSpacing": null,
        "hooks": null
      }
    ],
    "amountIn": "1000000000000000000",
    "minFinalOut": "1235817000000000000000000",
    "aggregatorFee": "10000000000000000",
    "slippageBps": "100",
    "sources": [
      { "adapter": "PANCAKE_V3", "fees": [500],  "amountOut": "1248300000000000000000000" },
      { "adapter": "PANCAKE_V2", "fees": null,   "amountOut": "1231847000000000000000000" },
      { "adapter": "UNISWAP_V3", "fees": [3000], "amountOut": "1219400000000000000000000" }
    ]
  }
}
```

The winning source is returned as the first and only element of `steps[]`. `sources[]` contains every source that returned a valid quote, sorted best-first — useful for showing users where liquidity was found.

**Error — no liquidity found**
```json
{ "statusCode": 503, "message": "No route found — no liquidity source returned a valid quote for this pair" }
```

---

### Specific adapter — single-step — WBNB directly into a 1MEME token

```
GET /api/v1/bsc/dex/route?adapter=ONEMEME_BC&tokenIn=0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c&amountIn=1000000000000000000&tokenOut=0xMEME&slippage=100
```

```json
{
  "data": {
    "singleStep": true,
    "nativeIn": false,
    "nativeOut": false,
    "value": "0",
    "steps": [
      {
        "adapter": "ONEMEME_BC",
        "adapterId": "0x6f6e656d656d655f62630000000000000000000000000000000000000000000000",
        "tokenIn": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "tokenOut": "0x000000000000000000000000000000000000meme",
        "amountIn": "1000000000000000000",
        "amountOut": "412800000000000000000000",
        "minOut": "408672000000000000000000",
        "adapterData": "0x000000000000000000...000000000000000000..."
      }
    ],
    "amountIn": "1000000000000000000",
    "minFinalOut": "408672000000000000000000",
    "aggregatorFee": "10000000000000000",
    "slippageBps": "100"
  }
}
```

### Single-step — native BNB (zero address) directly into a 1MEME token

Pass `0x0000000000000000000000000000000000000000` as `tokenIn`. The API routes via WBNB internally and returns `nativeIn: true` with the `value` to attach.

```
GET /api/v1/bsc/dex/route?adapter=ONEMEME_BC&tokenIn=0x0000000000000000000000000000000000000000&amountIn=1000000000000000000&tokenOut=0xMEME&slippage=100
```

```json
{
  "data": {
    "singleStep": true,
    "nativeIn": true,
    "nativeOut": false,
    "value": "1000000000000000000",
    "steps": [
      {
        "adapter": "ONEMEME_BC",
        "adapterId": "0x6f6e656d656d655f62630000000000000000000000000000000000000000000000",
        "tokenIn": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "tokenOut": "0x000000000000000000000000000000000000meme",
        "amountIn": "1000000000000000000",
        "amountOut": "412800000000000000000000",
        "minOut": "408672000000000000000000",
        "adapterData": "0x..."
      }
    ],
    "amountIn": "1000000000000000000",
    "minFinalOut": "408672000000000000000000",
    "aggregatorFee": "10000000000000000",
    "slippageBps": "100"
  }
}
```

> When `nativeIn: true`, the caller must send `value` (wei) as `msg.value` with the transaction. When using `POST /dex/batch-swap` the `calldata` already encodes WBNB as `tokenIn`; the caller attaches native BNB as the transaction value.

### Two-step bridge — USDC into a 1MEME token

```
GET /api/v1/bsc/dex/route?adapter=ONEMEME_BC&tokenIn=0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d&amountIn=5000000000000000000&tokenOut=0xMEME&slippage=150
```

```json
{
  "data": {
    "singleStep": false,
    "nativeIn": false,
    "nativeOut": false,
    "value": "0",
    "steps": [
      {
        "adapter": "PANCAKE_V3",
        "adapterId": "0x70616e63616b655f76330000000000000000000000000000000000000000000000",
        "tokenIn": "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        "tokenOut": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "amountIn": "5000000000000000000",
        "amountOut": "8621500000000000",
        "minOut": "8492277500000000",
        "adapterData": "0x..."
      },
      {
        "adapter": "ONEMEME_BC",
        "adapterId": "0x6f6e656d656d655f62630000000000000000000000000000000000000000000000",
        "tokenIn": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "tokenOut": "0x000000000000000000000000000000000000meme",
        "amountIn": "8621500000000000",
        "amountOut": "3558900000000000000000",
        "minOut": "3505576500000000000000",
        "adapterData": "0x..."
      }
    ],
    "amountIn": "5000000000000000000",
    "minFinalOut": "3505576500000000000000",
    "aggregatorFee": "50000000000000000",
    "slippageBps": "150"
  }
}
```

---

## POST /dex/batch-swap

Builds ABI-encoded calldata for `OneMEMEAggregator.batchSwap()`.
Use steps from `GET /dex/route` or compose them manually from `/dex/quote` outputs.
The aggregator fee (1%) is charged once on the initial `amountIn`.

**Request** (two-step USDC → 1MEME token):
```json
{
  "steps": [
    {
      "adapterId": "0x70616e63616b655f76330000000000000000000000000000000000000000000000",
      "tokenIn":   "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      "tokenOut":  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "minOut":    "8492277500000000",
      "adapterData": "0x..."
    },
    {
      "adapterId": "0x6f6e656d656d655f62630000000000000000000000000000000000000000000000",
      "tokenIn":   "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "tokenOut":  "0x000000000000000000000000000000000000meme",
      "minOut":    "3505576500000000000000",
      "adapterData": "0x..."
    }
  ],
  "amountIn":    "5000000000000000000",
  "minFinalOut": "3505576500000000000000",
  "to":          "0xUserWalletAddress",
  "deadline":    1746400000
}
```

**Response:**
```json
{
  "data": {
    "to":          "0xOneMEMEAggregatorAddress",
    "calldata":    "0x...",
    "nativeIn":    false,
    "nativeOut":   false,
    "value":       "0",
    "steps": [
      {
        "adapterId": "0x70616e63616b655f76330000000000000000000000000000000000000000000000",
        "tokenIn":   "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        "tokenOut":  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "minOut":    "8492277500000000",
        "adapterData": "0x..."
      },
      {
        "adapterId": "0x6f6e656d656d655f62630000000000000000000000000000000000000000000000",
        "tokenIn":   "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "tokenOut":  "0x000000000000000000000000000000000000meme",
        "minOut":    "3505576500000000000000",
        "adapterData": "0x..."
      }
    ],
    "amountIn":    "5000000000000000000",
    "feeEstimate": "50000000000000000",
    "minFinalOut": "3505576500000000000000",
    "deadline":    "1746400000"
  }
}
```

---

## POST /dex/metatx/batch-digest

Computes the EIP-712 digest the user must sign for a gasless multi-hop swap.

### Gasless batch swap flow

**Step 1** — get route:
```
GET /dex/route?adapter=ONEMEME_BC&tokenIn=0xUSDC&amountIn=5000000000000000000&tokenOut=0xMEME
```
Save `steps[]` from the response.

**Step 2** — get nonce:
```
GET /dex/metatx/nonce/0xUserWallet
```

**Step 3** — POST /dex/metatx/batch-digest:

**Request:**
```json
{
  "user":          "0xUserWalletAddress",
  "steps": [
    {
      "adapterId": "0x70616e63616b655f76330000000000000000000000000000000000000000000000",
      "tokenIn":   "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      "tokenOut":  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "minOut":    "8492277500000000",
      "adapterData": "0x..."
    },
    {
      "adapterId": "0x6f6e656d656d655f62630000000000000000000000000000000000000000000000",
      "tokenIn":   "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "tokenOut":  "0x000000000000000000000000000000000000meme",
      "minOut":    "3505576500000000000000",
      "adapterData": "0x..."
    }
  ],
  "grossAmountIn": "5000000000000000000",
  "minFinalOut":   "3505576500000000000000",
  "recipient":     "0xUserWalletAddress",
  "deadline":      1746403600,
  "swapDeadline":  1746400000,
  "relayerFee":    "3000000000000000"
}
```

**Response:**
```json
{
  "data": {
    "digest":          "0xabcdef...",
    "metaTxContract":  "0xOneMEMEMetaTxAddress",
    "order": {
      "user":          "0xUserWalletAddress",
      "nonce":         "7",
      "deadline":      "1746403600",
      "steps": [
        {
          "adapterId": "0x70616e63616b655f76330000000000000000000000000000000000000000000000",
          "tokenIn":   "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
          "tokenOut":  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
          "minOut":    "8492277500000000",
          "adapterData": "0x..."
        },
        {
          "adapterId": "0x6f6e656d656d655f62630000000000000000000000000000000000000000000000",
          "tokenIn":   "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
          "tokenOut":  "0x000000000000000000000000000000000000meme",
          "minOut":    "3505576500000000000000",
          "adapterData": "0x..."
        }
      ],
      "grossAmountIn": "5000000000000000000",
      "minFinalOut":   "3505576500000000000000",
      "recipient":     "0xUserWalletAddress",
      "swapDeadline":  "1746400000",
      "relayerFee":    "3000000000000000"
    },
    "aggregatorFeeEstimate": "50000000000000000"
  }
}
```

**Step 4** — sign `digest` client-side with the user's wallet, then:

**Step 5** — POST /dex/metatx/batch-relay:

---

## POST /dex/metatx/batch-relay

Submits a signed `BatchMetaTxOrder` on-chain. The relayer pays gas; the user pays `relayerFee` from their token balance.

**Request:**
```json
{
  "order": { "...": "BatchMetaTxOrder from batch-digest response" },
  "sig":        "0x...(65-byte EIP-712 signature)...",
  "permitType": 0,
  "permitData": "0x"
}
```

**Response:**
```json
{
  "data": {
    "txHash": "0x...",
    "status": "submitted"
  }
}
```

**Error — steps path broken (tokenOut[i] ≠ tokenIn[i+1])**
```json
{ "statusCode": 400, "message": "steps[0].tokenOut (0xWBNB) must equal steps[1].tokenIn (0xOtherToken)" }
```

**Error — fewer than 2 steps**
```json
{ "statusCode": 400, "message": "steps must be an array of at least 2 swap steps" }
```

---

## Error Reference

| Status | Cause |
|---|---|
| `400 Bad Request` | Invalid address, bad amounts, unknown adapter, missing fees, expired deadline |
| `404 Not Found` | Token address not found in either subgraph |
| `503 Service Unavailable` | Required env var not set (`AGGREGATOR_SUBGRAPH_URL`, `THE_GRAPH_API_KEY`, `BSC_RPC_URL`, etc.) or upstream RPC/subgraph unreachable |

---

## Environment Variables

### Subgraph endpoints

| Variable | Required | Description |
|---|---|---|
| `SUBGRAPH_URL` | Yes (read: 1MEME tokens/trades) | Main launchpad subgraph GraphQL endpoint |
| `SUBGRAPH_API_KEY` | No | Bearer token for the main launchpad subgraph |
| `AGGREGATOR_SUBGRAPH_URL` | Yes (read: FOURMEME/FLAPSH + DEX swaps) | OneMEMEAggregator subgraph endpoint |
| `AGGREGATOR_SUBGRAPH_API_KEY` | No | Bearer token for the aggregator subgraph |
| `THE_GRAPH_API_KEY` | Yes (V3/V4 pools) | The Graph gateway API key for PancakeSwap V3/V4 and Uniswap V2/V3/V4 subgraphs |
| `PANCAKE_V2_SUBGRAPH_URL` | No | Override default NodeReal PancakeSwap V2 endpoint |
| `PANCAKE_V3_SUBGRAPH_URL` | No | Override default The Graph PancakeSwap V3 endpoint |
| `PANCAKE_V4_SUBGRAPH_URL` | No | Override default The Graph PancakeSwap V4 endpoint |
| `UNISWAP_V2_SUBGRAPH_URL` | No | Override default The Graph Uniswap V2 endpoint |
| `UNISWAP_V3_SUBGRAPH_URL` | No | Override default The Graph Uniswap V3 endpoint |
| `UNISWAP_V4_SUBGRAPH_URL` | No | Override default The Graph Uniswap V4 endpoint |

### Contracts and RPC

| Variable | Required | Description |
|---|---|---|
| `AGGREGATOR_ADDRESS` | Yes (`POST /dex/swap`, `POST /dex/metatx/*`) | OneMEMEAggregator contract address |
| `METATX_ADDRESS` | Yes (`POST /dex/metatx/*`) | OneMEMEMetaTx contract address |
| `RELAYER_PRIVATE_KEY` | Yes (`POST /dex/metatx/relay`) | 0x-prefixed private key of the funded relayer EOA |
| `BSC_RPC_URL` | Yes (quotes, relay) | BSC HTTP RPC for contract reads and relay broadcast |
| `FOURMEME_HELPER_ADDRESS` | No | TokenManagerHelper3 address (default: BSC mainnet) |
| `FLAPSH_PORTAL_ADDRESS` | No | Flap.SH Portal address (default: BSC mainnet) |
| `PANCAKE_V2_ROUTER_ADDRESS` | No | PancakeSwap V2 Router (default: BSC mainnet) |
| `PANCAKE_V3_QUOTER_ADDRESS` | No | PancakeSwap V3 QuoterV2 (default: BSC mainnet) |
| `UNISWAP_V2_ROUTER_ADDRESS` | No | Uniswap V2 Router (default: BSC mainnet) |
| `UNISWAP_V3_QUOTER_ADDRESS` | No | Uniswap V3 Quoter (no BSC default; set if deployed) |
| `PANCAKE_V4_QUOTER_ADDRESS` | No | PancakeSwap V4 Quoter (no default; required for V4 quotes) |
| `UNISWAP_V4_QUOTER_ADDRESS` | No | Uniswap V4 Quoter (no default; required for V4 quotes) |
