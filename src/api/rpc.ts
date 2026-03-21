/**
 * On-chain RPC client for real-time quote simulation.
 *
 * Calls view functions on the BondingCurve contract directly, bypassing the
 * indexed database. This ensures quotes reflect the live bonding-curve state
 * even between indexer sync cycles.
 *
 * getAmountOut, getAmountOutSell, and getSpotPrice live on the BondingCurve
 * contract — NOT on LaunchpadFactory. rpc.ts must use BONDING_CURVE_ADDRESS.
 *
 * All functions throw if BSC_RPC_URL or BONDING_CURVE_ADDRESS are not set.
 * The quotes route catches these and returns a 503 with a helpful message.
 */

import { createPublicClient, fallback, http, webSocket, parseAbi, defineChain } from "viem";

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * Lazily-initialised public client. Created on first call so that importing
 * this module does not crash if env vars are absent at startup.
 *
 * Transport: BSC_WSS_URL (primary) → BSC_RPC_URL (fallback).
 * viem's fallback() switches on error or timeout and retries primary on next request.
 */
let _client: ReturnType<typeof createPublicClient> | null = null;

function getClient(): ReturnType<typeof createPublicClient> {
  if (!process.env.BSC_RPC_URL) {
    throw new Error(
      "BSC_RPC_URL is not configured. Quote simulation requires a BSC RPC endpoint."
    );
  }
  if (!_client) {
    const chainId = parseInt(process.env.CHAIN_ID ?? "56");
    const chain   = defineChain({ id: chainId, name: "EVM", nativeCurrency: { name: "Native", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [process.env.BSC_RPC_URL] } } });
    const transports = [
      ...(process.env.BSC_WSS_URL ? [webSocket(process.env.BSC_WSS_URL)] : []),
      http(process.env.BSC_RPC_URL, { timeout: 10_000, retryCount: 2, retryDelay: 500 }),
    ];
    _client = createPublicClient({
      chain,
      transport: fallback(transports),
    });
  }
  return _client;
}

export function bondingCurveAddress(): `0x${string}` {
  if (!process.env.BONDING_CURVE_ADDRESS) {
    throw new Error(
      "BONDING_CURVE_ADDRESS is not configured. Set it in your .env file."
    );
  }
  return process.env.BONDING_CURVE_ADDRESS as `0x${string}`;
}

// ─── ABI (BondingCurve view functions only) ───────────────────────────────────

const BONDING_CURVE_ABI = parseAbi([
  // Buy quote: returns (tokensOut, feeBNB) given BNB in
  "function getAmountOut(address token_, uint256 bnbIn) view returns (uint256 tokensOut, uint256 feeBNB)",

  // Sell quote: returns (bnbOut, feeBNB) given tokens in
  "function getAmountOutSell(address token_, uint256 tokensIn) view returns (uint256 bnbOut, uint256 feeBNB)",

  // Current spot price: BNB per token scaled to 18 decimals
  "function getSpotPrice(address token_) view returns (uint256)",
]);

// ─── Quote helpers ────────────────────────────────────────────────────────────

/**
 * Returns the estimated token output for a given BNB input on the bonding curve.
 * Reflects the live contract state including trade fees and antibot penalties.
 *
 * @param token  Token contract address
 * @param bnbIn  BNB input in wei (18 decimals)
 * @returns      Estimated tokens out in wei
 */
export async function quoteBuy(
  token: `0x${string}`,
  bnbIn: bigint
): Promise<bigint> {
  const [tokensOut] = await getClient().readContract({
    address:      bondingCurveAddress(),
    abi:          BONDING_CURVE_ABI,
    functionName: "getAmountOut",
    args:         [token, bnbIn],
  }) as [bigint, bigint];
  return tokensOut;
}

/**
 * Returns the estimated BNB output for a given token input on the bonding curve.
 *
 * @param token     Token contract address
 * @param tokensIn  Token input in wei (18 decimals)
 * @returns         Estimated BNB out in wei
 */
export async function quoteSell(
  token: `0x${string}`,
  tokensIn: bigint
): Promise<bigint> {
  const [bnbOut] = await getClient().readContract({
    address:      bondingCurveAddress(),
    abi:          BONDING_CURVE_ABI,
    functionName: "getAmountOutSell",
    args:         [token, tokensIn],
  }) as [bigint, bigint];
  return bnbOut;
}

/**
 * Returns the current spot price of a token on the bonding curve.
 *
 * The return value is BNB per token, scaled to 18 decimals.
 * Example: 81_000_000_000_000n = 0.000081 BNB per token.
 *
 * @param token  Token contract address
 * @returns      Spot price in wei (BNB / token * 1e18)
 */
export async function getSpotPrice(token: `0x${string}`): Promise<bigint> {
  return getClient().readContract({
    address:      bondingCurveAddress(),
    abi:          BONDING_CURVE_ABI,
    functionName: "getSpotPrice",
    args:         [token],
  }) as Promise<bigint>;
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

/**
 * Computes minimum acceptable output after applying a slippage tolerance.
 *
 * @param amount       Gross output amount (wei)
 * @param slippageBps  Slippage tolerance in basis points (e.g. 100 = 1%)
 * @returns            Minimum output with slippage applied
 */
export function applySlippage(amount: bigint, slippageBps: bigint): bigint {
  return (amount * (10_000n - slippageBps)) / 10_000n;
}

/**
 * Computes price impact in basis points.
 *
 * For a buy:  impact = (effectivePrice - spotPrice) / spotPrice * 10_000
 * For a sell: impact = (spotPrice - effectivePrice) / spotPrice * 10_000
 *
 * @param spotPrice      Current spot price (BNB per token, wei)
 * @param amountIn       Trade input (BNB for buy, tokens for sell)
 * @param amountOut      Trade output (tokens for buy, BNB for sell)
 * @param side           "buy" or "sell"
 * @returns              Price impact in basis points (positive = worse than spot)
 */
export function priceImpactBps(
  spotPrice:  bigint,
  amountIn:   bigint,
  amountOut:  bigint,
  side:       "buy" | "sell"
): bigint {
  if (amountOut === 0n || spotPrice === 0n) return 0n;

  // Effective price: BNB per token (same unit as spotPrice)
  const effectivePrice =
    side === "buy"
      ? (amountIn  * BigInt(1e18)) / amountOut  // bnbIn / tokensOut
      : (amountOut * BigInt(1e18)) / amountIn;  // bnbOut / tokensIn

  if (effectivePrice === 0n) return 0n;

  const diff =
    side === "buy"
      ? effectivePrice - spotPrice     // buy above spot → positive impact
      : spotPrice - effectivePrice;    // sell below spot → positive impact

  return (diff * 10_000n) / spotPrice;
}

// ─── PancakeSwap V2 pair helpers ──────────────────────────────────────────────

const PAIR_ABI = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
]);

/**
 * Fetches live price and market cap for a migrated token from its PancakeSwap V2 pair.
 * Returns null if the call fails (pair not yet created, RPC error, etc.).
 *
 * @param pairAddress    PancakeSwap V2 pair contract address
 * @param tokenAddress   Token contract address (to determine reserve ordering)
 * @param totalSupplyWei Token total supply in wei (18 decimals)
 * @returns { priceBnb, marketCapBnb } as decimal strings, or null on failure
 */
export async function getPairPrice(
  pairAddress:    `0x${string}`,
  tokenAddress:   `0x${string}`,
  totalSupplyWei: bigint,
): Promise<{ priceBnb: string; marketCapBnb: string } | null> {
  try {
    const client = getClient();
    const [token0, [reserve0, reserve1]] = await Promise.all([
      client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: "token0" }),
      client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: "getReserves" }),
    ]) as [`0x${string}`, [bigint, bigint, number]];

    const isToken0     = token0.toLowerCase() === tokenAddress.toLowerCase();
    const tokenReserve = isToken0 ? reserve0 : reserve1;
    const bnbReserve   = isToken0 ? reserve1 : reserve0;

    if (tokenReserve === 0n || bnbReserve === 0n) return null;

    // price (BNB per token) = bnbReserve / tokenReserve, scaled to 18 decimals
    const SCALE        = BigInt("1000000000000000000");
    const priceScaled  = (bnbReserve * SCALE) / tokenReserve;
    const marketCapWei = (bnbReserve * totalSupplyWei) / tokenReserve;

    return {
      priceBnb:     formatBigDecimal(priceScaled,  18),
      marketCapBnb: formatBigDecimal(marketCapWei, 18),
    };
  } catch {
    return null;
  }
}

function formatBigDecimal(value: bigint, decimals: number): string {
  const s       = value.toString().padStart(decimals + 1, "0");
  const intPart = s.slice(0, -decimals) || "0";
  const decPart = s.slice(-decimals).replace(/0+$/, "") || "0";
  return `${intPart}.${decPart}`;
}

// ─── Token contract helpers ────────────────────────────────────────────────────

const TOKEN_ABI = parseAbi([
  "function metaURI() view returns (string)",
]);

/**
 * Reads the `metaURI` field from an individual token contract.
 * Returns an empty string if the call fails (e.g. token not yet deployed).
 */
export async function getMetaURI(tokenAddress: `0x${string}`): Promise<string> {
  try {
    return await getClient().readContract({
      address:      tokenAddress,
      abi:          TOKEN_ABI,
      functionName: "metaURI",
    });
  } catch {
    return "";
  }
}
