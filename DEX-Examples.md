# DEX API — Endpoint Reference & Examples

Base URL: `https://api.1coin.meme/api/v1/bsc/dex`

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
8. [GET /dex/metatx/relayer-fee](#get-dexmetatxrelayer-fee)
9. [GET /dex/metatx/permit-type](#get-dexmetatxpermit-type)
10. [GET /dex/metatx/permit-digest](#get-dexmetatxpermit-digest)
11. [GET /dex/metatx/permit2-digest](#get-dexmetatxpermit2-digest)
11. [GET /dex/metatx/nonce/:user](#get-dexmetatxnonceuser)
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

> **Note:** `PANCAKE_V4` and `UNISWAP_V4` are registered on-chain but currently excluded from automatic routing. Their IDs remain valid for manual `POST /dex/batch-swap` step construction.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/adapters'
```

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

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/tokens/0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0/trades?limit=2'
```

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

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/swaps?adapter=PANCAKE_V3&limit=2'
```

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
      "feeCharged": "5000000000000000",
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
      "feeCharged": "1250000000000000000000",
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

## GET /dex/metatx/relayer-fee

Returns a suggested `relayerFee` in BNB wei (the minimum BNB the relayer must receive), computed from the live BSC gas price plus a 30% premium.

- **BNB output** (`tokenOut = address(0)`): use `relayerFee` alone. The contract deducts it directly from the BNB output.
- **ERC-20 output**: pass all four fee fields (`relayerFee`, `relayerFeeTokenAmount`, `relayerFeeAdapterId`, `relayerFeeAdapterData`) into the digest. The contract deducts `relayerFeeTokenAmount` of `tokenOut`, swaps it to BNB via the aggregator, and guarantees the relayer receives at least `relayerFee` BNB.

**Query Parameters**

| Parameter | Required | Description |
|---|---|---|
| `steps` | No | Number of swap steps (default `1`). Use `2` for a two-hop route. |
| `tokenOut` | No | Output token address. When ERC-20, the response includes `relayerFeeTokenAmount` and adapter details for the fee conversion swap. |

**BNB output (`tokenOut` omitted or `address(0)`)**

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/metatx/relayer-fee?steps=1'
```

```json
{
  "data": {
    "steps":                 1,
    "gasPrice":              "1000000000",
    "gasEstimate":           "250000",
    "relayerFee":            "325000000000000",
    "relayerFeeTokenAmount": "0",
    "relayerFeeAdapterId":   "0x0000000000000000000000000000000000000000000000000000000000000000",
    "relayerFeeAdapterData": "0x",
    "premiumBps":            "3000"
  }
}
```

**ERC-20 output**

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/metatx/relayer-fee?steps=1&tokenOut=0x67c8b64fbcc780acbcff90f7a848eec5bccb9d45'
```

```json
{
  "data": {
    "steps":                 1,
    "gasPrice":              "1000000000",
    "gasEstimate":           "370000",
    "relayerFee":            "481000000000000",
    "relayerFeeTokenAmount": "125000000000000000000",
    "relayerFeeAdapterId":   "0xbed4079be2b2085074c8e018c29e583ba528d02bf887af9ab44f3ec550095725",
    "relayerFeeAdapterData": "0x...",
    "premiumBps":            "3000"
  }
}
```

`relayerFee` = `gasEstimate × gasPrice × 1.30`. ERC-20 gasEstimate adds 120,000 for the fee-conversion swap. `relayerFeeTokenAmount` is quoted via V2 `getAmountsIn` with a 1% slippage buffer.

---

## GET /dex/metatx/permit-type

Detects which permit mode a token supports and which ones are already set up for the user. Call this before building the digest — use `recommended` to choose the right flow.

**Query Parameters**

| Parameter | Required | Description |
|---|---|---|
| `token` | Yes | ERC-20 input token address |
| `owner` | Yes | User wallet address |
| `amount` | Yes | Amount in wei (typically `grossAmountIn`) |

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/metatx/permit-type?token=0x55d398326f99059ff775485246999027b3197955&owner=0x71be63f3384f5fb98995aa9b7a5b6e1234567890&amount=5000000000000000000'
```

```json
{
  "data": {
    "token":           "0x55d398326f99059ff775485246999027b3197955",
    "owner":           "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
    "amount":          "5000000000000000000",
    "recommended":     2,
    "supportsEip2612": false,
    "permit2":         "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "permit2Allowance": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    "permit2Ready":    true,
    "metaTxAddress":   "0xOneMEMEMetaTxAddress",
    "metaTxAllowance": "0",
    "metaTxReady":     false,
    "options": {
      "0": { "name": "pre-approve", "available": true,  "ready": false },
      "1": { "name": "eip-2612",    "available": false, "ready": false },
      "2": { "name": "permit2",     "available": true,  "ready": true  }
    }
  }
}
```

| `recommended` | When | Action needed |
|---|---|---|
| `1` | Token supports EIP-2612 | None — sign permit inline |
| `2` | EIP-2612 not supported, Permit2 available | None if `permit2Ready: true`; otherwise one-time `approve(permit2, max)` |
| `0` | Neither (rare) | `approve(metaTxAddress, amount)` before relay |

---

## GET /dex/metatx/permit-digest

Returns the EIP-712 typed data for an **EIP-2612 permit** signature. The user passes this to `eth_signTypedData_v4` in their wallet. The resulting `(v, r, s)` are then ABI-encoded into `permitData` for `POST /dex/metatx/relay`.

> Works for tokens that implement EIP-2612 (USDC, DAI, most modern ERC-20s). Does **not** work for USDT-BSC — use Permit2 instead.

**Query Parameters**

| Parameter | Required | Description |
|---|---|---|
| `token` | Yes | ERC-20 token address |
| `owner` | Yes | User wallet address |
| `amount` | Yes | Amount in wei (must equal `grossAmountIn` in the order) |
| `deadline` | Yes | Unix timestamp — how long the permit is valid |

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/metatx/permit-digest?token=0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d&owner=0x71be63f3384f5fb98995aa9b7a5b6e1234567890&amount=5000000000000000000&deadline=1745133600'
```

```json
{
  "data": {
    "permitType": 1,
    "spender":    "0xOneMEMEMetaTxAddress",
    "typedData": {
      "domain": {
        "name":             "USD Coin",
        "version":          "1",
        "chainId":          56,
        "verifyingContract": "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"
      },
      "types": {
        "Permit": [
          { "name": "owner",    "type": "address" },
          { "name": "spender",  "type": "address" },
          { "name": "value",    "type": "uint256" },
          { "name": "nonce",    "type": "uint256" },
          { "name": "deadline", "type": "uint256" }
        ]
      },
      "primaryType": "Permit",
      "message": {
        "owner":    "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
        "spender":  "0xOneMEMEMetaTxAddress",
        "value":    "5000000000000000000",
        "nonce":    "0",
        "deadline": "1745133600"
      }
    },
    "nonce": "0",
    "permitDataEncoding": "abi.encode(uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
    "note": "Sign typedData with eth_signTypedData_v4. Encode result as abi.encode(deadline, v, r, s) for the permitData field in /relay."
  }
}
```

**Client-side encoding** (after signing):
```typescript
// sig = wallet.signTypedData(typedData)  →  { v, r, s }
const permitData = encodeAbiParameters(
  [{ type: "uint256" }, { type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }],
  [deadline, v, r, s],
);
// then POST /dex/metatx/relay with permitType: 1, permitData
```

---

## GET /dex/metatx/permit2-digest

Returns the EIP-712 typed data for a **Permit2 PermitTransferFrom** signature. Works for any ERC-20 including USDT-BSC, after a **one-time** `token.approve(permit2Address, type(uint256).max)` per token.

**Query Parameters**

| Parameter | Required | Description |
|---|---|---|
| `token` | Yes | ERC-20 token address |
| `owner` | Yes | User wallet address |
| `amount` | Yes | Amount in wei |
| `deadline` | Yes | Unix timestamp |
| `nonce` | No | Permit2 nonce (random uint248, auto-generated if omitted) |

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/metatx/permit2-digest?token=0x55d398326f99059ff775485246999027b3197955&owner=0x71be63f3384f5fb98995aa9b7a5b6e1234567890&amount=5000000000000000000&deadline=1745133600'
```

```json
{
  "data": {
    "permitType": 2,
    "permit2":    "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "spender":    "0xOneMEMEMetaTxAddress",
    "typedData": {
      "domain": {
        "name":             "Permit2",
        "chainId":          56,
        "verifyingContract": "0x000000000022D473030F116dDEE9F6B43aC78BA3"
      },
      "types": {
        "PermitTransferFrom": [
          { "name": "permitted", "type": "TokenPermissions" },
          { "name": "spender",   "type": "address" },
          { "name": "nonce",     "type": "uint256" },
          { "name": "deadline",  "type": "uint256" }
        ],
        "TokenPermissions": [
          { "name": "token",  "type": "address" },
          { "name": "amount", "type": "uint256" }
        ]
      },
      "primaryType": "PermitTransferFrom",
      "message": {
        "permitted": {
          "token":  "0x55d398326f99059ff775485246999027b3197955",
          "amount": "5000000000000000000"
        },
        "spender":  "0xOneMEMEMetaTxAddress",
        "nonce":    "183764823764823764823764",
        "deadline": "1745133600"
      }
    },
    "nonce": "183764823764823764823764",
    "permitDataEncoding": "abi.encode(uint256 nonce, uint256 deadline, bytes signature)",
    "note": "Sign typedData with eth_signTypedData_v4. Encode result as abi.encode(nonce, deadline, signature) for the permitData field in /relay. Requires prior token.approve(permit2, type(uint256).max)."
  }
}
```

**Client-side encoding** (after signing):
```typescript
// signature = wallet.signTypedData(typedData)  →  hex string
const permitData = encodeAbiParameters(
  [{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }],
  [nonce, deadline, signature],
);
// then POST /dex/metatx/relay with permitType: 2, permitData
```

**One-time Permit2 setup per token** (user pays gas once, then all future swaps are gasless):
```typescript
await token.approve("0x000000000022D473030F116dDEE9F6B43aC78BA3", maxUint256);
```

---

## GET /dex/metatx/nonce/:user

Returns the current nonce for a user on the OneMEMEMetaTx contract.
Must be fetched before building a meta-tx digest to avoid replay failures.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/metatx/nonce/0x71be63f3384f5fb98995aa9b7a5b6e1234567890'
```

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

Builds ABI-encoded calldata for a direct `OneMEMEAggregator.swap()` or `batchSwap()` call.
The caller broadcasts this transaction themselves — no relayer, not gasless.

The aggregator charges a **0.5% protocol fee** on `amountIn`; the response includes an estimate.
Adapter selection is fully internal — the router picks the best source automatically.

**Body:** `{ tokenIn, amountIn, tokenOut, to, deadline, slippage? }`

Aggregates all sources, picks the best, computes `minOut` from `slippage`. `sources[]` shows all tried. When the best route is a two-step bridge (tokenIn → WBNB → tokenOut via a BC adapter), `batchSwap` calldata is returned and `singleStep` is `false`.

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

**Response — single-step route**
```json
{
  "data": {
    "to":          "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
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
        "adapterId":   "0x70616e63616b655f76330000000000000000000000000000000000000000000000",
        "tokenIn":     "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "tokenOut":    "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
        "amountIn":    "1000000000000000000",
        "amountOut":   "1248300000000000000000000",
        "minOut":      "1235817000000000000000000",
        "adapterData": "0x...",
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

**Response — two-step bridge route** (tokenIn → WBNB → BC token, `singleStep: false`)
```json
{
  "data": {
    "to":          "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    "calldata":    "0x...",
    "gasLimit":    "400000",
    "singleStep":  false,
    "steps": [
      {
        "adapter":     "PANCAKE_V3",
        "tokenIn":     "0xa3f1...",
        "tokenOut":    "0xbb4c...",
        "amountIn":    "500000000000000000000000",
        "amountOut":   "410000000000000000",
        "minOut":      "405900000000000000",
        "adapterData": "0x...",
        "fees":        [500]
      },
      {
        "adapter":     "FOURMEME",
        "tokenIn":     "0xbb4c...",
        "tokenOut":    "0xc5d6...",
        "amountIn":    "410000000000000000",
        "amountOut":   "398000000000000000000000",
        "minOut":      "394020000000000000000000",
        "adapterData": "0x..."
      }
    ]
  }
}
```

---

## POST /dex/metatx/digest

Computes the EIP-712 digest the user must sign for a gasless meta-transaction.

### Gasless swap flow

```
1. GET  /dex/route                       → find best route; note step.adapterId + step.adapterData
2. GET  /dex/metatx/nonce/:user          → get current nonce
3. POST /dex/metatx/digest               → build order + get digest
4. user.signTypedData(digest)            → sign in wallet (off-chain)
5. POST /dex/metatx/relay { order, sig } → relayer submits on-chain
```

> **Important:** Only Token → BNB and Token → Token swaps are supported (not BNB → Token).
> The user must approve the MetaTx contract for `grossAmountIn` of `tokenIn` before relay.
>
> `adapterId` and `adapterData` are opaque bytes taken directly from the `GET /dex/route`
> step response — the server does not derive them from an adapter name here.
>
> For ERC-20 output swaps, also pass `relayerFeeTokenAmount`, `relayerFeeAdapterId`, and
> `relayerFeeAdapterData` (all returned by `GET /dex/metatx/relayer-fee?tokenOut=...`).
> These fields default to zero/empty and can be omitted for BNB-output swaps.

**BNB output**

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/dex/metatx/digest' \
  -H 'Content-Type: application/json' \
  -d '{
  "user":          "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
  "adapterId":     "0xc3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4c3d4",
  "adapterData":   "0x...",
  "tokenIn":       "0xa3f1e2d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0",
  "grossAmountIn": "500000000000000000000000",
  "tokenOut":      "0x0000000000000000000000000000000000000000",
  "minUserOut":    "390000000000000000",
  "recipient":     "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
  "deadline":      "1745133600",
  "swapDeadline":  "1745130000",
  "relayerFee":    "325000000000000"
}'
```

**ERC-20 output** (add the three fee fields from `GET /dex/metatx/relayer-fee?tokenOut=...`)

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/dex/metatx/digest' \
  -H 'Content-Type: application/json' \
  -d '{
  "user":                   "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
  "adapterId":              "0xbed4079be2b2085074c8e018c29e583ba528d02bf887af9ab44f3ec550095725",
  "adapterData":            "0x...",
  "tokenIn":                "0x55d398326f99059ff775485246999027b3197955",
  "grossAmountIn":          "5000000000000000000",
  "tokenOut":               "0x67c8b64fbcc780acbcff90f7a848eec5bccb9d45",
  "minUserOut":             "95000000000000000000000000",
  "recipient":              "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
  "deadline":               "1745133600",
  "swapDeadline":           "1745130000",
  "relayerFee":             "481000000000000",
  "relayerFeeTokenAmount":  "125000000000000000000",
  "relayerFeeAdapterId":    "0xbed4079be2b2085074c8e018c29e583ba528d02bf887af9ab44f3ec550095725",
  "relayerFeeAdapterData":  "0x..."
}'
```

```json
{
  "data": {
    "digest": "0x9f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a0f1e",
    "metaTxContract": "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
    "order": {
      "user":                   "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
      "nonce":                  "3",
      "deadline":               "1745133600",
      "adapterId":              "0xbed4079be2b2085074c8e018c29e583ba528d02bf887af9ab44f3ec550095725",
      "tokenIn":                "0x55d398326f99059ff775485246999027b3197955",
      "grossAmountIn":          "5000000000000000000",
      "tokenOut":               "0x67c8b64fbcc780acbcff90f7a848eec5bccb9d45",
      "minUserOut":             "95000000000000000000000000",
      "recipient":              "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
      "swapDeadline":           "1745130000",
      "adapterData":            "0x...",
      "relayerFee":             "481000000000000",
      "relayerFeeTokenAmount":  "125000000000000000000",
      "relayerFeeAdapterId":    "0xbed4079be2b2085074c8e018c29e583ba528d02bf887af9ab44f3ec550095725",
      "relayerFeeAdapterData":  "0x..."
    },
    "aggregatorFeeEstimate": "25000000000000000"
  }
}
```

**Amount breakdown**

| Field | BNB output | ERC-20 output |
|---|---|---|
| `grossAmountIn` | Total input the user signs for | Same |
| `aggregatorFee` | 0.5% of `grossAmountIn` — taken by the aggregator | Same |
| net to swap | `grossAmountIn − aggregatorFee` hits the DEX | Same |
| `relayerFee` | Min BNB deducted from output for the relayer | Min BNB the relayer gets from the fee-conversion swap |
| `relayerFeeTokenAmount` | — (zero) | Amount of `tokenOut` sold to BNB for the relayer |
| `minUserOut` | Min BNB user receives (after relayerFee) | Min `tokenOut` user receives (after relayerFeeTokenAmount) |

---

## POST /dex/metatx/relay

Submits a signed MetaTxOrder to `OneMEMEMetaTx.executeMetaTx()` on-chain.
Requires `RELAYER_PRIVATE_KEY` to be configured on the server.

**No permit (token already approved)**

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/dex/metatx/relay' \
  -H 'Content-Type: application/json' \
  -d '{
  "order": {
    "user":                  "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
    "nonce":                 "3",
    "deadline":              "1745133600",
    "adapterId":             "0xbed4079be2b2085074c8e018c29e583ba528d02bf887af9ab44f3ec550095725",
    "tokenIn":               "0x55d398326f99059ff775485246999027b3197955",
    "grossAmountIn":         "5000000000000000000",
    "tokenOut":              "0x67c8b64fbcc780acbcff90f7a848eec5bccb9d45",
    "minUserOut":            "95000000000000000000000000",
    "recipient":             "0x71be63f3384f5fb98995aa9b7a5b6e1234567890",
    "swapDeadline":          "1745130000",
    "adapterData":           "0x...",
    "relayerFee":            "481000000000000",
    "relayerFeeTokenAmount": "125000000000000000000",
    "relayerFeeAdapterId":   "0xbed4079be2b2085074c8e018c29e583ba528d02bf887af9ab44f3ec550095725",
    "relayerFeeAdapterData": "0x..."
  },
  "sig":        "0x4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b1b",
  "permitType": 0,
  "permitData": "0x"
}'
```

**EIP-2612 permit** — `permitData` = `abi.encode(deadline, v, r, s)` from `GET /dex/metatx/permit-digest`

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/dex/metatx/relay' \
  -H 'Content-Type: application/json' \
  -d '{
  "order":      { "...": "MetaTxOrder from digest response" },
  "sig":        "0x...",
  "permitType": 1,
  "permitData": "0x<abi.encode(deadline, v, r, s)>"
}'
```

**Permit2** — `permitData` = `abi.encode(nonce, deadline, signature)` from `GET /dex/metatx/permit2-digest`

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/dex/metatx/relay' \
  -H 'Content-Type: application/json' \
  -d '{
  "order":      { "...": "MetaTxOrder from digest response" },
  "sig":        "0x...",
  "permitType": 2,
  "permitData": "0x<abi.encode(nonce, deadline, signature)>"
}'
```

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

Queries PancakeSwap V2/V3, Uniswap V2/V3, and bonding-curve protocols in parallel.
V3 pool candidates are discovered from their subgraphs first so only real pools with liquidity are quoted. When neither tokenIn nor tokenOut is WBNB and a BC adapter wins, a two-step bridge route is returned automatically (`singleStep: false`). `sources[]` lists every source with its quoted output.

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
    "aggregatorFee": "5000000000000000",
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

**Native BNB** — pass `0x0000000000000000000000000000000000000000` as `tokenIn` or `tokenOut`. When `nativeIn: true`, the caller must attach `value` wei as `msg.value` with the transaction.

**Two-step bridge response** — when neither tokenIn nor tokenOut is WBNB and a bonding-curve adapter wins (e.g. USDC → 1MEME token), the router automatically prepends a tokenIn → WBNB hop:

```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/route?tokenIn=0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d&amountIn=5000000000000000000&tokenOut=0xMEME&slippage=150'
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
        "adapterData": "0x...",
        "fees": [500],
        "tickSpacing": null,
        "hooks": null
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
    "aggregatorFee": "25000000000000000",
    "slippageBps": "150",
    "sources": [
      { "adapter": "PANCAKE_V3→ONEMEME_BC", "fees": [500], "amountOut": "3558900000000000000000" },
      { "adapter": "PANCAKE_V2",            "fees": null,  "amountOut": "3102000000000000000000" }
    ]
  }
}
```

---

## POST /dex/batch-swap

Builds ABI-encoded calldata for `OneMEMEAggregator.batchSwap()`.
Use steps from `GET /dex/route` or compose them manually from `/dex/quote` outputs.
The aggregator fee (0.5%) is charged once on the initial `amountIn`.

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/dex/batch-swap' \
  -H 'Content-Type: application/json' \
  -d '{
  "steps": [
    {
      "adapterId":   "0x70616e63616b655f76330000000000000000000000000000000000000000000000",
      "tokenIn":     "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      "tokenOut":    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "minOut":      "8492277500000000",
      "adapterData": "0x..."
    },
    {
      "adapterId":   "0x6f6e656d656d655f62630000000000000000000000000000000000000000000000",
      "tokenIn":     "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "tokenOut":    "0x000000000000000000000000000000000000meme",
      "minOut":      "3505576500000000000000",
      "adapterData": "0x..."
    }
  ],
  "amountIn":    "5000000000000000000",
  "minFinalOut": "3505576500000000000000",
  "to":          "0xUserWalletAddress",
  "deadline":    1746400000
}'
```

```json
{
  "data": {
    "to":          "0xOneMEMEAggregatorAddress",
    "calldata":    "0x...",
    "nativeIn":    false,
    "nativeOut":   false,
    "value":       "0",
    "gasLimit":    "400000",
    "steps": [
      {
        "adapterId":   "0x70616e63616b655f76330000000000000000000000000000000000000000000000",
        "tokenIn":     "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        "tokenOut":    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "minOut":      "8492277500000000",
        "adapterData": "0x..."
      },
      {
        "adapterId":   "0x6f6e656d656d655f62630000000000000000000000000000000000000000000000",
        "tokenIn":     "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        "tokenOut":    "0x000000000000000000000000000000000000meme",
        "minOut":      "3505576500000000000000",
        "adapterData": "0x..."
      }
    ],
    "amountIn":    "5000000000000000000",
    "feeEstimate": "25000000000000000",
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
```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/route?tokenIn=0xUSDC&amountIn=5000000000000000000&tokenOut=0xMEME'
```
Save `steps[]` from the response.

**Step 2** — get nonce:
```bash
curl 'https://api.1coin.meme/api/v1/bsc/dex/metatx/nonce/0xUserWallet'
```

**Step 3** — build batch digest:

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/dex/metatx/batch-digest' \
  -H 'Content-Type: application/json' \
  -d '{
  "user": "0xUserWalletAddress",
  "steps": [
    {
      "adapterId":   "0x70616e63616b655f76330000000000000000000000000000000000000000000000",
      "tokenIn":     "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      "tokenOut":    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "minOut":      "8492277500000000",
      "adapterData": "0x..."
    },
    {
      "adapterId":   "0x6f6e656d656d655f62630000000000000000000000000000000000000000000000",
      "tokenIn":     "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "tokenOut":    "0x000000000000000000000000000000000000meme",
      "minOut":      "3505576500000000000000",
      "adapterData": "0x..."
    }
  ],
  "grossAmountIn":          "5000000000000000000",
  "minFinalOut":            "3505576500000000000000",
  "recipient":              "0xUserWalletAddress",
  "deadline":               1746403600,
  "swapDeadline":           1746400000,
  "relayerFee":             "3000000000000000",
  "relayerFeeTokenAmount":  "0",
  "relayerFeeAdapterId":    "0x0000000000000000000000000000000000000000000000000000000000000000",
  "relayerFeeAdapterData":  "0x"
}'
```

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
          "adapterId":   "0x70616e63616b655f76330000000000000000000000000000000000000000000000",
          "tokenIn":     "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
          "tokenOut":    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
          "minOut":      "8492277500000000",
          "adapterData": "0x..."
        },
        {
          "adapterId":   "0x6f6e656d656d655f62630000000000000000000000000000000000000000000000",
          "tokenIn":     "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
          "tokenOut":    "0x000000000000000000000000000000000000meme",
          "minOut":      "3505576500000000000000",
          "adapterData": "0x..."
        }
      ],
      "grossAmountIn":          "5000000000000000000",
      "minFinalOut":            "3505576500000000000000",
      "recipient":              "0xUserWalletAddress",
      "swapDeadline":           "1746400000",
      "relayerFee":             "3000000000000000",
      "relayerFeeTokenAmount":  "0",
      "relayerFeeAdapterId":    "0x0000000000000000000000000000000000000000000000000000000000000000",
      "relayerFeeAdapterData":  "0x"
    },
    "aggregatorFeeEstimate": "25000000000000000"
  }
}
```

**Step 4** — sign `digest` client-side with the user's wallet, then:

**Step 5** — POST /dex/metatx/batch-relay:

---

## POST /dex/metatx/batch-relay

Submits a signed `BatchMetaTxOrder` on-chain. The relayer pays gas and receives `relayerFee` BNB — either split from BNB output directly, or from a `relayerFeeTokenAmount` of ERC-20 output swapped to BNB atomically.

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/dex/metatx/batch-relay' \
  -H 'Content-Type: application/json' \
  -d '{
  "order":      { "...": "BatchMetaTxOrder from batch-digest response" },
  "sig":        "0x...(65-byte EIP-712 signature)...",
  "permitType": 0,
  "permitData": "0x"
}'
```

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
| `AGGREGATOR_ADDRESS` | Yes (`POST /dex/swap`, `POST /dex/batch-swap`, `POST /dex/metatx/*`) | OneMEMEAggregator contract — must expose both `swap()` and `batchSwap()` |
| `METATX_ADDRESS` | Yes (`POST /dex/metatx/*`) | OneMEMEMetaTx contract address |
| `RELAYER_PRIVATE_KEY` | Yes (`POST /dex/metatx/relay`) | 0x-prefixed private key of the funded relayer EOA |
| `BSC_RPC_URL` | Yes (quotes, relay) | BSC HTTP RPC for contract reads and relay broadcast |
| `FOURMEME_HELPER_ADDRESS` | No | TokenManagerHelper3 address (default: BSC mainnet) |
| `FLAPSH_PORTAL_ADDRESS` | No | Flap.SH Portal address (default: BSC mainnet) |
| `PANCAKE_V2_ROUTER_ADDRESS` | No | PancakeSwap V2 Router (default: BSC mainnet) |
| `PANCAKE_V3_QUOTER_ADDRESS` | No | PancakeSwap V3 QuoterV2 (default: BSC mainnet) |
| `UNISWAP_V2_ROUTER_ADDRESS` | No | Uniswap V2 Router (default: BSC mainnet) |
| `UNISWAP_V3_QUOTER_ADDRESS` | No | Uniswap V3 Quoter (no BSC default; set if deployed) |
| `PANCAKE_V4_QUOTER_ADDRESS` | No | PancakeSwap V4 Quoter _(unused while V4 routing is disabled)_ |
| `UNISWAP_V4_QUOTER_ADDRESS` | No | Uniswap V4 Quoter _(unused while V4 routing is disabled)_ |
