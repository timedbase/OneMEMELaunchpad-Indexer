import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";

interface ExchangeResult {
  exchange: string;
  price:    number;
  ok:       boolean;
  cachedAt: number; // unix seconds — when this source last succeeded
}

interface PriceCache {
  bnbUsdt:   number;
  sources:   ExchangeResult[];
  updatedAt: number;
  stale:     boolean;
}

// Per-source TTL in seconds — if a source hasn't succeeded within TTL it is
// considered stale and excluded from the average until it recovers.
const SOURCE_TTL: Record<string, number> = {
  Binance:   30,
  OKX:       30,
  Bybit:     30,
  CoinGecko: 60,  // CoinGecko free tier updates every 60s
  MEXC:      30,
  GateIO:    30,
};

@Injectable()
export class PriceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceService.name);
  private cache: PriceCache | null = null;
  private timer: NodeJS.Timeout | null = null;

  // Each source keeps its last successful result so stale data can be reused
  // within TTL even if the current fetch fails.
  private lastGood: Map<string, ExchangeResult> = new Map();

  private readonly REFRESH_MS = 10_000; // 10 seconds

  // ─── Exchange Fetchers ──────────────────────────────────────────────────────

  private async fetchBinance(): Promise<ExchangeResult> {
    try {
      const res  = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT",
        { signal: AbortSignal.timeout(5_000) });
      const data = await res.json() as { price: string };
      const price = parseFloat(data.price);
      if (!isFinite(price) || price <= 0) throw new Error("invalid price");
      return { exchange: "Binance", price, ok: true, cachedAt: Math.floor(Date.now() / 1000) };
    } catch (err) {
      this.logger.warn(`Binance fetch failed: ${(err as Error).message}`);
      return { exchange: "Binance", price: 0, ok: false, cachedAt: 0 };
    }
  }

  private async fetchOKX(): Promise<ExchangeResult> {
    try {
      const res  = await fetch("https://www.okx.com/api/v5/market/ticker?instId=BNB-USDT",
        { signal: AbortSignal.timeout(5_000) });
      const data = await res.json() as { data: { last: string }[] };
      const price = parseFloat(data.data[0].last);
      if (!isFinite(price) || price <= 0) throw new Error("invalid price");
      return { exchange: "OKX", price, ok: true, cachedAt: Math.floor(Date.now() / 1000) };
    } catch (err) {
      this.logger.warn(`OKX fetch failed: ${(err as Error).message}`);
      return { exchange: "OKX", price: 0, ok: false, cachedAt: 0 };
    }
  }

  private async fetchBybit(): Promise<ExchangeResult> {
    try {
      const res  = await fetch("https://api.bybit.com/v5/market/tickers?category=spot&symbol=BNBUSDT",
        { signal: AbortSignal.timeout(5_000) });
      const data = await res.json() as { result: { list: { lastPrice: string }[] } };
      const price = parseFloat(data.result.list[0].lastPrice);
      if (!isFinite(price) || price <= 0) throw new Error("invalid price");
      return { exchange: "Bybit", price, ok: true, cachedAt: Math.floor(Date.now() / 1000) };
    } catch (err) {
      this.logger.warn(`Bybit fetch failed: ${(err as Error).message}`);
      return { exchange: "Bybit", price: 0, ok: false, cachedAt: 0 };
    }
  }

  private async fetchCoinGecko(): Promise<ExchangeResult> {
    try {
      const res  = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd",
        { signal: AbortSignal.timeout(8_000) });
      const data = await res.json() as { binancecoin: { usd: number } };
      const price = data.binancecoin.usd;
      if (!isFinite(price) || price <= 0) throw new Error("invalid price");
      return { exchange: "CoinGecko", price, ok: true, cachedAt: Math.floor(Date.now() / 1000) };
    } catch (err) {
      this.logger.warn(`CoinGecko fetch failed: ${(err as Error).message}`);
      return { exchange: "CoinGecko", price: 0, ok: false, cachedAt: 0 };
    }
  }

  private async fetchMEXC(): Promise<ExchangeResult> {
    try {
      const res  = await fetch("https://api.mexc.com/api/v3/ticker/price?symbol=BNBUSDT",
        { signal: AbortSignal.timeout(5_000) });
      const data = await res.json() as { price: string };
      const price = parseFloat(data.price);
      if (!isFinite(price) || price <= 0) throw new Error("invalid price");
      return { exchange: "MEXC", price, ok: true, cachedAt: Math.floor(Date.now() / 1000) };
    } catch (err) {
      this.logger.warn(`MEXC fetch failed: ${(err as Error).message}`);
      return { exchange: "MEXC", price: 0, ok: false, cachedAt: 0 };
    }
  }

  private async fetchGateIO(): Promise<ExchangeResult> {
    try {
      const res  = await fetch("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BNB_USDT",
        { signal: AbortSignal.timeout(5_000) });
      const data = await res.json() as { last: string }[];
      const price = parseFloat(data[0].last);
      if (!isFinite(price) || price <= 0) throw new Error("invalid price");
      return { exchange: "GateIO", price, ok: true, cachedAt: Math.floor(Date.now() / 1000) };
    } catch (err) {
      this.logger.warn(`GateIO fetch failed: ${(err as Error).message}`);
      return { exchange: "GateIO", price: 0, ok: false, cachedAt: 0 };
    }
  }

  // ─── Aggregation ────────────────────────────────────────────────────────────

  private async refresh(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    const fresh = await Promise.all([
      this.fetchBinance(),
      this.fetchOKX(),
      this.fetchBybit(),
      this.fetchCoinGecko(),
      this.fetchMEXC(),
      this.fetchGateIO(),
    ]);

    // Update lastGood cache for any source that just succeeded
    for (const r of fresh) {
      if (r.ok) this.lastGood.set(r.exchange, r);
    }

    // Build final source list: use fresh result if ok, else fall back to
    // lastGood if within TTL, else treat as failed.
    const sources: ExchangeResult[] = fresh.map((r) => {
      if (r.ok) return r;
      const last = this.lastGood.get(r.exchange);
      const ttl  = SOURCE_TTL[r.exchange] ?? 30;
      if (last && now - last.cachedAt <= ttl) {
        // Within TTL — reuse last good value, mark ok so it contributes to avg
        return { ...last, ok: true };
      }
      return r; // truly failed and expired
    });

    const live = sources.filter((s) => s.ok);

    if (live.length === 0) {
      if (this.cache) {
        this.cache = { ...this.cache, stale: true, sources, updatedAt: now };
        this.logger.warn("All exchange fetches failed — serving stale BNB price");
      } else {
        this.logger.error("All exchange fetches failed and no cache available");
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

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async onModuleInit() {
    await this.refresh();
    this.timer = setInterval(() => { void this.refresh(); }, this.REFRESH_MS);
    this.logger.log(`BNB price aggregator started (refresh every ${this.REFRESH_MS / 1000}s)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── Public ─────────────────────────────────────────────────────────────────

  getPrice() {
    if (!this.cache) {
      return { error: "Price not yet available — try again in a few seconds" };
    }

    return {
      bnbUsdt:   this.cache.bnbUsdt,
      sources:   this.cache.sources.map((s) => ({
        exchange: s.exchange,
        price:    s.ok ? s.price : null,
        ok:       s.ok,
        cachedAt: s.cachedAt || null,
      })),
      updatedAt: this.cache.updatedAt,
      stale:     this.cache.stale,
    };
  }
}
