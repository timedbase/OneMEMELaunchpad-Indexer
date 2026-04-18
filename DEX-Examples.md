# DEX API — Endpoint Reference & Examples

Base URL: `https://your-api.example.com/api/v1/bsc/dex`

All responses use JSON. Paginated responses wrap data in `{ data, pagination }`.
Numeric amounts are always **strings in wei** unless noted otherwise.

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

Paginated list of all tokens tracked by the aggregator subgraph across all platforms.

**Query Parameters**

| Parameter    | Type    | Default              | Description |
|---|---|---|---|
| `platform`   | string  | —                    | Filter: `ONEMEME` \| `FOURMEME` \| `FLAPSH` \| `DEX` |
| `bondingPhase` | bool  | —                    | `true` = still on bonding curve, `false` = migrated |
| `search`     | string  | —                    | Case-insensitive symbol substring match |
| `orderBy`    | string  | `createdAtTimestamp` | `createdAtTimestamp` \| `totalVolumeBNB` \| `tradeCount` \| `currentMarketCapBNB` \| `currentLiquidityBNB` |
| `orderDir`   | string  | `desc`               | `asc` \| `desc` |
| `page`       | number  | `1`                  | Page number |
| `limit`      | number  | `20`                 | Items per page (max 100) |

**Request**
```
GET /api/v1/bsc/dex/tokens?platform=ONEMEME&bondingPhase=true&orderBy=totalVolumeBNB&limit=2
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
      "platforms": ["ONEMEME"],
      "bondingPhase": true,
      "bondingCurve": "0xd1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9c0",
      "pairAddress": null,
      "currentPriceBNB": "0.000000812",
      "currentPriceUSD": "0.000497",
      "currentMarketCapBNB": "8.12",
      "currentMarketCapUSD": "4972.54",
      "currentLiquidityBNB": "12.48",
      "totalVolumeBNB": "241.83",
      "tradeCount": 1847,
      "createdAtTimestamp": 1745001234
    },
    {
      "address": "0xb4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3",
      "name": "MoonDoge",
      "symbol": "MDOGE",
      "decimals": 18,
      "platforms": ["ONEMEME"],
      "bondingPhase": true,
      "bondingCurve": "0xe2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1",
      "pairAddress": null,
      "currentPriceBNB": "0.000001204",
      "currentPriceUSD": "0.000737",
      "currentMarketCapBNB": "12.04",
      "currentMarketCapUSD": "7371.18",
      "currentLiquidityBNB": "18.76",
      "totalVolumeBNB": "189.42",
      "tradeCount": 1203,
      "createdAtTimestamp": 1745009876
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

---

## GET /dex/tokens/:address

Full detail for a single token including live price and liquidity.

**Request**
```
GET /api/v1/bsc/dex/tokens/0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0
```

**Response**
```json
{
  "data": {
    "address": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
    "name": "PepeBSC",
    "symbol": "PEPEBSC",
    "decimals": 18,
    "platforms": ["ONEMEME"],
    "bondingPhase": true,
    "bondingCurve": "0xd1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9c0",
    "pairAddress": null,
    "currentPriceBNB": "0.000000812",
    "currentPriceUSD": "0.000497",
    "currentMarketCapBNB": "8.12",
    "currentMarketCapUSD": "4972.54",
    "currentLiquidityBNB": "12.48",
    "totalVolumeBNB": "241.83",
    "tradeCount": 1847,
    "createdAtTimestamp": 1745001234
  }
}
```

**Error — not found**
```json
{ "statusCode": 404, "message": "Token 0x... not found in aggregator subgraph" }
```

---

## GET /dex/tokens/:address/pools

DEX pools containing this token across all supported AMMs (V2/V3/V4).

**Query Parameters**

| Parameter | Type   | Default | Description |
|---|---|---|---|
| `dex`     | string | —       | Filter by DEX: `PANCAKE_V2` \| `PANCAKE_V3` \| `UNISWAP_V2` \| `UNISWAP_V3` \| etc. |
| `page`    | number | `1`     | |
| `limit`   | number | `20`    | |

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
      "liquidity": "847293000000000000000",
      "volumeBNB": "184.32",
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
      "volumeBNB": "57.91",
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

**Query Parameters**

| Parameter | Type   | Default | Description |
|---|---|---|---|
| `source`  | string | —       | `bonding` = bonding-curve only, `dex` = aggregator swaps only, omit for all |
| `page`    | number | `1`     | |
| `limit`   | number | `20`    | |

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
      "platform": "ONEMEME",
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

**Supported adapters:** `PANCAKE_V2`, `UNISWAP_V2`, `PANCAKE_V3`, `UNISWAP_V3`, `ONEMEME_BC`

**Query Parameters**

| Parameter  | Type   | Required | Description |
|---|---|---|---|
| `adapter`  | string | Yes | Adapter name |
| `tokenIn`  | string | Yes | Input token address |
| `amountIn` | string | Yes | Input amount in wei |
| `tokenOut` | string | Yes | Output token address |
| `path`     | string | No  | Comma-separated token addresses for multi-hop (defaults to direct `tokenIn,tokenOut`) |
| `fees`     | string | No  | Comma-separated fee tiers for V3 hops — **required for V3** (e.g. `500` or `500,3000`) |
| `slippage` | number | No  | Slippage tolerance in basis points, default `100` (1%) |

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

### Bonding-curve buy (WBNB → meme token)

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

### Bonding-curve sell (meme token → WBNB)

```
GET /api/v1/bsc/dex/quote?adapter=ONEMEME_BC&tokenIn=0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0&amountIn=500000000000000000000000&tokenOut=0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c
```

**Error — unsupported adapter**
```json
{ "statusCode": 400, "message": "On-chain quote is not yet supported for PANCAKE_V4. Supported: PANCAKE_V2, UNISWAP_V2, PANCAKE_V3, UNISWAP_V3, ONEMEME_BC" }
```

**Error — V3 missing fees**
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
  "adapter":  "ONEMEME_BC",
  "tokenIn":  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  "amountIn": "1000000000000000000",
  "tokenOut": "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
  "minOut":   "1200000000000000000000000",
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

## Error Reference

| Status | Cause |
|---|---|
| `400 Bad Request` | Invalid address, bad amounts, unknown adapter, expired deadline |
| `404 Not Found` | Token address not in aggregator subgraph |
| `503 Service Unavailable` | `AGGREGATOR_SUBGRAPH_URL` not set |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AGGREGATOR_SUBGRAPH_URL` | Yes (read endpoints) | GraphQL endpoint for the OneMEMEAggregator subgraph |
| `AGGREGATOR_SUBGRAPH_API_KEY` | No | Bearer token for the aggregator subgraph |
| `AGGREGATOR_ADDRESS` | Yes (`POST /dex/swap`, `POST /dex/metatx/*`) | OneMEMEAggregator contract address |
| `METATX_ADDRESS` | Yes (`POST /dex/metatx/*`) | OneMEMEMetaTx contract address |
| `RELAYER_PRIVATE_KEY` | Yes (`POST /dex/metatx/relay`) | 0x-prefixed private key of the funded relayer EOA |
| `BSC_RPC_URL` | Yes (`POST /dex/metatx/*`) | BSC HTTP RPC for contract reads and relay broadcast |
