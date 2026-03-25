import { createConfig, factory } from "ponder";
import { fallback, http, webSocket } from "viem";
import type { AbiEvent } from "viem";

import LaunchpadFactoryAbi from "./abis/LaunchpadFactory";
import BondingCurveAbi     from "./abis/BondingCurve";
import ERC20Abi            from "./abis/ERC20";
import VestingWalletAbi    from "./abis/VestingWallet";

/**
 * Ponder configuration for the OneMEME Launchpad Indexer.
 *
 * Transport: WebSocket primary, HTTP fallback.
 *
 *   BSC_WSS_URL — primary transport.
 *     Ponder subscribes to `eth_subscribe_logs` over the persistent WSS
 *     connection, receiving emitted events in real-time with sub-second
 *     latency and zero polling overhead.
 *
 *   BSC_RPC_URL — automatic fallback.
 *     Activated by viem's fallback() if the WSS connection drops, times out,
 *     or returns an error. Ponder seamlessly resumes over WSS once it recovers.
 *
 * Both variables must be set. The indexer throws at startup if either is
 * missing so misconfiguration is caught immediately.
 *
 * Contracts indexed:
 *   LaunchpadFactory  — emits TokenCreated (one per deployed token)
 *   BondingCurve      — emits TokenBought, TokenSold, TokenMigrated
 *   MemeToken         — ERC-20 Transfer events on every factory-deployed token
 *   VestingWallet     — emits VestingAdded, Claimed, VestingVoided
 */

const BSC_WSS_URL           = process.env.BSC_WSS_URL;
const BSC_RPC_URL           = process.env.BSC_RPC_URL;
const CHAIN_ID              = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID) : undefined;
const FACTORY_ADDRESS        = process.env.FACTORY_ADDRESS;
const BONDING_CURVE_ADDRESS  = process.env.BONDING_CURVE_ADDRESS;
const VESTING_WALLET_ADDRESS = process.env.VESTING_WALLET_ADDRESS;

if (!BSC_WSS_URL)            throw new Error("BSC_WSS_URL is required. Set it in your .env file (wss://...).");
if (!BSC_RPC_URL)            throw new Error("BSC_RPC_URL is required. Set it in your .env file (https://...).");
if (!CHAIN_ID)               throw new Error("CHAIN_ID is required. Set it in your .env file (e.g. 56 for BSC mainnet).");
if (!FACTORY_ADDRESS)        throw new Error("FACTORY_ADDRESS is required. Set it in your .env file.");
if (!BONDING_CURVE_ADDRESS)  throw new Error("BONDING_CURVE_ADDRESS is required. Set it in your .env file.");
if (!VESTING_WALLET_ADDRESS) throw new Error("VESTING_WALLET_ADDRESS is required. Set it in your .env file.");

const startBlock = process.env.START_BLOCK ? parseInt(process.env.START_BLOCK) : 0;

// WSS primary → HTTP fallback
const transports = [
  webSocket(BSC_WSS_URL),
  http(BSC_RPC_URL),
];

// Locate the TokenCreated event in the factory ABI for the factory() helper.
// Cast to AbiEvent after the runtime check — the JSON shape is compatible.
const tokenCreatedRaw = LaunchpadFactoryAbi.find(
  (e) => "type" in e && e.type === "event" && "name" in e && e.name === "TokenCreated",
);
if (!tokenCreatedRaw) throw new Error("TokenCreated event not found in LaunchpadFactory ABI");
const tokenCreatedEvent = tokenCreatedRaw as unknown as AbiEvent;

export default createConfig({
  networks: {
    bsc: {
      chainId:   CHAIN_ID,
      transport: fallback(transports),
    },
  },

  contracts: {
    // Emits TokenCreated when a new meme token is deployed.
    LaunchpadFactory: {
      network:    "bsc",
      abi:        LaunchpadFactoryAbi,
      address:    FACTORY_ADDRESS as `0x${string}`,
      startBlock,
    },

    // Emits TokenBought, TokenSold, TokenMigrated for all bonding-curve activity.
    BondingCurve: {
      network:    "bsc",
      abi:        BondingCurveAbi,
      address:    BONDING_CURVE_ADDRESS as `0x${string}`,
      startBlock,
    },

    // Tracks Transfer events on every token deployed by the factory.
    // Ponder reads the `token` field from each TokenCreated log to discover
    // new contract addresses automatically — no manual address list needed.
    MemeToken: {
      network:    "bsc",
      abi:        ERC20Abi,
      address:    factory({
        address:   FACTORY_ADDRESS as `0x${string}`,
        event:     tokenCreatedEvent,
        parameter: "token",
      }),
      startBlock,
    },

    // Emits VestingAdded (on token creation), Claimed, and VestingVoided.
    // Single shared contract for all creator token vesting schedules.
    VestingWallet: {
      network:    "bsc",
      abi:        VestingWalletAbi,
      address:    VESTING_WALLET_ADDRESS as `0x${string}`,
      startBlock,
    },
  },
});
