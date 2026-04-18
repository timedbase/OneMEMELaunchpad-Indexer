/**
 * On-chain client for OneMEMEAggregator and OneMEMEMetaTx contracts.
 *
 * Intentionally separate from src/api/rpc.ts — owns its own viem client
 * instances and reads only AGGREGATOR_ADDRESS / METATX_ADDRESS / RELAYER_PRIVATE_KEY.
 * Never imports from or modifies the existing rpc.ts.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  toHex,
  encodePacked,
  encodeAbiParameters,
  parseAbiParameters,
  encodeFunctionData,
  defineChain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

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

/** Lazily-initialised read-only client for aggregator/metatx view calls. */
export function getDexPublicClient() {
  if (!_dexPublicClient) {
    _dexPublicClient = createPublicClient({
      chain:     dexChain(),
      transport: http(process.env.BSC_RPC_URL, { timeout: 10_000, retryCount: 2, retryDelay: 500 }),
    });
  }
  return _dexPublicClient;
}

/** Creates a wallet client for the relayer account (required only for relay execution). */
function getDexWalletClient() {
  if (!process.env.RELAYER_PRIVATE_KEY) {
    throw new Error("RELAYER_PRIVATE_KEY is not configured. Meta-tx relay requires a funded relayer account.");
  }
  const account = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as Hex);
  return createWalletClient({
    account,
    chain:     dexChain(),
    transport: http(process.env.BSC_RPC_URL, { timeout: 30_000, retryCount: 2, retryDelay: 500 }),
  });
}

// ─── Contract addresses ───────────────────────────────────────────────────────

export function aggregatorAddress(): Hex {
  if (!process.env.AGGREGATOR_ADDRESS) {
    throw new Error("AGGREGATOR_ADDRESS is not configured.");
  }
  return process.env.AGGREGATOR_ADDRESS as Hex;
}

export function metaTxAddress(): Hex {
  if (!process.env.METATX_ADDRESS) {
    throw new Error("METATX_ADDRESS is not configured.");
  }
  return process.env.METATX_ADDRESS as Hex;
}

// ─── Adapter IDs ──────────────────────────────────────────────────────────────

/**
 * keccak256 hashes of adapter name strings, matching what OneMEMEAggregator
 * uses as bytes32 identifiers. Keep in sync with the deployed contract.
 */
export const ADAPTER_IDS = {
  ONEMEME_BC: keccak256(toHex("ONEMEME_BC")),
  FOURMEME:   keccak256(toHex("FOURMEME")),
  FLAPSH:     keccak256(toHex("FLAPSH")),
  PANCAKE_V2: keccak256(toHex("PANCAKE_V2")),
  PANCAKE_V3: keccak256(toHex("PANCAKE_V3")),
  PANCAKE_V4: keccak256(toHex("PANCAKE_V4")),
  UNISWAP_V2: keccak256(toHex("UNISWAP_V2")),
  UNISWAP_V3: keccak256(toHex("UNISWAP_V3")),
  UNISWAP_V4: keccak256(toHex("UNISWAP_V4")),
} as const;

export type AdapterName = keyof typeof ADAPTER_IDS;

/** All adapter names in display order. */
export const ADAPTER_NAMES = Object.keys(ADAPTER_IDS) as AdapterName[];

// ─── adapterData encoding ─────────────────────────────────────────────────────

/**
 * V2-style adapters (PANCAKE_V2, UNISWAP_V2).
 * adapterData = abi.encode(address[] path)
 * path: [tokenIn, ...intermediates, tokenOut]
 */
export function encodeV2Path(path: Hex[]): Hex {
  return encodeAbiParameters(parseAbiParameters("address[]"), [path]);
}

/**
 * V3-style adapters (PANCAKE_V3, UNISWAP_V3).
 * adapterData = abi.encode(bytes encodedPath)
 * encodedPath = abi.encodePacked(token0, fee0, token1, fee1, token2, ...)
 * fees: fee tiers between hops in bps × 100, e.g. 500 = 0.05%
 */
export function encodeV3Path(tokens: Hex[], fees: number[]): Hex {
  if (tokens.length < 2 || fees.length !== tokens.length - 1) {
    throw new Error("V3 path requires tokens.length === fees.length + 1");
  }
  const types: ("address" | "uint24")[]  = [];
  const values: (Hex | number)[]         = [];
  for (let i = 0; i < tokens.length; i++) {
    types.push("address");  values.push(tokens[i]!);
    if (i < fees.length) {
      types.push("uint24"); values.push(fees[i]!);
    }
  }
  const packedPath = encodePacked(types as Parameters<typeof encodePacked>[0], values as Parameters<typeof encodePacked>[1]);
  return encodeAbiParameters(parseAbiParameters("bytes"), [packedPath]);
}

/**
 * Bonding-curve adapters (ONEMEME_BC, FOURMEME, FLAPSH).
 * The adapter resolves the curve from tokenIn/tokenOut directly; no extra data needed.
 */
export function encodeBcAdapterData(): Hex {
  return "0x";
}

// ─── Quote contract addresses ─────────────────────────────────────────────────
// Configurable via env vars; defaults are BSC mainnet well-known addresses.

function pancakeV2RouterAddress(): Hex {
  return (process.env.PANCAKE_V2_ROUTER_ADDRESS
    ?? "0x10ED43C718714eb63d5aA57B78B54704E256024E") as Hex;
}

function uniswapV2RouterAddress(): Hex {
  return (process.env.UNISWAP_V2_ROUTER_ADDRESS
    ?? "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24") as Hex;
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

function bondingCurveQuoteAddress(): Hex {
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

// ─── V3 raw packed path (for quoter — not ABI-wrapped) ────────────────────────

/**
 * Builds a raw packed path bytes for V3 quoter calls:
 *   abi.encodePacked(token0, fee0, token1, fee1, token2, ...)
 * This is different from encodeV3Path() which ABI-wraps for adapterData.
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
  const router = adapter === "PANCAKE_V2"
    ? pancakeV2RouterAddress()
    : uniswapV2RouterAddress();

  const amounts = await getDexPublicClient().readContract({
    address:      router,
    abi:          V2_ROUTER_ABI,
    functionName: "getAmountsOut",
    args:         [amountIn, path],
  }) as bigint[];

  return amounts[amounts.length - 1]!;
}

/** V3 AMM quote: returns estimated output amount for the given packed path. */
export async function quoteV3(
  adapter:     "PANCAKE_V3" | "UNISWAP_V3",
  packedPath:  Hex,
  amountIn:    bigint,
): Promise<bigint> {
  const quoter = adapter === "PANCAKE_V3"
    ? pancakeV3QuoterAddress()
    : uniswapV3QuoterAddress();

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
    address:      bondingCurveQuoteAddress(),
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
    address:      bondingCurveQuoteAddress(),
    abi:          BC_QUOTE_ABI,
    functionName: "getAmountOutSell",
    args:         [tokenAddress, tokensIn],
  }) as [bigint, bigint];
  return { amountOut: bnbOut, fee: feeBNB };
}

/** FourMEME buy quote (BNB → meme token) via TokenManagerHelper3.tryBuy(). */
export async function quoteFourMemeBuy(
  tokenAddress: Hex,
  bnbIn:        bigint,
): Promise<{ amountOut: bigint; fee: bigint }> {
  // tryBuy(token, amount=0, funds=bnbIn) → funds-based purchase simulation
  const result = await getDexPublicClient().readContract({
    address:      fourMemeHelperAddress(),
    abi:          FOURMEME_HELPER_ABI,
    functionName: "tryBuy",
    args:         [tokenAddress, 0n, bnbIn],
  }) as [Hex, Hex, bigint, bigint, bigint, bigint, bigint, bigint];
  // [tokenManager, quote, estimatedAmount, estimatedCost, estimatedFee, ...]
  return { amountOut: result[2], fee: result[4] };
}

/** FourMEME sell quote (meme token → BNB) via TokenManagerHelper3.trySell(). */
export async function quoteFourMemeSell(
  tokenAddress: Hex,
  tokensIn:     bigint,
): Promise<{ amountOut: bigint; fee: bigint }> {
  const result = await getDexPublicClient().readContract({
    address:      fourMemeHelperAddress(),
    abi:          FOURMEME_HELPER_ABI,
    functionName: "trySell",
    args:         [tokenAddress, tokensIn],
  }) as [Hex, Hex, bigint, bigint];
  // [tokenManager, quote, funds, fee]
  return { amountOut: result[2], fee: result[3] };
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
 *
 * V4 requires a PoolKey rather than a simple path — supply fee, tickSpacing,
 * and optionally a hooks address (defaults to zero address for vanilla pools).
 * Only single-hop is supported; multi-hop V4 requires chaining PoolKeys.
 *
 * @param adapter     "PANCAKE_V4" or "UNISWAP_V4"
 * @param tokenIn     Input token address
 * @param tokenOut    Output token address
 * @param amountIn    Input amount in wei
 * @param fee         Fee tier (e.g. 500 = 0.05%, 3000 = 0.30%)
 * @param tickSpacing Pool tick spacing — auto-derived from fee if 0
 * @param hooks       Hooks contract address (zero address for vanilla pools)
 */
export async function quoteV4(
  adapter:     "PANCAKE_V4" | "UNISWAP_V4",
  tokenIn:     Hex,
  tokenOut:    Hex,
  amountIn:    bigint,
  fee:         number,
  tickSpacing: number,
  hooks:       Hex,
): Promise<bigint> {
  const ts          = tickSpacing || defaultTickSpacing(fee);
  const zeroForOne  = v4ZeroForOne(tokenIn, tokenOut);
  const currency0   = zeroForOne ? tokenIn  : tokenOut;
  const currency1   = zeroForOne ? tokenOut : tokenIn;
  const ZERO_ADDR   = "0x0000000000000000000000000000000000000000" as Hex;

  const poolKey = { currency0, currency1, fee, tickSpacing: ts, hooks };

  if (adapter === "PANCAKE_V4") {
    const result = await getDexPublicClient().readContract({
      address:      pancakeV4QuoterAddress(),
      abi:          PANCAKE_V4_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args:         [{ poolKey, zeroForOne, recipient: ZERO_ADDR, exactAmount: amountIn, sqrtPriceLimitX96: 0n, hookData: "0x" }],
    }) as unknown as [bigint[], bigint, number];

    // deltaAmounts[1] is negative (tokens leaving pool → user); negate to get positive amount
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
 *
 * Each hop is described by a PathKey. The caller provides parallel arrays:
 *   tokens       — [tokenIn, intermediate1, ..., tokenOut]  (N+1 entries for N hops)
 *   fees         — fee tier per hop                         (N entries)
 *   tickSpacings — tick spacing per hop; 0 = auto-derive    (N entries)
 *   hooksArr     — hooks address per hop                    (N entries, zero = no hooks)
 */
export async function quoteV4Multi(
  adapter:      "PANCAKE_V4" | "UNISWAP_V4",
  tokens:       Hex[],
  amountIn:     bigint,
  fees:         number[],
  tickSpacings: number[],
  hooksArr:     Hex[],
): Promise<bigint> {
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Hex;

  // PathKey[i] describes hop i: the pool between tokens[i] and tokens[i+1].
  // intermediateCurrency = the output side of this hop = tokens[i+1].
  const pathKeys = fees.map((fee, i) => ({
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
    // Last element is the final currency's delta (negative = leaving pool to user)
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

// ─── ABIs ─────────────────────────────────────────────────────────────────────

export const AGGREGATOR_ABI = parseAbi([
  "function swap(bytes32 adapterId, address tokenIn, uint256 amountIn, address tokenOut, uint256 minOut, address to, uint256 deadline, bytes calldata adapterData) payable returns (uint256 amountOut)",
  "event Swapped(address indexed user, bytes32 indexed adapterId, address tokenIn, address tokenOut, uint256 grossAmountIn, uint256 feeCharged, uint256 amountOut)",
]);

export const METATX_ABI = parseAbi([
  // executeMetaTx(MetaTxOrder order, bytes sig, PermitData permit)
  "function executeMetaTx((address user, uint256 nonce, uint256 deadline, bytes32 adapterId, address tokenIn, uint256 grossAmountIn, address tokenOut, uint256 minUserOut, address recipient, uint256 swapDeadline, bytes adapterData, uint256 relayerFee) order, bytes sig, (uint8 permitType, bytes data) permit) returns (uint256 amountOut)",
  // orderDigest(MetaTxOrder order) view returns (bytes32)
  "function orderDigest((address user, uint256 nonce, uint256 deadline, bytes32 adapterId, address tokenIn, uint256 grossAmountIn, address tokenOut, uint256 minUserOut, address recipient, uint256 swapDeadline, bytes adapterData, uint256 relayerFee) order) view returns (bytes32)",
  // nonces(address user) view returns (uint256)
  "function nonces(address user) view returns (uint256)",
]);

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface MetaTxOrder {
  user:          Hex;
  nonce:         bigint;
  deadline:      bigint;
  adapterId:     Hex;
  tokenIn:       Hex;
  grossAmountIn: bigint;
  tokenOut:      Hex;
  minUserOut:    bigint;
  recipient:     Hex;
  swapDeadline:  bigint;
  adapterData:   Hex;
  relayerFee:    bigint;
}

export interface PermitData {
  permitType: 0 | 1 | 2;  // 0 = PERMIT_NONE, 1 = EIP-2612, 2 = Permit2
  data:       Hex;
}

// ─── Contract reads ───────────────────────────────────────────────────────────

export async function getUserNonce(user: Hex): Promise<bigint> {
  return getDexPublicClient().readContract({
    address:      metaTxAddress(),
    abi:          METATX_ABI,
    functionName: "nonces",
    args:         [user],
  }) as Promise<bigint>;
}

export async function getOrderDigest(order: MetaTxOrder): Promise<Hex> {
  return getDexPublicClient().readContract({
    address:      metaTxAddress(),
    abi:          METATX_ABI,
    functionName: "orderDigest",
    args:         [order],
  }) as Promise<Hex>;
}

// ─── Relay execution ──────────────────────────────────────────────────────────

export async function relayMetaTx(
  order:  MetaTxOrder,
  sig:    Hex,
  permit: PermitData,
): Promise<Hex> {
  const wallet = getDexWalletClient();
  return wallet.writeContract({
    address:      metaTxAddress(),
    abi:          METATX_ABI,
    functionName: "executeMetaTx",
    args:         [order, sig, permit],
  });
}

// ─── Calldata builders ────────────────────────────────────────────────────────

/**
 * Builds calldata for OneMEMEAggregator.swap().
 * The caller broadcasts this transaction themselves (non-gasless path).
 */
export function buildSwapCalldata(
  adapterId:   Hex,
  tokenIn:     Hex,
  amountIn:    bigint,
  tokenOut:    Hex,
  minOut:      bigint,
  to:          Hex,
  deadline:    bigint,
  adapterData: Hex,
): Hex {
  return encodeFunctionData({
    abi:          AGGREGATOR_ABI,
    functionName: "swap",
    args:         [adapterId, tokenIn, amountIn, tokenOut, minOut, to, deadline, adapterData],
  });
}

/**
 * Builds calldata for OneMEMEMetaTx.executeMetaTx().
 * The relayer broadcasts this on behalf of the user (gasless path).
 */
export function buildMetaTxCalldata(
  order:  MetaTxOrder,
  sig:    Hex,
  permit: PermitData,
): Hex {
  return encodeFunctionData({
    abi:          METATX_ABI,
    functionName: "executeMetaTx",
    args:         [order, sig, permit],
  });
}
