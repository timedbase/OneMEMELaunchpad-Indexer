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
  recoverAddress,
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

let _dexWalletClient: ReturnType<typeof createWalletClient> | null = null;
let _dexAccount:      ReturnType<typeof privateKeyToAccount>  | null = null;

/** Lazily-initialised wallet client for relay execution. Cached for the lifetime of the process. */
function getDexWalletClient(): { wallet: ReturnType<typeof createWalletClient>; account: ReturnType<typeof privateKeyToAccount> } {
  if (!process.env.RELAYER_PRIVATE_KEY) {
    throw new Error("RELAYER_PRIVATE_KEY is not configured. Meta-tx relay requires a funded relayer account.");
  }
  if (!_dexWalletClient || !_dexAccount) {
    _dexAccount      = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as Hex);
    _dexWalletClient = createWalletClient({
      account:   _dexAccount,
      chain:     dexChain(),
      transport: http(process.env.BSC_RPC_URL, { timeout: 30_000, retryCount: 2, retryDelay: 500 }),
    });
  }
  return { wallet: _dexWalletClient, account: _dexAccount };
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

// Permit2 universal contract — same address on every EVM chain.
const DEFAULT_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export function permit2Address(): Hex {
  return (process.env.PERMIT2_ADDRESS ?? DEFAULT_PERMIT2) as Hex;
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
//
// Each encoder matches exactly what the on-chain adapter contract abi.decode()s.
// Source: OneMEMELaunchpad-Core/AggregatorRouter/adapters/

/**
 * GenericV2Adapter (PANCAKE_V2, UNISWAP_V2).
 * adapterData = abi.encode(address[] path, uint256 deadline)
 */
export function encodeV2AdapterData(path: Hex[], deadline: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "address[]" }, { type: "uint256" }],
    [path, deadline],
  );
}

/**
 * GenericV3Adapter single-hop (PANCAKE_V3, UNISWAP_V3, one fee tier).
 * adapterData = abi.encode(bool false, abi.encode(uint24 fee, uint160 sqrtPriceLimitX96))
 * sqrtPriceLimit = 0 for no price cap.
 */
export function encodeV3SingleHopAdapterData(fee: number, sqrtPriceLimitX96 = 0n): Hex {
  const inner = encodeAbiParameters(
    [{ type: "uint24" }, { type: "uint160" }],
    [fee, sqrtPriceLimitX96],
  );
  return encodeAbiParameters(
    [{ type: "bool" }, { type: "bytes" }],
    [false, inner],
  );
}

/**
 * GenericV3Adapter multi-hop (PANCAKE_V3, UNISWAP_V3, two or more fee tiers).
 * adapterData = abi.encode(bool true, abi.encodePacked(token0, fee0, token1, fee1, ...))
 */
export function encodeV3MultiHopAdapterData(tokens: Hex[], fees: number[]): Hex {
  if (tokens.length < 3 || fees.length !== tokens.length - 1) {
    throw new Error("V3 multi-hop requires at least 3 tokens and matching fee count");
  }
  const types: ("address" | "uint24")[] = [];
  const values: (Hex | number)[]        = [];
  for (let i = 0; i < tokens.length; i++) {
    types.push("address");  values.push(tokens[i]!);
    if (i < fees.length) {
      types.push("uint24"); values.push(fees[i]!);
    }
  }
  const packed = encodePacked(
    types as Parameters<typeof encodePacked>[0],
    values as Parameters<typeof encodePacked>[1],
  );
  return encodeAbiParameters(
    [{ type: "bool" }, { type: "bytes" }],
    [true, packed],
  );
}

/**
 * GenericV4Adapter single-hop (PANCAKE_V4, UNISWAP_V4).
 * adapterData = abi.encode(bool false, PoolKey poolKey, bool zeroForOne, bytes hookData, uint256 deadline)
 * zeroForOne auto-derived from token address comparison (currency0 < currency1).
 */
export function encodeV4SingleHopAdapterData(
  tokenIn:     Hex,
  tokenOut:    Hex,
  fee:         number,
  tickSpacing: number,
  hooks:       Hex,
  hookData:    Hex,
  deadline:    bigint,
): Hex {
  const zeroForOne = tokenIn.toLowerCase() < tokenOut.toLowerCase();
  const currency0  = zeroForOne ? tokenIn  : tokenOut;
  const currency1  = zeroForOne ? tokenOut : tokenIn;
  return encodeAbiParameters(
    [
      { type: "bool" },
      { type: "tuple", components: [
        { name: "currency0",   type: "address" },
        { name: "currency1",   type: "address" },
        { name: "fee",         type: "uint24"  },
        { name: "tickSpacing", type: "int24"   },
        { name: "hooks",       type: "address" },
      ]},
      { type: "bool"    },
      { type: "bytes"   },
      { type: "uint256" },
    ],
    [false, { currency0, currency1, fee, tickSpacing, hooks }, zeroForOne, hookData, deadline],
  );
}

/**
 * GenericV4Adapter multi-hop (PANCAKE_V4, UNISWAP_V4).
 * adapterData = abi.encode(bool true, PathKey[] pathKeys, uint256 deadline)
 * pathKeys[i].intermediateCurrency = tokens[i+1] (output side of each hop).
 */
export function encodeV4MultiHopAdapterData(
  tokens:       Hex[],
  fees:         number[],
  tickSpacings: number[],
  hooksArr:     Hex[],
  deadline:     bigint,
): Hex {
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Hex;
  const pathKeys = fees.map((fee, i) => ({
    intermediateCurrency: tokens[i + 1]!,
    fee,
    tickSpacing: tickSpacings[i] || defaultTickSpacing(fee),
    hooks:       hooksArr[i]     ?? ZERO_ADDR,
    hookData:    "0x" as Hex,
  }));
  return encodeAbiParameters(
    [
      { type: "bool" },
      { type: "tuple[]", components: [
        { name: "intermediateCurrency", type: "address" },
        { name: "fee",                  type: "uint24"  },
        { name: "tickSpacing",          type: "int24"   },
        { name: "hooks",                type: "address" },
        { name: "hookData",             type: "bytes"   },
      ]},
      { type: "uint256" },
    ],
    [true, pathKeys, deadline],
  );
}

/**
 * OneMEMEAdapter (ONEMEME_BC).
 * adapterData = abi.encode(address token, uint256 deadline)
 * token = the meme token address (not WBNB).
 */
export function encodeOneMemeAdapterData(token: Hex, deadline: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [token, deadline],
  );
}

/**
 * FourMEMEAdapter (FOURMEME).
 * adapterData = abi.encode(address token)
 */
export function encodeFourMemeAdapterData(token: Hex): Hex {
  return encodeAbiParameters(
    [{ type: "address" }],
    [token],
  );
}

/**
 * FlapSHAdapter (FLAPSH).
 * adapterData is not used — the adapter derives everything from tokenIn/tokenOut.
 */
export function encodeFlapShAdapterData(): Hex {
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

/** V2 AMM reverse quote: returns the exact amountIn required to receive amountOut. */
export async function quoteV2AmountsIn(
  adapter:   "PANCAKE_V2" | "UNISWAP_V2",
  path:      Hex[],
  amountOut: bigint,
): Promise<bigint> {
  const router = adapter === "PANCAKE_V2"
    ? pancakeV2RouterAddress()
    : uniswapV2RouterAddress();

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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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
  // tokenManager === zero address means the token is not managed by FourMeme
  if (result[0].toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`Token ${tokenAddress} is not a FourMeme token`);
  }
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
  if (result[0].toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`Token ${tokenAddress} is not a FourMeme token`);
  }
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
  if (amountIn > UINT128_MAX) throw new Error("amountIn exceeds uint128 maximum for V4 quoter");
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

// ─── Batch types ─────────────────────────────────────────────────────────────

export interface SwapStep {
  adapterId:   Hex;
  tokenIn:     Hex;
  tokenOut:    Hex;
  minOut:      bigint;
  adapterData: Hex;
}

export interface BatchMetaTxOrder {
  user:                  Hex;
  nonce:                 bigint;
  deadline:              bigint;
  steps:                 SwapStep[];
  grossAmountIn:         bigint;
  minFinalOut:           bigint;
  recipient:             Hex;
  swapDeadline:          bigint;
  relayerFee:            bigint;
  relayerFeeTokenAmount: bigint;
  relayerFeeAdapterId:   Hex;
  relayerFeeAdapterData: Hex;
}

// ─── ABIs ─────────────────────────────────────────────────────────────────────

export const AGGREGATOR_ABI = parseAbi([
  "function swap(bytes32 adapterId, address tokenIn, uint256 amountIn, address tokenOut, uint256 minOut, address to, uint256 deadline, bytes calldata adapterData) payable returns (uint256 amountOut)",
  "event Swapped(address indexed user, bytes32 indexed adapterId, address tokenIn, address tokenOut, uint256 grossAmountIn, uint256 feeCharged, uint256 amountOut)",
]);

// Shorthand for the MetaTxOrder tuple — used in both executeMetaTx and orderDigest.
const META_ORDER_TUPLE =
  "(address user, uint256 nonce, uint256 deadline, bytes32 adapterId, address tokenIn, uint256 grossAmountIn, address tokenOut, uint256 minUserOut, address recipient, uint256 swapDeadline, bytes adapterData, uint256 relayerFee, uint256 relayerFeeTokenAmount, bytes32 relayerFeeAdapterId, bytes relayerFeeAdapterData)";

export const METATX_ABI = parseAbi([
  `function executeMetaTx(${META_ORDER_TUPLE} order, bytes sig, (uint8 permitType, bytes data) permit)`,
  `function orderDigest(${META_ORDER_TUPLE} order) view returns (bytes32)`,
  "function nonces(address user) view returns (uint256)",
]);

export const BATCH_AGGREGATOR_ABI = parseAbi([
  "function batchSwap((bytes32 adapterId, address tokenIn, address tokenOut, uint256 minOut, bytes adapterData)[] steps, uint256 amountIn, uint256 minFinalOut, address to, uint256 deadline) payable returns (uint256 finalAmountOut)",
  "event BatchSwapped(address indexed user, address tokenIn, address tokenOut, uint256 grossAmountIn, uint256 feeCharged, uint256 amountOut, uint256 stepCount)",
]);

const BATCH_META_ORDER_TUPLE =
  "(address user, uint256 nonce, uint256 deadline, (bytes32 adapterId, address tokenIn, address tokenOut, uint256 minOut, bytes adapterData)[] steps, uint256 grossAmountIn, uint256 minFinalOut, address recipient, uint256 swapDeadline, uint256 relayerFee, uint256 relayerFeeTokenAmount, bytes32 relayerFeeAdapterId, bytes relayerFeeAdapterData)";

export const BATCH_METATX_ABI = parseAbi([
  `function batchExecuteMetaTx(${BATCH_META_ORDER_TUPLE} order, bytes sig, (uint8 permitType, bytes data) permit) returns (uint256 amountOut)`,
  `function batchOrderDigest(${BATCH_META_ORDER_TUPLE} order) view returns (bytes32)`,
  "event BatchMetaTxExecuted(address indexed user, address indexed relayer, address tokenIn, address tokenOut, uint256 grossAmountIn, uint256 amountOut, uint256 relayerFee, uint256 nonce, uint256 stepCount)",
]);

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface MetaTxOrder {
  user:                   Hex;
  nonce:                  bigint;
  deadline:               bigint;
  adapterId:              Hex;
  tokenIn:                Hex;
  grossAmountIn:          bigint;
  tokenOut:               Hex;
  minUserOut:             bigint;
  recipient:              Hex;
  swapDeadline:           bigint;
  adapterData:            Hex;
  relayerFee:             bigint;
  // ERC-20 output fee: deduct relayerFeeTokenAmount of tokenOut, swap→BNB, send to relayer.
  // All three must be set together; leave at zero/empty for BNB-output swaps.
  relayerFeeTokenAmount:  bigint;
  relayerFeeAdapterId:    Hex;
  relayerFeeAdapterData:  Hex;
}

export interface PermitData {
  permitType: 0 | 1 | 2;  // 0 = PERMIT_NONE, 1 = EIP-2612, 2 = Permit2
  data:       Hex;
}

// ─── Relayer fee estimation ───────────────────────────────────────────────────

// Conservative gas budgets for MetaTx relay transactions.
// Single-step: MetaTx overhead (~100k) + single aggregator swap (~150k).
// Batch: MetaTx overhead (~130k) + batchSwap base (~70k) + per-step (~120k).
const GAS_META_SINGLE    = 250_000n;
const GAS_META_BATCH_BASE = 200_000n;
const GAS_META_PER_STEP   = 120_000n;

// Premium paid to the relayer above gas break-even, in basis points.
const RELAYER_PREMIUM_BPS = 3_000n; // 30%

const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c" as Hex;
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

export async function estimateRelayerFee(
  stepCount:  number,
  tokenOut?:  Hex,   // ERC-20 output token; omit or pass address(0) for BNB-output swaps
  deadline?:  bigint,
): Promise<{
  gasPrice:              bigint;
  gasEstimate:           bigint;
  relayerFee:            bigint;
  relayerFeeTokenAmount: bigint;
  relayerFeeAdapterId:   Hex;
  relayerFeeAdapterData: Hex;
}> {
  // Extra gas for the secondary fee-conversion swap when output is ERC-20.
  const feeSwapGas = (tokenOut && tokenOut !== WBNB && tokenOut !== "0x0000000000000000000000000000000000000000")
    ? 120_000n : 0n;

  const gasPrice    = await getDexPublicClient().getGasPrice();
  const gasEstimate = (stepCount <= 1 ? GAS_META_SINGLE : GAS_META_BATCH_BASE + BigInt(stepCount) * GAS_META_PER_STEP)
    + feeSwapGas;
  const relayerFee  = (gasEstimate * gasPrice * (10_000n + RELAYER_PREMIUM_BPS)) / 10_000n;

  // For ERC-20 output: quote how many tokenOut tokens the fee swap will cost.
  // Uses V2 getAmountsIn([tokenOut, WBNB], relayerFee) — exact amount needed.
  // Add 1% buffer to cover slippage between quote time and execution.
  let relayerFeeTokenAmount = 0n;
  let relayerFeeAdapterId: Hex   = ZERO_BYTES32;
  let relayerFeeAdapterData: Hex = "0x";

  if (feeSwapGas > 0n && tokenOut) {
    try {
      const exactIn = await quoteV2AmountsIn("PANCAKE_V2", [tokenOut, WBNB], relayerFee);
      relayerFeeTokenAmount = (exactIn * 10_100n) / 10_000n; // +1% slippage buffer
      relayerFeeAdapterId   = ADAPTER_IDS["PANCAKE_V2"];
      relayerFeeAdapterData = encodeV2AdapterData([tokenOut, WBNB], deadline ?? BigInt(Math.floor(Date.now() / 1000)) + 1800n);
    } catch {
      // Pool may not exist — caller should handle relayerFeeTokenAmount === 0n as "not available"
    }
  }

  return { gasPrice, gasEstimate, relayerFee, relayerFeeTokenAmount, relayerFeeAdapterId, relayerFeeAdapterData };
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

// ─── EIP-712 typed data builders ─────────────────────────────────────────────

// MetaTx domain — name and version match the contract constructor.
function metaTxDomain() {
  return {
    name:              "OneMEMEMetaTx",
    version:           "1",
    chainId:           getDexPublicClient().chain?.id ?? 56,
    verifyingContract: metaTxAddress(),
  };
}

const META_ORDER_TYPES = {
  MetaTxOrder: [
    { name: "user",                  type: "address" },
    { name: "nonce",                 type: "uint256" },
    { name: "deadline",              type: "uint256" },
    { name: "adapterId",             type: "bytes32" },
    { name: "tokenIn",               type: "address" },
    { name: "grossAmountIn",         type: "uint256" },
    { name: "tokenOut",              type: "address" },
    { name: "minUserOut",            type: "uint256" },
    { name: "recipient",             type: "address" },
    { name: "swapDeadline",          type: "uint256" },
    { name: "adapterData",           type: "bytes"   },
    { name: "relayerFee",            type: "uint256" },
    { name: "relayerFeeTokenAmount", type: "uint256" },
    { name: "relayerFeeAdapterId",   type: "bytes32" },
    { name: "relayerFeeAdapterData", type: "bytes"   },
  ],
} as const;

const BATCH_META_ORDER_TYPES = {
  BatchMetaTxOrder: [
    { name: "user",                  type: "address"   },
    { name: "nonce",                 type: "uint256"   },
    { name: "deadline",              type: "uint256"   },
    { name: "steps",                 type: "SwapStep[]"},
    { name: "grossAmountIn",         type: "uint256"   },
    { name: "minFinalOut",           type: "uint256"   },
    { name: "recipient",             type: "address"   },
    { name: "swapDeadline",          type: "uint256"   },
    { name: "relayerFee",            type: "uint256"   },
    { name: "relayerFeeTokenAmount", type: "uint256"   },
    { name: "relayerFeeAdapterId",   type: "bytes32"   },
    { name: "relayerFeeAdapterData", type: "bytes"     },
  ],
  SwapStep: [
    { name: "adapterId",   type: "bytes32" },
    { name: "tokenIn",     type: "address" },
    { name: "tokenOut",    type: "address" },
    { name: "minOut",      type: "uint256" },
    { name: "adapterData", type: "bytes"   },
  ],
} as const;

/** EIP-712 typed data for eth_signTypedData_v4 — single-step MetaTxOrder. */
export function buildMetaTxTypedData(order: MetaTxOrder) {
  return {
    domain:      metaTxDomain(),
    types:       META_ORDER_TYPES,
    primaryType: "MetaTxOrder" as const,
    message: {
      ...order,
      nonce:                 order.nonce.toString(),
      deadline:              order.deadline.toString(),
      grossAmountIn:         order.grossAmountIn.toString(),
      minUserOut:            order.minUserOut.toString(),
      swapDeadline:          order.swapDeadline.toString(),
      relayerFee:            order.relayerFee.toString(),
      relayerFeeTokenAmount: order.relayerFeeTokenAmount.toString(),
    },
  };
}

/** EIP-712 typed data for eth_signTypedData_v4 — BatchMetaTxOrder. */
export function buildBatchMetaTxTypedData(order: BatchMetaTxOrder) {
  return {
    domain:      metaTxDomain(),
    types:       BATCH_META_ORDER_TYPES,
    primaryType: "BatchMetaTxOrder" as const,
    message: {
      ...order,
      nonce:                 order.nonce.toString(),
      deadline:              order.deadline.toString(),
      grossAmountIn:         order.grossAmountIn.toString(),
      minFinalOut:           order.minFinalOut.toString(),
      swapDeadline:          order.swapDeadline.toString(),
      relayerFee:            order.relayerFee.toString(),
      relayerFeeTokenAmount: order.relayerFeeTokenAmount.toString(),
      steps:                 order.steps.map(s => ({
        ...s,
        minOut: s.minOut.toString(),
      })),
    },
  };
}

// ─── Relay execution ──────────────────────────────────────────────────────────

export async function relayMetaTx(
  order:  MetaTxOrder,
  sig:    Hex,
  permit: PermitData,
): Promise<Hex> {
  const { wallet, account } = getDexWalletClient();
  return wallet.writeContract({
    chain:        null,
    account,
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

/**
 * Builds calldata for OneMEMEAggregator.batchSwap().
 * Chains multiple adapter hops atomically in one transaction.
 */
export function buildBatchSwapCalldata(
  steps:       SwapStep[],
  amountIn:    bigint,
  minFinalOut: bigint,
  to:          Hex,
  deadline:    bigint,
): Hex {
  return encodeFunctionData({
    abi:          BATCH_AGGREGATOR_ABI,
    functionName: "batchSwap",
    args:         [steps, amountIn, minFinalOut, to, deadline],
  });
}

export async function getBatchOrderDigest(order: BatchMetaTxOrder): Promise<Hex> {
  return getDexPublicClient().readContract({
    address:      metaTxAddress(),
    abi:          BATCH_METATX_ABI,
    functionName: "batchOrderDigest",
    args:         [order],
  }) as Promise<Hex>;
}

/**
 * Verifies that `sig` was produced by `order.user` over the on-chain EIP-712 digest.
 * Returns true if valid. Call this before relaying to avoid burning gas on bad sigs.
 */
export async function verifyOrderSignature(order: MetaTxOrder, sig: Hex): Promise<boolean> {
  const digest   = await getOrderDigest(order);
  const recovered = await recoverAddress({ hash: digest, signature: sig });
  return recovered.toLowerCase() === order.user.toLowerCase();
}

export async function verifyBatchOrderSignature(order: BatchMetaTxOrder, sig: Hex): Promise<boolean> {
  const digest    = await getBatchOrderDigest(order);
  const recovered = await recoverAddress({ hash: digest, signature: sig });
  return recovered.toLowerCase() === order.user.toLowerCase();
}

export async function relayBatchMetaTx(
  order:  BatchMetaTxOrder,
  sig:    Hex,
  permit: PermitData,
): Promise<Hex> {
  const { wallet, account } = getDexWalletClient();
  return wallet.writeContract({
    chain:        null,
    account,
    address:      metaTxAddress(),
    abi:          BATCH_METATX_ABI,
    functionName: "batchExecuteMetaTx",
    args:         [order, sig, permit],
  });
}

// ─── Permit helpers ───────────────────────────────────────────────────────────

const ERC20_PERMIT_ABI = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function nonces(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);

/**
 * Detects which permit modes are available for a token/owner pair.
 *
 * Probes on-chain in parallel:
 *   - EIP-2612: calls nonces(owner) — succeeds only if the token implements it
 *   - Permit2 readiness: reads token.allowance(owner, permit2) — max means ready
 *   - MetaTx direct allowance: reads token.allowance(owner, metaTx) — for type 0
 *
 * Returns a recommended permitType:
 *   1 (EIP-2612)  — token supports it; no prior setup needed
 *   2 (Permit2)   — fallback; needs one-time token.approve(permit2, max) if not ready
 *   0 (pre-approve) — last resort; user must approve MetaTx contract directly
 */
export async function detectPermitType(
  token:  Hex,
  owner:  Hex,
  amount: bigint,
): Promise<{
  supportsEip2612:   boolean;
  permit2Allowance:  bigint;
  permit2Ready:      boolean;
  metaTxAllowance:   bigint;
  metaTxReady:       boolean;
  recommended:       0 | 1 | 2;
}> {
  const client = getDexPublicClient();
  const p2     = permit2Address();
  const metaTx = metaTxAddress();

  const [eip2612, domSep, p2Allow, metaTxAllow] = await Promise.allSettled([
    client.readContract({ address: token, abi: ERC20_PERMIT_ABI, functionName: "nonces",           args: [owner]        }) as Promise<bigint>,
    client.readContract({ address: token, abi: ERC20_PERMIT_ABI, functionName: "DOMAIN_SEPARATOR"                       }) as Promise<Hex>,
    client.readContract({ address: token, abi: ERC20_PERMIT_ABI, functionName: "allowance",        args: [owner, p2]    }) as Promise<bigint>,
    client.readContract({ address: token, abi: ERC20_PERMIT_ABI, functionName: "allowance",        args: [owner, metaTx]}) as Promise<bigint>,
  ]);

  // EIP-2612 is only considered supported if nonces() works AND we can verify
  // the domain separator — a domain mismatch causes silent permit failures on-chain.
  let supportsEip2612 = eip2612.status === "fulfilled";
  if (supportsEip2612 && domSep.status === "fulfilled") {
    const { hashDomain } = await import("viem");
    const chainId = client.chain?.id ?? 56;
    let nameStr = token as string;
    try {
      nameStr = await client.readContract({ address: token, abi: ERC20_PERMIT_ABI, functionName: "name" }) as string;
    } catch { /* use address as fallback */ }
    const verified = ["1", "2", ""].some(v => {
      const d = v ? { name: nameStr, version: v, chainId, verifyingContract: token }
                  : { name: nameStr, chainId, verifyingContract: token };
      return hashDomain({ domain: d }).toLowerCase() === (domSep.value as string).toLowerCase();
    });
    if (!verified) supportsEip2612 = false; // domain mismatch — permit would fail silently
  }
  const permit2Allowance = p2Allow.status      === "fulfilled" ? p2Allow.value      : 0n;
  const metaTxAllowance  = metaTxAllow.status  === "fulfilled" ? metaTxAllow.value  : 0n;
  const permit2Ready     = permit2Allowance >= amount;
  const metaTxReady      = metaTxAllowance  >= amount;

  const recommended: 0 | 1 | 2 = supportsEip2612 ? 1 : 2;

  return { supportsEip2612, permit2Allowance, permit2Ready, metaTxAllowance, metaTxReady, recommended };
}

/**
 * Builds the EIP-712 typed data the user must sign for an EIP-2612 permit.
 *
 * Probes the token for its actual domain version and verifies the computed
 * domain separator matches the on-chain value. This prevents silent permit
 * failures caused by domain mismatches (the MetaTx contract swallows permit
 * errors and reverts InsufficientAllowance, triggering a normal approval).
 *
 * Throws if the token does not support EIP-2612 or the domain cannot be verified.
 */
export async function buildEip2612TypedData(
  token:    Hex,
  owner:    Hex,
  spender:  Hex,
  amount:   bigint,
  deadline: bigint,
): Promise<{
  typedData: object;
  nonce:     string;
  version:   string;
  permitDataEncoding: string;
}> {
  const client  = getDexPublicClient();
  const chainId = client.chain?.id ?? 56;

  // Read all token properties in parallel; version() and DOMAIN_SEPARATOR() may not exist.
  const [nameRes, versionRes, nonceRes, domainSepRes] = await Promise.allSettled([
    client.readContract({ address: token, abi: ERC20_PERMIT_ABI, functionName: "name"             }) as Promise<string>,
    client.readContract({ address: token, abi: ERC20_PERMIT_ABI, functionName: "version"          }) as Promise<string>,
    client.readContract({ address: token, abi: ERC20_PERMIT_ABI, functionName: "nonces", args: [owner] }) as Promise<bigint>,
    client.readContract({ address: token, abi: ERC20_PERMIT_ABI, functionName: "DOMAIN_SEPARATOR" }) as Promise<Hex>,
  ]);

  if (nonceRes.status === "rejected") {
    throw new Error("Token does not implement EIP-2612 (nonces() call failed)");
  }

  const name    = nameRes.status    === "fulfilled" ? nameRes.value    : token;
  const nonce   = nonceRes.value;

  // Determine domain version: read from contract, else try "1" then "2".
  const onChainVersion = versionRes.status === "fulfilled" ? versionRes.value : null;
  const onChainDomainSep = domainSepRes.status === "fulfilled" ? domainSepRes.value : null;

  // Build and verify domain — if the token exposes DOMAIN_SEPARATOR we confirm ours matches.
  // This catches non-standard domains before the user signs a useless permit.
  const { hashDomain } = await import("viem");
  const candidateVersions = onChainVersion ? [onChainVersion] : ["1", "2"];
  let resolvedVersion = candidateVersions[0]!;
  let domainMismatch  = false;

  if (onChainDomainSep) {
    let matched = false;
    for (const v of candidateVersions) {
      const computed = hashDomain({
        domain: { name: String(name), version: v, chainId, verifyingContract: token },
      });
      if (computed.toLowerCase() === onChainDomainSep.toLowerCase()) {
        resolvedVersion = v;
        matched = true;
        break;
      }
    }
    // Also try without version field (some tokens omit it)
    if (!matched) {
      const computedNoVersion = hashDomain({
        domain: { name: String(name), chainId, verifyingContract: token },
      });
      if (computedNoVersion.toLowerCase() === onChainDomainSep.toLowerCase()) {
        resolvedVersion = "";
        matched = true;
      }
    }
    if (!matched) domainMismatch = true;
  }

  if (domainMismatch) {
    throw new Error(
      "Token has a non-standard EIP-712 domain — permit signature would fail silently. Use Permit2 instead.",
    );
  }

  // Build domain object (omit version if token doesn't use it)
  const domain: Record<string, unknown> = resolvedVersion
    ? { name: String(name), version: resolvedVersion, chainId, verifyingContract: token }
    : { name: String(name), chainId, verifyingContract: token };

  const typedData = {
    domain,
    types: {
      Permit: [
        { name: "owner",    type: "address" },
        { name: "spender",  type: "address" },
        { name: "value",    type: "uint256" },
        { name: "nonce",    type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: {
      owner,
      spender,
      value:    amount.toString(),
      nonce:    nonce.toString(),
      deadline: deadline.toString(),
    },
  };

  return {
    typedData,
    nonce:   nonce.toString(),
    version: resolvedVersion,
    permitDataEncoding: "abi.encode(uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  };
}

/**
 * Builds the EIP-712 typed data the user must sign for a Permit2
 * PermitTransferFrom authorisation, and the abi.encode recipe for
 * converting the signature → permitData.
 *
 * The user must have previously called token.approve(permit2, type(uint256).max)
 * once. After that, all authorisations are signed off-chain with this flow.
 */
export async function buildPermit2TypedData(
  token:    Hex,
  spender:  Hex,
  amount:   bigint,
  nonce:    bigint,
  deadline: bigint,
): Promise<{
  typedData: object;
  nonce:     string;
  permitDataEncoding: string;
}> {
  const client  = getDexPublicClient();
  const chainId = client.chain?.id ?? 56;
  const p2Addr  = permit2Address();

  const typedData = {
    domain: {
      name:              "Permit2",
      chainId,
      verifyingContract: p2Addr,
    },
    types: {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender",   type: "address" },
        { name: "nonce",     type: "uint256" },
        { name: "deadline",  type: "uint256" },
      ],
      TokenPermissions: [
        { name: "token",  type: "address" },
        { name: "amount", type: "uint256" },
      ],
    },
    primaryType: "PermitTransferFrom",
    message: {
      permitted: { token, amount: amount.toString() },
      spender,
      nonce:    nonce.toString(),
      deadline: deadline.toString(),
    },
  };

  return {
    typedData,
    nonce: nonce.toString(),
    permitDataEncoding: "abi.encode(uint256 nonce, uint256 deadline, bytes signature)",
  };
}
