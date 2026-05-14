# OneSwap API — Examples

Complete `curl` reference and response shapes for all `/oneswap` endpoints.

**Base URL:** `https://api.1coin.meme/api/v1/bsc`

All `/oneswap` endpoints require `BSC_RPC_URL` to be configured. All amounts are wei strings. Pass `0x0000000000000000000000000000000000000000` or the string `"native"` as `tokenIn` / `tokenOut` for native BNB.

---

## Table of Contents

1. [Token Detect](#1-token-detect)
2. [Quote](#2-quote)
3. [Route — direct (BNB ↔ token)](#3-route--direct-bnb--token)
4. [Route — multi-hop (token → token)](#4-route--multi-hop-token--token)
5. [Execute — BNB input](#5-execute--bnb-input)
6. [Execute — ERC20 input](#6-execute--erc20-input)
7. [Execute — token-to-token (multi-hop)](#7-execute--token-to-token-multi-hop)
8. [Execute Permit2 — Step 1 (get typed data)](#8-execute-permit2--step-1-get-typed-data)
9. [Execute Permit2 — Step 2 (submit signature)](#9-execute-permit2--step-2-submit-signature)
10. [Error responses](#10-error-responses)
11. [Wallet integration (viem)](#11-wallet-integration-viem)

---

## 1. Token Detect

Detect which protocol a token is currently trading on before quoting.

```bash
# Token on OneMEME bonding curve
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/tokens/0xYourToken'
```

```json
{
  "data": {
    "token":        "0xyourtoken",
    "bondingCurve": "onememe",
    "graduated":    false,
    "isTaxToken":   false,
    "ammProtocols": []
  }
}
```

```bash
# Token still on FourMEME bonding curve
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/tokens/0xFourMemeToken'
```

```json
{
  "data": {
    "token":        "0xfourmemetoken",
    "bondingCurve": "fourmeme",
    "graduated":    false,
    "isTaxToken":   false,
    "ammProtocols": []
  }
}
```

```bash
# Graduated FourMEME TaxToken — V2-only routing
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/tokens/0xTaxToken'
```

```json
{
  "data": {
    "token":        "0xtaxtoken",
    "bondingCurve": null,
    "graduated":    true,
    "isTaxToken":   true,
    "ammProtocols": ["pancake_v2", "uniswap_v2"]
  }
}
```

```bash
# Normal ERC20 / graduated token — routed via all AMMs
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/tokens/0x55d398326f99059fF775485246999027B3197955'
```

```json
{
  "data": {
    "token":        "0x55d398326f99059ff775485246999027b3197955",
    "bondingCurve": null,
    "graduated":    false,
    "isTaxToken":   false,
    "ammProtocols": ["pancake_v2", "uniswap_v2", "pancake_v3", "uniswap_v3", "uniswap_v4"]
  }
}
```

---

## 2. Quote

Returns all **direct** protocol quotes for a pair, sorted best-first.

> **Note:** `/quote` only shows direct single-protocol quotes. For token-to-token pairs that require routing through BNB as an intermediate, use `/route` instead — it runs multi-hop pathfinding automatically.

```bash
# Buy a bonding-curve token with 0.1 BNB
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/quote?tokenIn=native&tokenOut=0xYourToken&amountIn=100000000000000000'
```

```json
{
  "data": {
    "tokenIn":  "0x0000000000000000000000000000000000000000",
    "tokenOut": "0xyourtoken",
    "amountIn": "100000000000000000",
    "quotes": [
      {
        "protocol": "onememe",
        "amountOut": "4823901234567890000000",
        "fee": "0"
      }
    ]
  }
}
```

```bash
# Swap 1 BNB → USDT across AMMs
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/quote?tokenIn=native&tokenOut=0x55d398326f99059fF775485246999027B3197955&amountIn=1000000000000000000'
```

```json
{
  "data": {
    "tokenIn":  "0x0000000000000000000000000000000000000000",
    "tokenOut": "0x55d398326f99059ff775485246999027b3197955",
    "amountIn": "1000000000000000000",
    "quotes": [
      { "protocol": "pancake_v3", "amountOut": "298750000000000000000", "fee": "0" },
      { "protocol": "uniswap_v3", "amountOut": "298200000000000000000", "fee": "0" },
      { "protocol": "pancake_v2", "amountOut": "297100000000000000000", "fee": "0" }
    ]
  }
}
```

```bash
# Sell a meme token for BNB
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/quote?tokenIn=0xYourToken&tokenOut=native&amountIn=1000000000000000000000'
```

```json
{
  "data": {
    "tokenIn":  "0xyourtoken",
    "tokenOut": "0x0000000000000000000000000000000000000000",
    "amountIn": "1000000000000000000000",
    "quotes": [
      {
        "protocol": "onememe",
        "amountOut": "19800000000000000",
        "fee": "0"
      }
    ]
  }
}
```

```bash
# Token-to-token — returns empty (no direct pair); use /route for multi-hop
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/quote?tokenIn=0x55d398326f99059fF775485246999027B3197955&tokenOut=0xYourToken&amountIn=10000000000000000000'
```

```json
{
  "data": {
    "tokenIn":  "0x55d398326f99059ff775485246999027b3197955",
    "tokenOut": "0xyourtoken",
    "amountIn": "10000000000000000000",
    "quotes":   []
  }
}
```

---

## 3. Route — direct (BNB ↔ token)

Optimal route with `executionData` and `minAmountOut` ready for `OneDex.execute()`.

`amountOut` is the net amount after the 0.5% OneDex fee. `minAmountOut` applies slippage on top — pass this directly to `OneDex.execute()`.

```bash
# Buy a bonding-curve token with 0.5 BNB
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/route?tokenIn=native&tokenOut=0xYourToken&amountIn=500000000000000000&recipient=0xYourWallet'
```

```json
{
  "data": {
    "tokenIn":       "0x0000000000000000000000000000000000000000",
    "tokenOut":      "0xyourtoken",
    "amountIn":      "500000000000000000",
    "amountOut":     "23900000000000000000000",
    "minAmountOut":  "23780500000000000000000",
    "kind":          "direct",
    "slippageBps":   "50",
    "totalFee":      "0",
    "oneDex":        "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
    "executionData": "0x...",
    "paths": [
      {
        "splitBps":  "10000",
        "amountIn":  "500000000000000000",
        "amountOut": "23900000000000000000000",
        "steps": [
          {
            "protocol":  "onememe",
            "tokenIn":   "0x0000000000000000000000000000000000000000",
            "tokenOut":  "0xyourtoken",
            "amountIn":  "500000000000000000",
            "amountOut": "23900000000000000000000"
          }
        ]
      }
    ]
  }
}
```

```bash
# Split route — 1 BNB → USDT with 1% slippage
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/route?tokenIn=native&tokenOut=0x55d398326f99059fF775485246999027B3197955&amountIn=1000000000000000000&recipient=0xYourWallet&slippageBps=100'
```

```json
{
  "data": {
    "tokenIn":       "0x0000000000000000000000000000000000000000",
    "tokenOut":      "0x55d398326f99059ff775485246999027b3197955",
    "amountIn":      "1000000000000000000",
    "amountOut":     "299100000000000000000",
    "minAmountOut":  "296109000000000000000",
    "kind":          "split",
    "slippageBps":   "100",
    "totalFee":      "0",
    "oneDex":        "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
    "executionData": "0x...",
    "paths": [
      {
        "splitBps":  "6000",
        "amountIn":  "600000000000000000",
        "amountOut": "179600000000000000000",
        "steps": [
          {
            "protocol":  "pancake_v3",
            "tokenIn":   "0x0000000000000000000000000000000000000000",
            "tokenOut":  "0x55d398326f99059ff775485246999027b3197955",
            "amountIn":  "600000000000000000",
            "amountOut": "179600000000000000000"
          }
        ]
      },
      {
        "splitBps":  "4000",
        "amountIn":  "400000000000000000",
        "amountOut": "119500000000000000000",
        "steps": [
          {
            "protocol":  "uniswap_v3",
            "tokenIn":   "0x0000000000000000000000000000000000000000",
            "tokenOut":  "0x55d398326f99059ff775485246999027b3197955",
            "amountIn":  "400000000000000000",
            "amountOut": "119500000000000000000"
          }
        ]
      }
    ]
  }
}
```

---

## 4. Route — multi-hop (token → token)

When no direct liquidity exists between two tokens, the router automatically finds a path through native BNB as an intermediate. This handles:

- **ERC20 → bonding-curve token** (e.g. USDT → meme): USDT → BNB (AMM) → meme (bonding curve)
- **Bonding-curve token → ERC20** (e.g. meme → USDT): meme (bonding curve) → BNB → USDT (AMM)
- **Bonding-curve token → bonding-curve token**: meme1 → BNB → meme2

```bash
# USDT → meme token (routes through BNB automatically)
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/route?tokenIn=0x55d398326f99059fF775485246999027B3197955&tokenOut=0xYourToken&amountIn=10000000000000000000&recipient=0xYourWallet'
```

```json
{
  "data": {
    "tokenIn":       "0x55d398326f99059ff775485246999027b3197955",
    "tokenOut":      "0xyourtoken",
    "amountIn":      "10000000000000000000",
    "amountOut":     "47650000000000000000000",
    "minAmountOut":  "47411750000000000000000",
    "kind":          "multihop",
    "slippageBps":   "50",
    "totalFee":      "0",
    "oneDex":        "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
    "executionData": "0x...",
    "paths": [
      {
        "splitBps":  "10000",
        "amountIn":  "10000000000000000000",
        "amountOut": "47650000000000000000000",
        "steps": [
          {
            "protocol":  "pancake_v3",
            "tokenIn":   "0x55d398326f99059ff775485246999027b3197955",
            "tokenOut":  "0x0000000000000000000000000000000000000000",
            "amountIn":  "10000000000000000000",
            "amountOut": "16700000000000000"
          },
          {
            "protocol":  "onememe",
            "tokenIn":   "0x0000000000000000000000000000000000000000",
            "tokenOut":  "0xyourtoken",
            "amountIn":  "16700000000000000",
            "amountOut": "47650000000000000000000"
          }
        ]
      }
    ]
  }
}
```

```bash
# meme token → USDT
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/route?tokenIn=0xYourToken&tokenOut=0x55d398326f99059fF775485246999027B3197955&amountIn=1000000000000000000000&recipient=0xYourWallet'
```

```json
{
  "data": {
    "tokenIn":       "0xyourtoken",
    "tokenOut":      "0x55d398326f99059ff775485246999027b3197955",
    "amountIn":      "1000000000000000000000",
    "amountOut":     "9850000000000000000",
    "minAmountOut":  "9800750000000000000",
    "kind":          "multihop",
    "slippageBps":   "50",
    "totalFee":      "0",
    "oneDex":        "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
    "executionData": "0x...",
    "paths": [
      {
        "splitBps":  "10000",
        "amountIn":  "1000000000000000000000",
        "amountOut": "9850000000000000000",
        "steps": [
          {
            "protocol":  "onememe",
            "tokenIn":   "0xyourtoken",
            "tokenOut":  "0x0000000000000000000000000000000000000000",
            "amountIn":  "1000000000000000000000",
            "amountOut": "19800000000000000"
          },
          {
            "protocol":  "pancake_v3",
            "tokenIn":   "0x0000000000000000000000000000000000000000",
            "tokenOut":  "0x55d398326f99059ff775485246999027b3197955",
            "amountIn":  "19800000000000000",
            "amountOut": "9850000000000000000"
          }
        ]
      }
    ]
  }
}
```

```bash
# meme → meme (both on bonding curve)
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/route?tokenIn=0xTokenA&tokenOut=0xTokenB&amountIn=1000000000000000000000&recipient=0xYourWallet'
```

```json
{
  "data": {
    "tokenIn":       "0xtokena",
    "tokenOut":      "0xtokenb",
    "amountIn":      "1000000000000000000000",
    "amountOut":     "52100000000000000000000",
    "minAmountOut":  "51839500000000000000000",
    "kind":          "multihop",
    "slippageBps":   "50",
    "totalFee":      "0",
    "oneDex":        "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
    "executionData": "0x...",
    "paths": [
      {
        "splitBps":  "10000",
        "amountIn":  "1000000000000000000000",
        "amountOut": "52100000000000000000000",
        "steps": [
          {
            "protocol":  "onememe",
            "tokenIn":   "0xtokena",
            "tokenOut":  "0x0000000000000000000000000000000000000000",
            "amountIn":  "1000000000000000000000",
            "amountOut": "19800000000000000"
          },
          {
            "protocol":  "onememe",
            "tokenIn":   "0x0000000000000000000000000000000000000000",
            "tokenOut":  "0xtokenb",
            "amountIn":  "19800000000000000",
            "amountOut": "52100000000000000000000"
          }
        ]
      }
    ]
  }
}
```

---

## 5. Execute — BNB input

Returns a complete unsigned transaction. For BNB input, `approval` is `null` — broadcast `tx` immediately.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/execute?tokenIn=native&tokenOut=0xYourToken&amountIn=500000000000000000&recipient=0xYourWallet'
```

```json
{
  "data": {
    "tx": {
      "to":    "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
      "data":  "0x...",
      "value": "500000000000000000",
      "from":  "0xYourWallet"
    },
    "approval":     null,
    "tokenIn":      "0x0000000000000000000000000000000000000000",
    "tokenOut":     "0xyourtoken",
    "amountIn":     "500000000000000000",
    "amountOut":    "23900000000000000000000",
    "minAmountOut": "23780500000000000000000",
    "kind":         "direct",
    "slippageBps":  "50",
    "deadline":     "1715000300",
    "oneDex":       "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
    "permit2":      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "paths": [ "..." ]
  }
}
```

---

## 6. Execute — ERC20 input

For ERC20 `tokenIn`, `approval` is populated. Send the approval transaction first, then broadcast `tx`.

```bash
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/execute?tokenIn=0xYourToken&tokenOut=native&amountIn=1000000000000000000000&recipient=0xYourWallet'
```

```json
{
  "data": {
    "tx": {
      "to":    "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
      "data":  "0x...",
      "value": "0",
      "from":  "0xYourWallet"
    },
    "approval": {
      "token":   "0xyourtoken",
      "spender": "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
      "amount":  "1000000000000000000000"
    },
    "tokenIn":      "0xyourtoken",
    "tokenOut":     "0x0000000000000000000000000000000000000000",
    "amountIn":     "1000000000000000000000",
    "amountOut":    "19800000000000000",
    "minAmountOut": "19701000000000000",
    "kind":         "direct",
    "slippageBps":  "50",
    "deadline":     "1715000300",
    "oneDex":       "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
    "permit2":      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "paths": [ "..." ]
  }
}
```

---

## 7. Execute — token-to-token (multi-hop)

For token-to-token swaps, the router builds a two-step path through native BNB. The `tx.data` encodes both steps atomically in a single `OneDex.execute()` call.

For ERC20 `tokenIn`, an `approval` is required. For a bonding-curve `tokenIn`, `approval` contains the meme token and `value` is `"0"` (BNB is received mid-execution, not sent upfront).

```bash
# USDT → meme token (ERC20 approval required)
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/execute?tokenIn=0x55d398326f99059fF775485246999027B3197955&tokenOut=0xYourToken&amountIn=10000000000000000000&recipient=0xYourWallet'
```

```json
{
  "data": {
    "tx": {
      "to":    "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
      "data":  "0x...",
      "value": "0",
      "from":  "0xYourWallet"
    },
    "approval": {
      "token":   "0x55d398326f99059ff775485246999027b3197955",
      "spender": "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
      "amount":  "10000000000000000000"
    },
    "tokenIn":      "0x55d398326f99059ff775485246999027b3197955",
    "tokenOut":     "0xyourtoken",
    "amountIn":     "10000000000000000000",
    "amountOut":    "47650000000000000000000",
    "minAmountOut": "47411750000000000000000",
    "kind":         "multihop",
    "slippageBps":  "50",
    "deadline":     "1715000300",
    "oneDex":       "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
    "permit2":      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "paths": [ "..." ]
  }
}
```

```bash
# meme → meme (approve meme1, broadcast single tx)
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/execute?tokenIn=0xTokenA&tokenOut=0xTokenB&amountIn=1000000000000000000000&recipient=0xYourWallet'
```

```json
{
  "data": {
    "tx": {
      "to":    "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
      "data":  "0x...",
      "value": "0",
      "from":  "0xYourWallet"
    },
    "approval": {
      "token":   "0xtokena",
      "spender": "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
      "amount":  "1000000000000000000000"
    },
    "tokenIn":      "0xtokena",
    "tokenOut":     "0xtokenb",
    "amountIn":     "1000000000000000000000",
    "amountOut":    "52100000000000000000000",
    "minAmountOut": "51839500000000000000000",
    "kind":         "multihop",
    "slippageBps":  "50",
    "deadline":     "1715000300",
    "oneDex":       "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
    "permit2":      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "paths": [ "..." ]
  }
}
```

---

## 8. Execute Permit2 — Step 1 (get typed data)

Permit2 eliminates the separate approve transaction. The user signs an off-chain EIP-712 message and the swap executes in a single transaction. Only available for ERC20 `tokenIn`.

**Prerequisite:** the user must have approved the Permit2 contract once per token:
`token.approve(0x000000000022D473030F116dDEE9F6B43aC78BA3, maxUint256)`

```bash
curl 'https://api.1coin.meme/api/v1/bsc/oneswap/execute/permit2?tokenIn=0xYourToken&tokenOut=native&amountIn=1000000000000000000000&recipient=0xYourWallet'
```

```json
{
  "data": {
    "typedData": {
      "domain": {
        "name":              "Permit2",
        "chainId":           56,
        "verifyingContract": "0x000000000022D473030F116dDEE9F6B43aC78BA3"
      },
      "types": {
        "PermitTransferFrom": [
          { "name": "permitted", "type": "TokenPermissions" },
          { "name": "spender",   "type": "address"          },
          { "name": "nonce",     "type": "uint256"           },
          { "name": "deadline",  "type": "uint256"           }
        ],
        "TokenPermissions": [
          { "name": "token",  "type": "address" },
          { "name": "amount", "type": "uint256" }
        ]
      },
      "primaryType": "PermitTransferFrom",
      "message": {
        "permitted": {
          "token":  "0xyourtoken",
          "amount": "1000000000000000000000"
        },
        "spender":  "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
        "nonce":    "72348912340000000000000000000",
        "deadline": "1715000300"
      }
    },
    "nonce":    "72348912340000000000000000000",
    "nextStep": "POST /oneswap/execute/permit2/submit",
    "tokenIn":      "0xyourtoken",
    "tokenOut":     "0x0000000000000000000000000000000000000000",
    "amountIn":     "1000000000000000000000",
    "amountOut":    "19800000000000000",
    "minAmountOut": "19701000000000000",
    "kind":         "direct",
    "slippageBps":  "50",
    "deadline":     "1715000300",
    "oneDex":       "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
    "permit2":      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "paths": [ "..." ]
  }
}
```

---

## 9. Execute Permit2 — Step 2 (submit signature)

Sign the `typedData` returned in step 1, then POST the signature. Returns the final `executeWithPermit2()` calldata — broadcast directly, no prior approve needed.

```bash
curl -X POST 'https://api.1coin.meme/api/v1/bsc/oneswap/execute/permit2/submit' \
  -H 'Content-Type: application/json' \
  -d '{
    "tokenIn":      "0xYourToken",
    "tokenOut":     "native",
    "amountIn":     "1000000000000000000000",
    "recipient":    "0xYourWallet",
    "slippageBps":  "50",
    "deadline":     "1715000300",
    "permit2Nonce": "72348912340000000000000000000",
    "signature":    "0x<65-byte-ecdsa-signature>"
  }'
```

```json
{
  "data": {
    "tx": {
      "to":    "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
      "data":  "0x...",
      "value": "0",
      "from":  "0xYourWallet"
    },
    "approval":     null,
    "usedPermit2":  true,
    "tokenIn":      "0xyourtoken",
    "tokenOut":     "0x0000000000000000000000000000000000000000",
    "amountIn":     "1000000000000000000000",
    "amountOut":    "19800000000000000",
    "minAmountOut": "19701000000000000",
    "kind":         "direct",
    "slippageBps":  "50",
    "deadline":     "1715000300",
    "oneDex":       "0x4283F36F8B7A03513FE5C228c2823a147efF253C",
    "permit2":      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "paths": [ "..." ]
  }
}
```

---

## 10. Error responses

All errors follow the NestJS exception shape:

```json
{ "statusCode": 400, "message": "tokenIn is required" }
```

| Status | When |
|---|---|
| `400` | Missing or invalid parameter — `tokenIn`/`tokenOut`/`amountIn`, `slippageBps` out of range, `deadline` in the past, `tokenIn === tokenOut`, native BNB used on Permit2 endpoint |
| `404` | No route found for this token pair |
| `503` | `BSC_RPC_URL` not configured, or routing RPC calls failed |

---

## 11. Wallet integration (viem)

### BNB → token (direct buy)

```typescript
const BASE = "https://api.1coin.meme/api/v1/bsc";

const res = await fetch(
  `${BASE}/oneswap/execute?tokenIn=native&tokenOut=${TOKEN}&amountIn=${parseEther("0.5")}&recipient=${wallet}`
).then(r => r.json());

await walletClient.sendTransaction({
  to:    res.data.tx.to,
  data:  res.data.tx.data,
  value: BigInt(res.data.tx.value),
});
```

### Token → BNB (direct sell, with approval)

```typescript
const res = await fetch(
  `${BASE}/oneswap/execute?tokenIn=${TOKEN}&tokenOut=native&amountIn=${amountIn}&recipient=${wallet}`
).then(r => r.json());

if (res.data.approval) {
  await walletClient.writeContract({
    address:      res.data.approval.token,
    abi:          erc20Abi,
    functionName: "approve",
    args:         [res.data.approval.spender, BigInt(res.data.approval.amount)],
  });
}

await walletClient.sendTransaction({
  to:    res.data.tx.to,
  data:  res.data.tx.data,
  value: BigInt(res.data.tx.value),
});
```

### Token → token (multi-hop, with approval)

```typescript
const res = await fetch(
  `${BASE}/oneswap/execute?tokenIn=${TOKEN_A}&tokenOut=${TOKEN_B}&amountIn=${amountIn}&recipient=${wallet}`
).then(r => r.json());

// Always approve for ERC20 tokenIn (includes meme tokens)
if (res.data.approval) {
  await walletClient.writeContract({
    address:      res.data.approval.token,
    abi:          erc20Abi,
    functionName: "approve",
    args:         [res.data.approval.spender, BigInt(res.data.approval.amount)],
  });
}

// Single tx executes both hops atomically
await walletClient.sendTransaction({
  to:    res.data.tx.to,
  data:  res.data.tx.data,
  value: BigInt(res.data.tx.value),  // "0" for token→token
});
```

### Permit2 flow (ERC20 → single transaction, no separate approve)

```typescript
// Step 1 — get typed data to sign
const step1 = await fetch(
  `${BASE}/oneswap/execute/permit2?tokenIn=${TOKEN}&tokenOut=native&amountIn=${amountIn}&recipient=${wallet}`
).then(r => r.json());

// Sign off-chain — no on-chain tx
const signature = await walletClient.signTypedData(step1.data.typedData);

// Step 2 — submit signature, get final tx
const step2 = await fetch(`${BASE}/oneswap/execute/permit2/submit`, {
  method:  "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tokenIn:      TOKEN,
    tokenOut:     "native",
    amountIn,
    recipient:    wallet,
    slippageBps:  "50",
    deadline:     step1.data.deadline,
    permit2Nonce: step1.data.nonce,
    signature,
  }),
}).then(r => r.json());

// Broadcast — no prior approve needed
await walletClient.sendTransaction({
  to:    step2.data.tx.to,
  data:  step2.data.tx.data,
  value: BigInt(step2.data.tx.value),
});
```

### Optional query parameters

| Param | Default | Description |
|---|---|---|
| `slippageBps` | `50` | Slippage tolerance in bps (0–1000). 50 = 0.5%, 100 = 1% |
| `deadline` | `now + 300 s` | Unix timestamp after which the on-chain tx reverts |
| `deadlineOffset` | `300` | Seconds from now for the deadline (alternative to absolute `deadline`) |
