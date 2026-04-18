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
