/**
 * Salt mining service — fresh mine per SSE session, all 3 token types in parallel.
 *
 * Each time a client opens the /stream endpoint:
 *   1. Any previous session result for that address is cleared.
 *   2. Three worker threads are spawned simultaneously — one per token type
 *      (Standard, Tax, Reflection) — each mining against its own impl address.
 *   3. Progress and found events are emitted tagged with their tokenType.
 *   4. The stream completes once all three types have been found.
 *   5. When the client disconnects all three workers are terminated immediately.
 *
 * GET /salt/:address returns whatever is in the session result (partial or
 * complete).  Returns 404 if no session has been started yet.
 */

import {
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Worker }    from "worker_threads";
import path          from "path";
import { Subject, Observable } from "rxjs";
import {
  createPublicClient,
  http,
  fallback,
  webSocket,
  parseAbi,
  defineChain,
  getAddress,
} from "viem";

export type TokenType = "Standard" | "Tax" | "Reflection";
const ALL_TYPES: TokenType[] = ["Standard", "Tax", "Reflection"];

export interface TypedSaltResult {
  salt:             string;   // bytes32 hex (0x-prefixed, 66 chars)
  predictedAddress: string;   // checksummed EIP-55 address
  attempts:         number;
}

export interface SessionResult {
  address:     string;
  standard?:   TypedSaltResult;
  tax?:        TypedSaltResult;
  reflection?: TypedSaltResult;
}

export interface SaltEvent {
  type:              "progress" | "found";
  tokenType:         TokenType;
  attempts:          number;
  salt?:             string;
  predictedAddress?: string;
}

interface ActiveMine {
  subject:         Subject<SaltEvent>;
  /** null while impl addresses are still being fetched asynchronously. */
  workers:         Partial<Record<TokenType, Worker | null>>;
  subscriberCount: number;
  doneCount:       number;   // increments 0→3 as each type is found
}

@Injectable()
export class SaltService implements OnModuleInit {
  private implAddresses?: Record<TokenType, `0x${string}`>;

  /** In-progress worker sessions keyed by `address` (lowercase). */
  private readonly active         = new Map<string, ActiveMine>();

  /**
   * Partial or complete session results keyed by `address` (lowercase).
   * Cleared when a new stream opens. Readable via GET at any point during/after mining.
   */
  private readonly sessionResults = new Map<string, SessionResult>();

  async onModuleInit() {
    try {
      this.implAddresses = await this.fetchImplAddresses();
    } catch (err) {
      console.warn("[SaltService] Could not fetch impl addresses at startup:", err);
    }
  }

  // ── Viem client ───────────────────────────────────────────────────────────

  private getClient() {
    const rpcUrl = process.env.BSC_RPC_URL;
    if (!rpcUrl) throw new ServiceUnavailableException("BSC_RPC_URL is not configured.");

    const chainId = parseInt(process.env.CHAIN_ID ?? "56");
    const chain   = defineChain({
      id:             chainId,
      name:           "BSC",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      rpcUrls:        { default: { http: [rpcUrl] } },
    });
    const transports = [
      ...(process.env.BSC_WSS_URL ? [webSocket(process.env.BSC_WSS_URL)] : []),
      http(rpcUrl, { timeout: 15_000, retryCount: 2 }),
    ];
    return createPublicClient({ chain, transport: fallback(transports) });
  }

  private async fetchImplAddresses(): Promise<Record<TokenType, `0x${string}`>> {
    const factoryAddress = process.env.FACTORY_ADDRESS as `0x${string}`;
    if (!factoryAddress) throw new Error("FACTORY_ADDRESS is not configured.");

    const abi = parseAbi([
      "function standardImpl() view returns (address)",
      "function taxImpl() view returns (address)",
      "function reflectionImpl() view returns (address)",
    ]);

    const client = this.getClient();
    const [standard, tax, reflection] = await Promise.all([
      client.readContract({ address: factoryAddress, abi, functionName: "standardImpl" }),
      client.readContract({ address: factoryAddress, abi, functionName: "taxImpl" }),
      client.readContract({ address: factoryAddress, abi, functionName: "reflectionImpl" }),
    ]);

    return {
      Standard:   standard   as `0x${string}`,
      Tax:        tax        as `0x${string}`,
      Reflection: reflection as `0x${string}`,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns the current session result for an address.
   * May be partial (some types still mining) or undefined (not started yet).
   */
  getResult(address: string): SessionResult | undefined {
    return this.sessionResults.get(address.toLowerCase());
  }

  /**
   * Opens a fresh mining session — spawns 3 workers in parallel.
   *
   * - Clears any previous session result (forces a fresh mine).
   * - Joins an already-running session if one exists (e.g. two tabs).
   * - Terminates all workers when the last subscriber disconnects.
   */
  startMining(address: string): Observable<SaltEvent> {
    const key = address.toLowerCase();

    // Invalidate previous session — this connection wants fresh salts.
    this.sessionResults.delete(key);

    // Create the mine entry immediately so it is always present when
    // the Observable subscriber runs.
    if (!this.active.has(key)) {
      const mine: ActiveMine = {
        subject:         new Subject<SaltEvent>(),
        workers:         {},
        subscriberCount: 0,
        doneCount:       0,
      };
      this.active.set(key, mine);
      this.spawnWorkers(address, key, mine);
    }

    const mine = this.active.get(key)!;

    return new Observable(subscriber => {
      mine.subscriberCount++;
      const sub = mine.subject.subscribe(subscriber);

      // Teardown: runs when the SSE connection closes.
      return () => {
        sub.unsubscribe();
        mine.subscriberCount--;

        if (mine.subscriberCount === 0 && this.active.has(key)) {
          // Last subscriber gone — terminate all running workers.
          for (const worker of Object.values(mine.workers)) {
            worker?.terminate();
          }
          mine.subject.complete();
          this.active.delete(key);
        }
      };
    });
  }

  // ── Worker lifecycle ──────────────────────────────────────────────────────

  private spawnWorkers(address: string, key: string, mine: ActiveMine): void {
    const doSpawn = async () => {
      if (!this.implAddresses) {
        this.implAddresses = await this.fetchImplAddresses();
      }

      // Abort if all subscribers disconnected during the async fetch.
      if (!this.active.has(key)) return;

      const factoryAddress = process.env.FACTORY_ADDRESS as `0x${string}`;
      if (!factoryAddress) {
        throw new ServiceUnavailableException("FACTORY_ADDRESS is not configured.");
      }

      for (const tokenType of ALL_TYPES) {
        if (!this.active.has(key)) break;
        this.spawnOneWorker(address, tokenType, key, mine, factoryAddress);
      }
    };

    doSpawn().catch(err => {
      mine.subject.error(err instanceof Error ? err : new Error(String(err)));
      this.active.delete(key);
    });
  }

  private spawnOneWorker(
    address:        string,
    tokenType:      TokenType,
    key:            string,
    mine:           ActiveMine,
    factoryAddress: `0x${string}`,
  ): void {
    const implAddress = this.implAddresses![tokenType];
    const isTs        = __filename.endsWith(".ts");
    const workerPath  = path.resolve(__dirname, `salt.worker${isTs ? ".ts" : ".js"}`);
    const execArgv    = isTs ? ["--require", "ts-node/register/transpile-only"] : [];

    const worker = new Worker(workerPath, {
      execArgv,
      workerData: { factoryAddress, implAddress, creatorAddress: address },
    });

    mine.workers[tokenType] = worker;

    worker.on("message", (msg: { type: string; salt?: string; predictedAddress?: string; attempts: number }) => {
      // Tag the event with tokenType and forward to all subscribers.
      mine.subject.next({ ...(msg as SaltEvent), tokenType });

      if (msg.type === "found" && msg.salt && msg.predictedAddress) {
        let checksummed: string;
        try   { checksummed = getAddress(msg.predictedAddress); }
        catch { checksummed = msg.predictedAddress; }

        // Store partial result — readable via GET immediately.
        const current = this.sessionResults.get(key) ?? { address } as SessionResult;
        const field   = tokenType.toLowerCase() as "standard" | "tax" | "reflection";
        current[field] = {
          salt:             msg.salt,
          predictedAddress: checksummed,
          attempts:         msg.attempts,
        };
        this.sessionResults.set(key, current);

        mine.doneCount++;
        if (mine.doneCount === ALL_TYPES.length) {
          // All three types mined — complete the stream.
          mine.subject.complete();
          this.active.delete(key);
        }
      }
    });

    worker.on("error", err => {
      mine.subject.error(err);
      this.active.delete(key);
    });

    worker.on("exit", code => {
      // Guard: teardown may have already cleaned up via terminate().
      if (code !== 0 && this.active.has(key)) {
        mine.subject.error(new Error(`Salt worker (${tokenType}) exited with code ${code}`));
        this.active.delete(key);
      }
    });
  }
}
