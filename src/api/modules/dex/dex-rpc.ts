/**
 * On-chain client for OneDex.
 *
 * Intentionally separate from src/api/rpc.ts — owns its own viem client
 * instance and reads only ONEDEX_ADDRESS.
 * Never imports from or modifies the existing rpc.ts.
 */

import {
  createPublicClient,
  http,
  parseAbi,
  encodePacked,
  encodeAbiParameters,
  encodeFunctionData,
  defineChain,
  type Hex,
} from "viem";

// ─── Chain / Clients ──────────────────────────────────────────────────────────

function dexChain() {
  const chainId = parseInt(process.env.CHAIN_ID ?? "56");
  return defineChain({
    id:             chainId,
    name:           "EVM",
    nativeCurrency: { name: "Native", symbol: "BNB", decimals: 18 },
    rpcUrls:        { default: { http: [process.env.BSC_RPC_URL ?? "https://bsc-dataseed1.binance.org"] } },
  });
}

let _dexPublicClient: ReturnType<typeof createPublicClient> | null = null;

/** Lazily-initialised read-only client for DEX view calls. */
export function getDexPublicClient() {
  if (!_dexPublicClient) {
    _dexPublicClient = createPublicClient({
      chain:     dexChain(),
      transport: http(process.env.BSC_RPC_URL, { timeout: 10_000, retryCount: 2, retryDelay: 500 }),
    });
  }
  return _dexPublicClient;
}

// ─── Contract addresses ───────────────────────────────────────────────────────

export function oneDexAddress(): Hex {
  if (!process.env.ONEDEX_ADDRESS) {
    throw new Error("ONEDEX_ADDRESS is not configured.");
  }
  return process.env.ONEDEX_ADDRESS as Hex;
}

// ─── Adapter labels ───────────────────────────────────────────────────────────
// Used only for labelling route sources in API responses.
// No on-chain registry — routing logic is encoded as raw Step calldata.

export type AdapterName =
  | "ONEMEME_BC" | "FOURMEME"  | "FLAPSH"
  | "PANCAKE_V2" | "PANCAKE_V3" | "PANCAKE_V4"
  | "UNISWAP_V2" | "UNISWAP_V3" | "UNISWAP_V4";

/** All adapter names in display order. */
export const ADAPTER_NAMES: AdapterName[] = [
  "PANCAKE_V2", "UNISWAP_V2",
  "PANCAKE_V3", "UNISWAP_V3",
  "PANCAKE_V4", "UNISWAP_V4",
  "ONEMEME_BC", "FOURMEME", "FLAPSH",
];

// ─── Contract addresses (quote + execution) ───────────────────────────────────
// Configurable via env vars; defaults are BSC mainnet well-known addresses.

function pancakeV2RouterAddress(): Hex {
  return (process.env.PANCAKE_V2_ROUTER_ADDRESS
    ?? "0x10ED43C718714eb63d5aA57B78B54704E256024E") as Hex;
}

function uniswapV2RouterAddress(): Hex {
  return (process.env.UNISWAP_V2_ROUTER_ADDRESS
    ?? "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24") as Hex;
}

/** PancakeSwap V3 SmartRouter — used for step execution. */
function pancakeV3RouterAddress(): Hex {
  return (process.env.PANCAKE_V3_ROUTER_ADDRESS
    ?? "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4") as Hex;
}

function uniswapV3RouterAddress(): Hex {
  if (!process.env.UNISWAP_V3_ROUTER_ADDRESS) {
    throw new Error("UNISWAP_V3_ROUTER_ADDRESS is not configured.");
  }
  return process.env.UNISWAP_V3_ROUTER_ADDRESS as Hex;
}

function pancakeV3QuoterAddress(): Hex {
  return (process.env.PANCAKE_V3_QUOTER_ADDRESS
    ?? "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997") as Hex;
}

function uniswapV3QuoterAddress(): Hex {
  if (!process.env.UNISWAP_V3_QUOTER_ADDRESS) {
    throw new Error("UNISWAP_V3_QUOTER_ADDRESS is not configured.");
  }
  return process.env.UNISWAP_V3_QUOTER_ADDRESS as Hex;
}

function pancakeV4QuoterAddress(): Hex {
  if (!process.env.PANCAKE_V4_QUOTER_ADDRESS) {
    throw new Error("PANCAKE_V4_QUOTER_ADDRESS is not configured.");
  }
  return process.env.PANCAKE_V4_QUOTER_ADDRESS as Hex;
}

function uniswapV4QuoterAddress(): Hex {
  if (!process.env.UNISWAP_V4_QUOTER_ADDRESS) {
    throw new Error("UNISWAP_V4_QUOTER_ADDRESS is not configured.");
  }
  return process.env.UNISWAP_V4_QUOTER_ADDRESS as Hex;
}

function bondingCurveAddress(): Hex {
  if (!process.env.BONDING_CURVE_ADDRESS) {
    throw new Error("BONDING_CURVE_ADDRESS is not configured.");
  }
  return process.env.BONDING_CURVE_ADDRESS as Hex;
}

function fourMemeHelperAddress(): Hex {
  return (process.env.FOURMEME_HELPER_ADDRESS
    ?? "0xF251F83e40a78868FcfA3FA4599Dad6494E46034") as Hex;
}

function flapShPortalAddress(): Hex {
  return (process.env.FLAPSH_PORTAL_ADDRESS
    ?? "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0") as Hex;
}

// FourMEME V1 TokenManager address — used to distinguish V1 from V2 via tryBuy result.
const FOURMEME_V1_MANAGER = "0xec4549cadce5da21df6e6422d448034b5233bfbc";

// ─── V4 helpers ───────────────────────────────────────────────────────────────

/**
 * Derives the standard tickSpacing for a given V4 fee tier.
 * Matches the defaults used by PancakeSwap V4 and Uniswap V4 on BSC.
 */
export function defaultTickSpacing(fee: number): number {
  if (fee <= 100)  return 1;    // 0.01%
  if (fee <= 500)  return 10;   // 0.05%
  if (fee <= 2500) return 50;   // 0.25%
  if (fee <= 3000) return 60;   // 0.30%
  return 200;                   // 1.00%+
}

/**
 * Determines zeroForOne direction for a V4 swap.
 * In V4, currency0 is always the lower address (big-endian comparison).
 * zeroForOne = true when tokenIn is currency0 (the lower address).
 */
export function v4ZeroForOne(tokenIn: Hex, tokenOut: Hex): boolean {
  return tokenIn.toLowerCase() < tokenOut.toLowerCase();
}

// ─── Quote ABIs ───────────────────────────────────────────────────────────────

const V2_ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] amounts)",
  "function getAmountsIn(uint256 amountOut, address[] calldata path) view returns (uint256[] amounts)",
]);

const V3_QUOTER_ABI = parseAbi([
  // QuoterV2 — returns amountOut as first element
  "function quoteExactInput(bytes calldata path, uint256 amountIn) view returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

const BC_QUOTE_ABI = parseAbi([
  "function getAmountOut(address token_, uint256 bnbIn) view returns (uint256 tokensOut, uint256 feeBNB)",
  "function getAmountOutSell(address token_, uint256 tokensIn) view returns (uint256 bnbOut, uint256 feeBNB)",
]);

/**
 * FourMEME TokenManagerHelper3 — unified quote interface for V1 + V2 TokenManagers.
 * tryBuy: pass (token, 0, funds) to simulate a BNB→token buy.
 * trySell: simulate a token→BNB sell.
 */
const FOURMEME_HELPER_ABI = parseAbi([
  "function tryBuy(address token, uint256 amount, uint256 funds) view returns (address tokenManager, address quote, uint256 estimatedAmount, uint256 estimatedCost, uint256 estimatedFee, uint256 amountMsgValue, uint256 amountApproval, uint256 amountFunds)",
  "function trySell(address token, uint256 amount) view returns (address tokenManager, address quote, uint256 funds, uint256 fee)",
]);

/**
 * Flap.SH Portal — bonding-curve preview (view) functions.
 * address(0) represents native BNB in both directions.
 */
const FLAPSH_ABI = parseAbi([
  "function previewBuy(address token, uint256 eth) view returns (uint256 amount)",
  "function previewSell(address token, uint256 amount) view returns (uint256 eth)",
]);

/**
 * PancakeSwap V4 Quoter.
 *
 * Single-hop: quoteExactInputSingle — PoolKey + zeroForOne direction.
 *   Returns int128[] deltaAmounts; output = -deltaAmounts[1].
 *
 * Multi-hop: quoteExactInput — currencyIn + PathKey[].
 *   PathKey.intermediateCurrency is the OUTPUT token of each hop.
 *   Returns int128[] deltaAmounts; output = -deltaAmounts[last].
 */
const PANCAKE_V4_QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, address recipient, uint128 exactAmount, uint160 sqrtPriceLimitX96, bytes hookData) params) external returns (int128[] deltaAmounts, uint160 sqrtPriceX96After, uint32 initializedTicksLoaded)",
  "function quoteExactInput(address currencyIn, (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)[] path, uint128 exactAmount) external returns (int128[] deltaAmounts, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList)",
]);

/**
 * Uniswap V4 Quoter.
 *
 * Single-hop: quoteExactInputSingle — returns (amountOut, gasEstimate).
 * Multi-hop:  quoteExactInput      — currencyIn + PathKey[], same return shape.
 */
const UNISWAP_V4_QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) external returns (uint256 amountOut, uint256 gasEstimate)",
  "function quoteExactInput(address currencyIn, (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)[] path, uint128 exactAmount) external returns (uint256 amountOut, uint256 gasEstimate)",
]);

// ─── Execution ABIs ───────────────────────────────────────────────────────────
// Encode calldata placed in Step.callData for each DEX's execution path.

const V2_SWAP_ABI = parseAbi([
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external",
]);

const V3_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)",
]);

// OneMEME bonding-curve execution: buy(token, minOut, deadline) payable; sell(token, amountIn, minBNBOut, deadline)
const BC_EXEC_ABI = parseAbi([
  "function buy(address token_, uint256 minOut, uint256 deadline) external payable",
  "function sell(address token_, uint256 amountIn, uint256 minBNBOut, uint256 deadline) external",
]);

// Flap.SH swapExactInput — output always delivered to msg.sender (OneDex contract)
const FLAPSH_EXEC_ABI = parseAbi([
  "function swapExactInput((address inputToken, address outputToken, uint256 inputAmount, uint256 minOutputAmount, bytes permitData) params) external payable returns (uint256 outputAmount)",
]);

// FourMEME V1 TokenManager
const FOURMEME_V1_ABI = parseAbi([
  "function purchaseTokenAMAP(uint256 origin, address token, address to, uint256 funds, uint256 minAmount) external payable",
  "function saleToken(address token, uint256 amount) external",
]);

// FourMEME V2 TokenManager
const FOURMEME_V2_ABI = parseAbi([
  "function buyToken(bytes calldata args, uint256 time, bytes calldata signature) external payable",
  "function sellToken(uint256 origin, address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external",
]);

// FourMEME Helper V3 — handles ERC20-quoted pairs
const FOURMEME_HELPER_EXEC_ABI = parseAbi([
  "function buyWithEth(uint256 origin, address token, address to, uint256 funds, uint256 minAmount) external payable",
  "function sellForEth(uint256 origin, address token, uint256 amount, uint256 minFunds, uint256 feeRate, address feeRecipient) external",
]);

// WBNB withdraw — used to unwrap WBNB to native BNB before bonding-curve steps
const WBNB_ABI = parseAbi([
  "function withdraw(uint256 wad) external",
]);

// ─── V3 raw packed path (for quoter — not step callData) ──────────────────────

/**
 * Builds a raw packed path bytes for V3 quoter calls:
 *   abi.encodePacked(token0, fee0, token1, fee1, token2, ...)
 * This is different from the ABI-encoded path used in exactInput router calls.
 */
export function buildV3PackedPath(tokens: Hex[], fees: number[]): Hex {
  if (tokens.length < 2 || fees.length !== tokens.length - 1) {
    throw new Error("V3 path requires tokens.length === fees.length + 1");
  }
  const types: ("address" | "uint24")[] = [];
  const values: (Hex | number)[]        = [];
  for (let i = 0; i < tokens.length; i++) {
    types.push("address");  values.push(tokens[i]!);
    if (i < fees.length) {
      types.push("uint24"); values.push(fees[i]!);
    }
  }
  return encodePacked(
    types as Parameters<typeof encodePacked>[0],
    values as Parameters<typeof encodePacked>[1],
  );
}

// ─── On-chain quote functions ─────────────────────────────────────────────────

/** V2 AMM quote: returns estimated output amount for the given path. */
export async function quoteV2(
  adapter:  "PANCAKE_V2" | "UNISWAP_V2",
  path:     Hex[],
  amountIn: bigint,
): Promise<bigint> {
  const router = adapter === "PANCAKE_V2" ? pancakeV2RouterAddress() : uniswapV2RouterAddress();
  const amounts = await getDexPublicClient().readContract({
    address:      router,
    abi:          V2_ROUTER_ABI,
    functionName: "getAmountsOut",
    args:         [amountIn, path],
  }) as bigint[];
  return amounts[amounts.length - 1]!;
}

/** V2 AMM reverse quote: returns the exact amountIn required to receive amountOut. */
export async function quoteV2AmountsIn(
  adapter:   "PANCAKE_V2" | "UNISWAP_V2",
  path:      Hex[],
  amountOut: bigint,
): Promise<bigint> {
  const router = adapter === "PANCAKE_V2" ? pancakeV2RouterAddress() : uniswapV2RouterAddress();
  const amounts = await getDexPublicClient().readContract({
    address:      router,
    abi:          V2_ROUTER_ABI,
    functionName: "getAmountsIn",
    args:         [amountOut, path],
  }) as bigint[];
  return amounts[0]!;
}

/** V3 AMM quote: returns estimated output amount for the given packed path. */
export async function quoteV3(
  adapter:     "PANCAKE_V3" | "UNISWAP_V3",
  packedPath:  Hex,
  amountIn:    bigint,
): Promise<bigint> {
  const quoter = adapter === "PANCAKE_V3" ? pancakeV3QuoterAddress() : uniswapV3QuoterAddress();
  const result = await getDexPublicClient().readContract({
    address:      quoter,
    abi:          V3_QUOTER_ABI,
    functionName: "quoteExactInput",
    args:         [packedPath, amountIn],
  }) as unknown as [bigint, ...unknown[]];
  return result[0];
}

/** Bonding-curve buy quote (BNB → token). */
export async function quoteBcBuy(
  tokenAddress: Hex,
  bnbIn:        bigint,
): Promise<{ amountOut: bigint; fee: bigint }> {
  const [tokensOut, feeBNB] = await getDexPublicClient().readContract({
    address:      bondingCurveAddress(),
    abi:          BC_QUOTE_ABI,
    functionName: "getAmountOut",
    args:         [tokenAddress, bnbIn],
  }) as [bigint, bigint];
  return { amountOut: tokensOut, fee: feeBNB };
}

/** Bonding-curve sell quote (token → BNB). */
export async function quoteBcSell(
  tokenAddress: Hex,
  tokensIn:     bigint,
): Promise<{ amountOut: bigint; fee: bigint }> {
  const [bnbOut, feeBNB] = await getDexPublicClient().readContract({
    address:      bondingCurveAddress(),
    abi:          BC_QUOTE_ABI,
    functionName: "getAmountOutSell",
    args:         [tokenAddress, tokensIn],
  }) as [bigint, bigint];
  return { amountOut: bnbOut, fee: feeBNB };
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * FourMEME buy quote (BNB → meme token) via TokenManagerHelper3.tryBuy().
 * Returns amountOut, fee, and routeInfo needed to build the execution step.
 */
export async function quoteFourMemeBuy(
  tokenAddress: Hex,
  bnbIn:        bigint,
): Promise<{ amountOut: bigint; fee: bigint; routeInfo: FourMemeRouteInfo }> {
  // tryBuy(token, amount=0, funds=bnbIn) → funds-based purchase simulation
  const result = await getDexPublicClient().readContract({
    address:      fourMemeHelperAddress(),
    abi:          FOURMEME_HELPER_ABI,
    functionName: "tryBuy",
    args:         [tokenAddress, 0n, bnbIn],
  }) as [Hex, Hex, bigint, bigint, bigint, bigint, bigint, bigint];
  // [tokenManager, quote, estimatedAmount, estimatedCost, estimatedFee, ...]
  if (result[0].toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`Token ${tokenAddress} is not a FourMeme token`);
  }
  return {
    amountOut: result[2],
    fee:       result[4],
    routeInfo: { tokenManager: result[0], quoteToken: result[1] },
  };
}

/**
 * FourMEME sell quote (meme token → BNB) via TokenManagerHelper3.trySell().
 * Returns amountOut, fee, and routeInfo needed to build the execution step.
 */
export async function quoteFourMemeSell(
  tokenAddress: Hex,
  tokensIn:     bigint,
): Promise<{ amountOut: bigint; fee: bigint; routeInfo: FourMemeRouteInfo }> {
  const result = await getDexPublicClient().readContract({
    address:      fourMemeHelperAddress(),
    abi:          FOURMEME_HELPER_ABI,
    functionName: "trySell",
    args:         [tokenAddress, tokensIn],
  }) as [Hex, Hex, bigint, bigint];
  // [tokenManager, quote, funds, fee]
  if (result[0].toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`Token ${tokenAddress} is not a FourMeme token`);
  }
  return {
    amountOut: result[2],
    fee:       result[3],
    routeInfo: { tokenManager: result[0], quoteToken: result[1] },
  };
}

/** Flap.SH buy quote (BNB → meme token) via Portal.previewBuy(). */
export async function quoteFlapShBuy(
  tokenAddress: Hex,
  bnbIn:        bigint,
): Promise<bigint> {
  return getDexPublicClient().readContract({
    address:      flapShPortalAddress(),
    abi:          FLAPSH_ABI,
    functionName: "previewBuy",
    args:         [tokenAddress, bnbIn],
  }) as Promise<bigint>;
}

/** Flap.SH sell quote (meme token → BNB) via Portal.previewSell(). */
export async function quoteFlapShSell(
  tokenAddress: Hex,
  tokensIn:     bigint,
): Promise<bigint> {
  return getDexPublicClient().readContract({
    address:      flapShPortalAddress(),
    abi:          FLAPSH_ABI,
    functionName: "previewSell",
    args:         [tokenAddress, tokensIn],
  }) as Promise<bigint>;
}

/**
 * V4 AMM single-hop quote (PANCAKE_V4 or UNISWAP_V4).
 */
const UINT128_MAX = 2n ** 128n - 1n;

export async function quoteV4(
  adapter:     "PANCAKE_V4" | "UNISWAP_V4",
  tokenIn:     Hex,
  tokenOut:    Hex,
  amountIn:    bigint,
  fee:         number,
  tickSpacing: number,
  hooks:       Hex,
): Promise<bigint> {
  if (amountIn > UINT128_MAX) throw new Error("amountIn exceeds uint128 maximum for V4 quoter");
  const ts          = tickSpacing || defaultTickSpacing(fee);
  const zeroForOne  = v4ZeroForOne(tokenIn, tokenOut);
  const currency0   = zeroForOne ? tokenIn  : tokenOut;
  const currency1   = zeroForOne ? tokenOut : tokenIn;
  const ZERO_ADDR   = "0x0000000000000000000000000000000000000000" as Hex;
  const poolKey     = { currency0, currency1, fee, tickSpacing: ts, hooks };

  if (adapter === "PANCAKE_V4") {
    const result = await getDexPublicClient().readContract({
      address:      pancakeV4QuoterAddress(),
      abi:          PANCAKE_V4_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args:         [{ poolKey, zeroForOne, recipient: ZERO_ADDR, exactAmount: amountIn, sqrtPriceLimitX96: 0n, hookData: "0x" }],
    }) as unknown as [bigint[], bigint, number];
    const deltaAmounts = result[0];
    const rawOut       = deltaAmounts[1] ?? 0n;
    return rawOut < 0n ? -rawOut : rawOut;
  } else {
    const result = await getDexPublicClient().readContract({
      address:      uniswapV4QuoterAddress(),
      abi:          UNISWAP_V4_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args:         [{ poolKey, zeroForOne, exactAmount: amountIn, hookData: "0x" }],
    }) as unknown as [bigint, bigint];
    return result[0];
  }
}

/**
 * V4 multi-hop quote (PANCAKE_V4 or UNISWAP_V4) via quoteExactInput.
 */
export async function quoteV4Multi(
  adapter:      "PANCAKE_V4" | "UNISWAP_V4",
  tokens:       Hex[],
  amountIn:     bigint,
  fees:         number[],
  tickSpacings: number[],
  hooksArr:     Hex[],
): Promise<bigint> {
  if (amountIn > UINT128_MAX) throw new Error("amountIn exceeds uint128 maximum for V4 quoter");
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Hex;
  const pathKeys  = fees.map((fee, i) => ({
    intermediateCurrency: tokens[i + 1]!,
    fee,
    tickSpacing: tickSpacings[i] || defaultTickSpacing(fee),
    hooks:       hooksArr[i]     ?? ZERO_ADDR,
    hookData:    "0x" as Hex,
  }));
  const currencyIn = tokens[0]!;

  if (adapter === "PANCAKE_V4") {
    const result = await getDexPublicClient().readContract({
      address:      pancakeV4QuoterAddress(),
      abi:          PANCAKE_V4_QUOTER_ABI,
      functionName: "quoteExactInput",
      args:         [currencyIn, pathKeys, amountIn],
    }) as unknown as [bigint[], bigint[], number[]];
    const deltaAmounts = result[0];
    const rawOut = deltaAmounts[deltaAmounts.length - 1] ?? 0n;
    return rawOut < 0n ? -rawOut : rawOut;
  } else {
    const result = await getDexPublicClient().readContract({
      address:      uniswapV4QuoterAddress(),
      abi:          UNISWAP_V4_QUOTER_ABI,
      functionName: "quoteExactInput",
      args:         [currencyIn, pathKeys, amountIn],
    }) as unknown as [bigint, bigint];
    return result[0];
  }
}

// ─── OneDex types ─────────────────────────────────────────────────────────────

/** Routing metadata for FourMEME steps — returned by quote calls and carried in StepData. */
export interface FourMemeRouteInfo {
  tokenManager: Hex;
  quoteToken:   Hex; // address(0) = native-BNB-quoted pair
}

/** Mirrors the Solidity Step struct in OneDex.sol. */
export interface OneDexStep {
  target:       Hex;
  value:        bigint;
  callData:     Hex;
  approveToken: Hex;
  approveAmt:   bigint;
  tokenOut:     Hex;
  minDelta:     bigint;
}

// ─── OneDex ABI ───────────────────────────────────────────────────────────────

export const ONEDEX_ABI = parseAbi([
  "function execute(address tokenIn, uint256 amountIn, address tokenOut, uint256 minAmountOut, address recipient, uint256 deadline, bytes calldata executionData) payable returns (uint256 amountOut)",
  "event Swapped(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address recipient)",
]);

// ─── Step builders ────────────────────────────────────────────────────────────

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Hex;

/**
 * V2 token→token swap step (FOT-safe via SupportingFeeOnTransferTokens variant).
 * All output is delivered to `to` (OneDex contract address).
 */
export function buildV2Step(
  adapter:  "PANCAKE_V2" | "UNISWAP_V2",
  tokenIn:  Hex,
  tokenOut: Hex,
  amountIn: bigint,
  minOut:   bigint,
  to:       Hex,
  deadline: bigint,
): OneDexStep {
  const router = adapter === "PANCAKE_V2" ? pancakeV2RouterAddress() : uniswapV2RouterAddress();
  return {
    target:       router,
    value:        0n,
    callData:     encodeFunctionData({
      abi:          V2_SWAP_ABI,
      functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
      args:         [amountIn, minOut, [tokenIn, tokenOut], to, deadline],
    }),
    approveToken: tokenIn,
    approveAmt:   amountIn,
    tokenOut:     tokenOut,
    minDelta:     minOut,
  };
}

/**
 * V3 single-hop swap step.
 * Uses exactInputSingle with the pool's fee tier. Output delivered to `to` (OneDex contract).
 */
export function buildV3Step(
  adapter:  "PANCAKE_V3" | "UNISWAP_V3",
  tokenIn:  Hex,
  tokenOut: Hex,
  fee:      number,
  amountIn: bigint,
  minOut:   bigint,
  to:       Hex,
): OneDexStep {
  const router = adapter === "PANCAKE_V3" ? pancakeV3RouterAddress() : uniswapV3RouterAddress();
  return {
    target:       router,
    value:        0n,
    callData:     encodeFunctionData({
      abi:          V3_ROUTER_ABI,
      functionName: "exactInputSingle",
      args:         [{ tokenIn, tokenOut, fee, recipient: to, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
    }),
    approveToken: tokenIn,
    approveAmt:   amountIn,
    tokenOut:     tokenOut,
    minDelta:     minOut,
  };
}

/**
 * OneMEME bonding-curve buy step (native BNB → token).
 * amountIn must be sent as msg.value — OneDex must be holding native BNB for this step.
 */
export function buildBcBuyStep(
  token:    Hex,
  amountIn: bigint,
  minOut:   bigint,
  deadline: bigint,
): OneDexStep {
  return {
    target:       bondingCurveAddress(),
    value:        amountIn,
    callData:     encodeFunctionData({
      abi:          BC_EXEC_ABI,
      functionName: "buy",
      args:         [token, minOut, deadline],
    }),
    approveToken: ZERO_ADDR,
    approveAmt:   0n,
    tokenOut:     token,
    minDelta:     minOut,
  };
}

/**
 * OneMEME bonding-curve sell step (token → native BNB).
 * tokenOut = address(0); BNB lands in OneDex contract.
 */
export function buildBcSellStep(
  token:    Hex,
  amountIn: bigint,
  minOut:   bigint,
  deadline: bigint,
): OneDexStep {
  return {
    target:       bondingCurveAddress(),
    value:        0n,
    callData:     encodeFunctionData({
      abi:          BC_EXEC_ABI,
      functionName: "sell",
      args:         [token, amountIn, minOut, deadline],
    }),
    approveToken: token,
    approveAmt:   amountIn,
    tokenOut:     ZERO_ADDR,
    minDelta:     minOut,
  };
}

/**
 * Flap.SH swap step.
 * tokenIn/tokenOut: pass WBNB address for the WBNB side; address(0) for native BNB.
 * When tokenIn == address(0), amountIn is forwarded as msg.value (native BNB).
 * FlapSH always delivers output to msg.sender (OneDex contract).
 */
export function buildFlapShStep(
  tokenIn:  Hex,
  tokenOut: Hex,
  amountIn: bigint,
  minOut:   bigint,
): OneDexStep {
  const nativeIn = tokenIn.toLowerCase() === ZERO_ADDR.toLowerCase();
  return {
    target:       flapShPortalAddress(),
    value:        nativeIn ? amountIn : 0n,
    callData:     encodeFunctionData({
      abi:          FLAPSH_EXEC_ABI,
      functionName: "swapExactInput",
      args:         [{ inputToken: tokenIn, outputToken: tokenOut, inputAmount: amountIn, minOutputAmount: minOut, permitData: "0x" }],
    }),
    approveToken: nativeIn ? ZERO_ADDR : tokenIn,
    approveAmt:   nativeIn ? 0n : amountIn,
    tokenOut:     tokenOut,
    minDelta:     minOut,
  };
}

/**
 * FourMEME buy step (native BNB → meme token).
 * Routing path (ERC20-quote helper, V1 or V2 native-BNB manager) is determined from routeInfo.
 * amountIn is forwarded as msg.value.
 */
export function buildFourMemeBuyStep(
  token:     Hex,
  amountIn:  bigint,
  minOut:    bigint,
  to:        Hex,
  routeInfo: FourMemeRouteInfo,
): OneDexStep {
  const { tokenManager, quoteToken } = routeInfo;
  let target:   Hex;
  let callData: Hex;

  if (quoteToken.toLowerCase() !== ZERO_ADDR.toLowerCase()) {
    // ERC20-quote pair: helper wraps BNB → quote token → meme token
    target   = fourMemeHelperAddress();
    callData = encodeFunctionData({
      abi:          FOURMEME_HELPER_EXEC_ABI,
      functionName: "buyWithEth",
      args:         [0n, token, to, amountIn, minOut],
    });
  } else if (tokenManager.toLowerCase() === FOURMEME_V1_MANAGER) {
    // V1 native-BNB TokenManager
    target   = tokenManager;
    callData = encodeFunctionData({
      abi:          FOURMEME_V1_ABI,
      functionName: "purchaseTokenAMAP",
      args:         [0n, token, to, amountIn, minOut],
    });
  } else {
    // V2 native-BNB TokenManager: buyToken(bytes args, uint256 time, bytes sig)
    const args = encodeAbiParameters(
      [
        { type: "uint256" }, // origin
        { type: "address" }, // token
        { type: "address" }, // to
        { type: "uint256" }, // amount (0 = AMAP mode)
        { type: "uint256" }, // maxFunds (0 = no cap)
        { type: "uint256" }, // funds
        { type: "uint256" }, // minAmount
      ],
      [0n, token, to, 0n, 0n, amountIn, minOut],
    );
    target   = tokenManager;
    callData = encodeFunctionData({
      abi:          FOURMEME_V2_ABI,
      functionName: "buyToken",
      args:         [args, 0n, "0x"],
    });
  }

  return {
    target,
    value:        amountIn,
    callData,
    approveToken: ZERO_ADDR,
    approveAmt:   0n,
    tokenOut:     token,
    minDelta:     minOut,
  };
}

/**
 * FourMEME sell step (meme token → native BNB).
 * tokenOut = address(0); BNB lands in OneDex contract.
 */
export function buildFourMemeSellStep(
  token:     Hex,
  amountIn:  bigint,
  minOut:    bigint,
  routeInfo: FourMemeRouteInfo,
): OneDexStep {
  const { tokenManager, quoteToken } = routeInfo;
  let target:   Hex;
  let callData: Hex;

  if (quoteToken.toLowerCase() !== ZERO_ADDR.toLowerCase()) {
    // ERC20-quote pair: helper pulls token from OneDex, delivers BNB to OneDex (msg.sender)
    target   = fourMemeHelperAddress();
    callData = encodeFunctionData({
      abi:          FOURMEME_HELPER_EXEC_ABI,
      functionName: "sellForEth",
      args:         [0n, token, amountIn, minOut, 0n, ZERO_ADDR],
    });
  } else if (tokenManager.toLowerCase() === FOURMEME_V1_MANAGER) {
    // V1: saleToken has no per-transaction minFunds guard
    target   = tokenManager;
    callData = encodeFunctionData({
      abi:          FOURMEME_V1_ABI,
      functionName: "saleToken",
      args:         [token, amountIn],
    });
  } else {
    // V2 native-BNB TokenManager
    target   = tokenManager;
    callData = encodeFunctionData({
      abi:          FOURMEME_V2_ABI,
      functionName: "sellToken",
      args:         [0n, token, amountIn, minOut, 0n, ZERO_ADDR],
    });
  }

  return {
    target,
    value:        0n,
    callData,
    approveToken: token,
    approveAmt:   amountIn,
    tokenOut:     ZERO_ADDR,
    minDelta:     minOut,
  };
}

/**
 * WBNB unwrap step — converts WBNB held by OneDex to native BNB.
 * Inserted before bonding-curve buy steps in bridge routes where step 1 outputs WBNB.
 * minDelta = 0: the subsequent BC step enforces output quality.
 */
export function buildWbnbUnwrapStep(wbnbAddress: Hex, amount: bigint): OneDexStep {
  return {
    target:       wbnbAddress,
    value:        0n,
    callData:     encodeFunctionData({
      abi:          WBNB_ABI,
      functionName: "withdraw",
      args:         [amount],
    }),
    approveToken: ZERO_ADDR,
    approveAmt:   0n,
    tokenOut:     ZERO_ADDR,
    minDelta:     0n,
  };
}

// ─── Execution data + calldata ────────────────────────────────────────────────

/**
 * ABI-encodes the OneDex execution data: abi.encode(bool feeOnInput, Step[] steps).
 * This bytes value is passed as executionData in OneDex.execute().
 */
export function encodeExecutionData(feeOnInput: boolean, steps: OneDexStep[]): Hex {
  return encodeAbiParameters(
    [
      { type: "bool" },
      {
        type: "tuple[]",
        components: [
          { name: "target",       type: "address" },
          { name: "value",        type: "uint256" },
          { name: "callData",     type: "bytes"   },
          { name: "approveToken", type: "address" },
          { name: "approveAmt",   type: "uint256" },
          { name: "tokenOut",     type: "address" },
          { name: "minDelta",     type: "uint256" },
        ],
      },
    ],
    [feeOnInput, steps],
  );
}

/**
 * Builds the full calldata for OneDex.execute().
 */
export function buildOneDexCalldata(
  tokenIn:      Hex,
  amountIn:     bigint,
  tokenOut:     Hex,
  minAmountOut: bigint,
  recipient:    Hex,
  deadline:     bigint,
  feeOnInput:   boolean,
  steps:        OneDexStep[],
): Hex {
  return encodeFunctionData({
    abi:          ONEDEX_ABI,
    functionName: "execute",
    args:         [tokenIn, amountIn, tokenOut, minAmountOut, recipient, deadline,
                   encodeExecutionData(feeOnInput, steps)],
  });
}
