import { createConfig } from "ponder";
import { fallback, http, webSocket } from "viem";

import LaunchpadFactoryAbi from "./abis/LaunchpadFactory.json";
import ERC20Abi            from "./abis/ERC20.json";

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
 */

const BSC_WSS_URL = process.env.BSC_WSS_URL;
const BSC_RPC_URL = process.env.BSC_RPC_URL;

if (!BSC_WSS_URL) throw new Error("BSC_WSS_URL is required. Set it in your .env file (wss://...).");
if (!BSC_RPC_URL) throw new Error("BSC_RPC_URL is required. Set it in your .env file (https://...).");

export default createConfig({
  networks: {
    bsc: {
      chainId: 56,
      transport: fallback([
        webSocket(BSC_WSS_URL),
        http(BSC_RPC_URL),
      ]),
    },
  },

  contracts: {
    LaunchpadFactory: {
      network:    "bsc",
      abi:        LaunchpadFactoryAbi as any,
      address:    process.env.FACTORY_ADDRESS as `0x${string}`,
      startBlock: process.env.START_BLOCK ? parseInt(process.env.START_BLOCK) : 0,
    },

    // Tracks Transfer events on every token deployed by the factory.
    // Ponder reads the `token` field from each TokenCreated log to discover
    // new contract addresses automatically — no manual address list needed.
    MemeToken: {
      network: "bsc",
      abi:     ERC20Abi as any,
      factory: {
        address:   process.env.FACTORY_ADDRESS as `0x${string}`,
        event:     LaunchpadFactoryAbi.find((e: any) => e.name === "TokenCreated") as any,
        parameter: "token",
      },
      startBlock: process.env.START_BLOCK ? parseInt(process.env.START_BLOCK) : 0,
    },
  },
});
