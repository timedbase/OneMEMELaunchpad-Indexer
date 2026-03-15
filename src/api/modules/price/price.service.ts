import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";

interface ExchangeResult {
  exchange: string;
  price:    number;
  ok:       boolean;
}

interface PriceCache {
  bnbUsdt:   number;       // averaged price
  sources:   ExchangeResult[];
  updatedAt: number;       // unix seconds
  stale:     boolean;      // true if last fetch failed for all sources
}

@Injectable()
export class PriceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceService.name);
  private cache: PriceCache | null = null;
  private timer: NodeJS.Timeout | null = null;

  private readonly REFRESH_MS = 10_000; // 10 seconds

  // ─── Exchange Fetchers ──────────────────────────────────────────────────────

  private async fetchBinance(): Promise<ExchangeResult> {
    try {
      const res  = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT",
        { signal: AbortSignal.timeout(5_000) });
      const data = await res.json() as { price: string };
      const price = parseFloat(data.price);
      if (!isFinite(price) || price <= 0) throw new Error("invalid price");
      return { exchange: "Binance", price, ok: true };
    } catch {
      return { exchange: "Binance", price: 0, ok: false };
    }
  }

  private async fetchOKX(): Promise<ExchangeResult> {
    try {
      const res  = await fetch("https://www.okx.com/api/v5/market/ticker?instId=BNB-USDT",
        { signal: AbortSignal.timeout(5_000) });
      const data = await res.json() as { data: { last: string }[] };
      const price = parseFloat(data.data[0].last);
      if (!isFinite(price) || price <= 0) throw new Error("invalid price");
      return { exchange: "OKX", price, ok: true };
    } catch {
      return { exchange: "OKX", price: 0, ok: false };
    }
  }

  private async fetchBybit(): Promise<ExchangeResult> {
    try {
      const res  = await fetch("https://api.bybit.com/v5/market/tickers?category=spot&symbol=BNBUSDT",
        { signal: AbortSignal.timeout(5_000) });
      const data = await res.json() as { result: { list: { lastPrice: string }[] } };
      const price = parseFloat(data.result.list[0].lastPrice);
      if (!isFinite(price) || price <= 0) throw new Error("invalid price");
      return { exchange: "Bybit", price, ok: true };
    } catch {
      return { exchange: "Bybit", price: 0, ok: false };
    }
  }

  // ─── Aggregation ────────────────────────────────────────────────────────────

  private async refresh(): Promise<void> {
    const sources = await Promise.all([
      this.fetchBinance(),
      this.fetchOKX(),
      this.fetchBybit(),
    ]);

    const live = sources.filter((s) => s.ok);

    if (live.length === 0) {
      // All exchanges failed — keep last cached price but mark stale
      if (this.cache) {
        this.cache = { ...this.cache, stale: true, sources, updatedAt: Math.floor(Date.now() / 1000) };
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
      updatedAt: Math.floor(Date.now() / 1000),
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
      })),
      updatedAt: this.cache.updatedAt,
      stale:     this.cache.stale,
    };
  }
}
