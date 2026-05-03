import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { createPublicClient, http, parseAbi, defineChain } from "viem";

interface SourceResult {
  source:   string;
  price:    number;
  ok:       boolean;
  cachedAt: number;
}

interface PriceCache {
  bnbUsdt:   number;
  sources:   SourceResult[];
  updatedAt: number;
  stale:     boolean;
}

// PancakeSwap V2 WBNB/USDT pair on BSC mainnet.
// token0 = USDT (0x55d398..., 18 dec), token1 = WBNB (0xbb4CdB..., 18 dec)
// Override with WBNB_USDT_PAIR_ADDRESS env var for testnet or a different pool.
const DEFAULT_WBNB_USDT_PAIR = "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE";

const PAIR_ABI = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
]);

// How long (seconds) to keep reusing a source's last good value after a failed fetch.
const SOURCE_TTL: Record<string, number> = {
  CoinGecko:   90,
  PancakeSwap: 30,
};

@Injectable()
export class PriceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceService.name);
  private cache: PriceCache | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastGood = new Map<string, SourceResult>();
  private rpcClient: ReturnType<typeof createPublicClient> | null = null;

  private readonly REFRESH_MS = 10_000;

  // ─── RPC client ─────────────────────────────────────────────────────────────

  private getClient(): ReturnType<typeof createPublicClient> | null {
    if (!process.env.BSC_RPC_URL) return null;
    if (!this.rpcClient) {
      const chainId = parseInt(process.env.CHAIN_ID ?? "56");
      const chain   = defineChain({
        id: chainId,
        name: "EVM",
        nativeCurrency: { name: "Native", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [process.env.BSC_RPC_URL] } },
      });
      this.rpcClient = createPublicClient({
        chain,
        transport: http(process.env.BSC_RPC_URL, { timeout: 8_000, retryCount: 1, retryDelay: 500 }),
      });
    }
    return this.rpcClient;
  }

  // ─── Source fetchers ─────────────────────────────────────────────────────────

  private async fetchCoinGecko(): Promise<SourceResult> {
    try {
      const res  = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd",
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data  = await res.json() as { binancecoin?: { usd?: number } };
      const price = data.binancecoin?.usd;
      if (typeof price !== "number" || !isFinite(price) || price <= 0) throw new Error("invalid price");
      return { source: "CoinGecko", price, ok: true, cachedAt: Math.floor(Date.now() / 1000) };
    } catch (err) {
      this.logger.warn(`CoinGecko fetch failed: ${(err as Error).message}`);
      return { source: "CoinGecko", price: 0, ok: false, cachedAt: 0 };
    }
  }

  private async fetchPancakeSwap(): Promise<SourceResult> {
    const client = this.getClient();
    if (!client) {
      return { source: "PancakeSwap", price: 0, ok: false, cachedAt: 0 };
    }
    try {
      const pair = (process.env.WBNB_USDT_PAIR_ADDRESS ?? DEFAULT_WBNB_USDT_PAIR) as `0x${string}`;
      const [reserve0, reserve1] = await client.readContract({
        address:      pair,
        abi:          PAIR_ABI,
        functionName: "getReserves",
      }) as [bigint, bigint, number];

      if (reserve0 === 0n || reserve1 === 0n) throw new Error("empty reserves");

      // token0 = USDT (18 dec), token1 = WBNB (18 dec)
      // price (USDT per BNB) = reserve0 / reserve1
      // Scale to 6 decimal places before converting to Number to preserve precision.
      const priceScaled = (reserve0 * 1_000_000n) / reserve1;
      const price = Number(priceScaled) / 1_000_000;
      if (!isFinite(price) || price <= 0) throw new Error("invalid price");

      return { source: "PancakeSwap", price, ok: true, cachedAt: Math.floor(Date.now() / 1000) };
    } catch (err) {
      this.logger.warn(`PancakeSwap fetch failed: ${(err as Error).message}`);
      return { source: "PancakeSwap", price: 0, ok: false, cachedAt: 0 };
    }
  }

  // ─── Aggregation ─────────────────────────────────────────────────────────────

  private async refresh(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    const fresh = await Promise.all([
      this.fetchCoinGecko(),
      this.fetchPancakeSwap(),
    ]);

    for (const r of fresh) {
      if (r.ok) this.lastGood.set(r.source, r);
    }

    // Use fresh result if ok, else fall back to lastGood within TTL.
    const sources: SourceResult[] = fresh.map((r) => {
      if (r.ok) return r;
      const last = this.lastGood.get(r.source);
      const ttl  = SOURCE_TTL[r.source] ?? 30;
      if (last && now - last.cachedAt <= ttl) return { ...last, ok: true };
      return r;
    });

    const live = sources.filter((s) => s.ok);

    if (live.length === 0) {
      if (this.cache) {
        this.cache = { ...this.cache, stale: true, sources, updatedAt: now };
        this.logger.warn("All price fetches failed — serving stale BNB price");
      } else {
        this.logger.error("All price fetches failed and no cache available");
      }
      return;
    }

    const avg = live.reduce((sum, s) => sum + s.price, 0) / live.length;

    this.cache = {
      bnbUsdt:   parseFloat(avg.toFixed(4)),
      sources,
      updatedAt: now,
      stale:     false,
    };
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  async onModuleInit() {
    await this.refresh();
    this.timer = setInterval(() => { void this.refresh(); }, this.REFRESH_MS).unref();
    this.logger.log(`BNB price service started (refresh every ${this.REFRESH_MS / 1000}s)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── Public ──────────────────────────────────────────────────────────────────

  getPrice() {
    if (!this.cache) {
      return { error: "Price not yet available — try again in a few seconds" };
    }
    return {
      bnbUsdt:   this.cache.bnbUsdt,
      sources:   this.cache.sources.map((s) => ({
        source:   s.source,
        price:    s.ok ? s.price : null,
        ok:       s.ok,
        cachedAt: s.cachedAt || null,
      })),
      updatedAt: this.cache.updatedAt,
      stale:     this.cache.stale,
    };
  }
}
