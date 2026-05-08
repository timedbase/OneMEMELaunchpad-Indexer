/**
 * Well-known BSC tokens used across the DEX module.
 *
 * KNOWN_TOKENS:
 *   - Skip GoPlus security lookup (no transfer tax, no risk data needed)
 *   - Use feeOnInput=true in OneDex execute() — fee is deducted from amountIn
 *     because these tokens transfer exactly what is sent (no FOT surprises)
 *
 * All addresses are lowercase for O(1) Set lookup.
 */

export const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";

export const KNOWN_TOKENS = new Set<string>([
  WBNB,
  "0x55d398326f99059ff775485246999027b3197955", // USDT
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
  "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", // BTCB
  "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
  "0x2170ed0880ac9a755fd29b2688956bd959f933f8", // ETH (BSC)
  "0x570a5d26f7765ecd67c364b4670bb79b0f2aee04", // SOL (BSC)
  "0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe", // XRP (BSC)
  "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3", // DAI (BSC)
  "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d", // USD1
  "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82", // CAKE
]);

// Well-known tokens used as intermediate hops in two-hop routing.
// Subset of KNOWN_TOKENS — must have deep liquidity on BSC.
export const HUB_TOKENS: string[] = [
  WBNB,
  "0x55d398326f99059ff775485246999027b3197955", // USDT
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
  "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", // BTCB
];

/**
 * Returns true when OneDex should deduct its fee from amountIn rather than amountOut.
 * Native BNB (address(0)) and all KNOWN_TOKENS are guaranteed non-FOT, so the contract
 * receives exactly what was sent and the fee deduction is predictable.
 */
export function feeOnInput(tokenIn: string): boolean {
  return tokenIn === "0x0000000000000000000000000000000000000000"
    || KNOWN_TOKENS.has(tokenIn.toLowerCase());
}
