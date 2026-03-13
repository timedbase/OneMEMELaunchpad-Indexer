/**
 * On-chain RPC client for real-time quote simulation.
 *
 * Uses viem to call view functions on the LaunchpadFactory contract directly,
 * bypassing the indexed database. This ensures quotes reflect the live
 * bonding-curve state even between indexer sync cycles.
 *
 * All functions throw if BSC_RPC_URL or FACTORY_ADDRESS are not configured.
 * The quotes route catches these and returns a 503 with a helpful message.
 */

import { createPublicClient, http, parseAbi } from "viem";
import { bsc } from "viem/chains";

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * Lazily-initialised public client. Created on first call so that importing
 * this module does not crash if env vars are absent at startup.
 */
let _client: ReturnType<typeof createPublicClient> | null = null;

function getClient(): ReturnType<typeof createPublicClient> {
  if (!process.env.BSC_RPC_URL) {
    throw new Error(
      "BSC_RPC_URL is not configured. Quote simulation requires a BSC RPC endpoint."
    );
  }
  if (!_client) {
    _client = createPublicClient({
      chain:     bsc,
      transport: http(process.env.BSC_RPC_URL, {
        timeout:    10_000, // 10 s — fail fast rather than blocking the API
        retryCount: 2,
        retryDelay: 500,
      }),
    });
  }
  return _client;
}

export function factoryAddress(): `0x${string}` {
  if (!process.env.FACTORY_ADDRESS) {
    throw new Error(
      "FACTORY_ADDRESS is not configured. Set it in your .env file."
    );
  }
  return process.env.FACTORY_ADDRESS as `0x${string}`;
}

// ─── ABI (quote-related view functions only) ──────────────────────────────────

const FACTORY_ABI = parseAbi([
  // Bonding-curve buy quote: returns tokens out given BNB in (after trade fee)
  "function getAmountOut(address token, uint256 amountIn) view returns (uint256)",

  // Bonding-curve sell quote: returns BNB out given tokens in (after trade fee)
  "function getAmountOutSell(address token, uint256 amountIn) view returns (uint256)",

  // Current spot price: BNB per token, scaled to 18 decimals (wei per token)
  "function getSpotPrice(address token) view returns (uint256)",
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
  return getClient().readContract({
    address:      factoryAddress(),
    abi:          FACTORY_ABI,
    functionName: "getAmountOut",
    args:         [token, bnbIn],
  });
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
  return getClient().readContract({
    address:      factoryAddress(),
    abi:          FACTORY_ABI,
    functionName: "getAmountOutSell",
    args:         [token, tokensIn],
  });
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
    address:      factoryAddress(),
    abi:          FACTORY_ABI,
    functionName: "getSpotPrice",
    args:         [token],
  });
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
