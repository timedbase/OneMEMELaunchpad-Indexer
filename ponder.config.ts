import { createConfig, factory } from "ponder";
import { fallback, http, webSocket } from "viem";
import type { Abi, AbiEvent } from "viem";

import LaunchpadFactoryAbiRaw from "./abis/LaunchpadFactory.json";
import BondingCurveAbiRaw     from "./abis/BondingCurve.json";
import ERC20AbiRaw            from "./abis/ERC20.json";

const LaunchpadFactoryAbi = LaunchpadFactoryAbiRaw as Abi;
const BondingCurveAbi     = BondingCurveAbiRaw     as Abi;
const ERC20Abi            = ERC20AbiRaw            as Abi;

/**
 * Ponder configuration for the OneMEME Launchpad Indexer.
 *
 * Transport: WebSocket + HTTP fallback (both required).
 *
 *   BSC_WSS_URL — primary transport.
 *     Ponder subscribes to `eth_subscribe_logs` over the persistent WSS
 *     connection, receiving emitted events in real-time with sub-second
 *     latency and zero polling overhead.
 *
 *   BSC_RPC_URL — automatic fallback.
 *     Activated by viem's fallback() if the WSS connection drops, times out,
 *     or returns an error. Ponder seamlessly switches to HTTP polling and
 *     resumes streaming over WSS once the connection recovers.
 *
 * Both variables must be set. The indexer will throw at startup if either
 * is missing so misconfiguration is caught immediately rather than silently
 * degrading to a broken state.
 *
 * Contracts indexed:
 *   LaunchpadFactory  — emits TokenCreated (one per deployed token)
 *   BondingCurve      — emits TokenBought, TokenSold, TokenMigrated
 *   MemeToken         — ERC-20 Transfer events on every factory-deployed token
 *                       (factory pattern; Ponder discovers addresses automatically)
 */

const BSC_WSS_URL           = process.env.BSC_WSS_URL;
const BSC_WSS_URL_2         = process.env.BSC_WSS_URL_2;   // optional secondary WSS
const BSC_RPC_URL           = process.env.BSC_RPC_URL;
const BSC_RPC_URL_2         = process.env.BSC_RPC_URL_2;   // optional secondary HTTP
const FACTORY_ADDRESS       = process.env.FACTORY_ADDRESS;
const BONDING_CURVE_ADDRESS = process.env.BONDING_CURVE_ADDRESS;

if (!BSC_WSS_URL)           throw new Error("BSC_WSS_URL is required. Set it in your .env file (wss://...).");
if (!BSC_RPC_URL)           throw new Error("BSC_RPC_URL is required. Set it in your .env file (https://...).");
if (!FACTORY_ADDRESS)       throw new Error("FACTORY_ADDRESS is required. Set it in your .env file.");
if (!BONDING_CURVE_ADDRESS) throw new Error("BONDING_CURVE_ADDRESS is required. Set it in your .env file.");

const startBlock = process.env.START_BLOCK ? parseInt(process.env.START_BLOCK) : 0;

// Build transport stack: WSS1 → WSS2 → HTTP1 → HTTP2
// viem's fallback() tries each transport in order, switching on error or timeout.
// WSS is preferred (real-time push, zero polling overhead).
// HTTP is the safety net when both WSS connections drop.
const transports = [
  webSocket(BSC_WSS_URL),
  ...(BSC_WSS_URL_2 ? [webSocket(BSC_WSS_URL_2)] : []),
  http(BSC_RPC_URL),
  ...(BSC_RPC_URL_2 ? [http(BSC_RPC_URL_2)] : []),
];

// Locate the TokenCreated event in the factory ABI for the factory() helper.
// Cast to AbiEvent after the runtime check — the JSON shape is compatible.
const tokenCreatedRaw = LaunchpadFactoryAbiRaw.find(
  (e) => "type" in e && e.type === "event" && "name" in e && e.name === "TokenCreated",
);
if (!tokenCreatedRaw) throw new Error("TokenCreated event not found in LaunchpadFactory ABI");
const tokenCreatedEvent = tokenCreatedRaw as unknown as AbiEvent;

export default createConfig({
  networks: {
    bsc: {
      chainId:   56,
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
  },
});
