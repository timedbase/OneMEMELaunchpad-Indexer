# TradingView Lightweight Charts Integration

This document covers how the OneMEME indexer API serves chart data for
[TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/).

---

## Important: Lightweight Charts vs Advanced Charts

**TradingView Lightweight Charts** is a standalone JavaScript library (`lightweight-charts`
npm package). You fetch data yourself and call `series.setData()`. It does **not** poll
any API automatically.

**TradingView Advanced Charts** (the full widget / iframe embed) uses the
UDF (Universal Data Feed) protocol — it polls `/config`, `/symbols`, `/history`,
`/search`, and `/time` automatically. The API includes those UDF endpoints for
potential future use, but **Lightweight Charts does not use them**.

---

## Chart History Endpoint

```
GET /api/v1/{chain}/charts/history
```

### Query Parameters

| Parameter    | Required | Default          | Description |
|---|---|---|---|
| `symbol`     | yes      | —                | Token contract address (0x…) |
| `resolution` | no       | `60`             | Bar width — see table below |
| `to`         | no       | now              | End of range (unix seconds) |
| `from`       | no       | `to - 300*res`   | Start of range (unix seconds) |
| `countback`  | no       | —                | Number of bars to fetch backwards from `to`. Overrides `from` when present. |

**Supported resolutions:**

| Value | Bar width |
|---|---|
| `1`   | 1 minute  |
| `3`   | 3 minutes |
| `5`   | 5 minutes |
| `15`  | 15 minutes|
| `30`  | 30 minutes|
| `60`  | 1 hour    |
| `120` | 2 hours   |
| `240` | 4 hours   |
| `360` | 6 hours   |
| `720` | 12 hours  |
| `D` / `1D` | 1 day |
| `W` / `1W` | 1 week |

### Response

```jsonc
// Bars found:
{
  "bars": [
    {
      "time":   1704067200,    // unix seconds (bucket start)
      "open":   4.12e-9,       // BNB per token
      "high":   4.35e-9,
      "low":    4.08e-9,
      "close":  4.29e-9,
      "volume": 2.35           // BNB traded in this bucket
    }
    // ...
  ],
  "migrated": false
}

// No data in range (bonding-curve token with data elsewhere):
{
  "bars": [],
  "migrated": false,
  "nextTime": 1703980800      // earliest available snapshot — seek here
}

// No data — token has migrated to PancakeSwap:
{
  "bars": [],
  "migrated": true
}
```

**HTTP 404** is returned when the token address does not exist in the index.

### Price Units

Prices (`open`, `high`, `low`, `close`) are in **BNB per token**, derived from the
bonding-curve AMM formula evaluated at each block snapshot:

```
virtualLiquidity = baseVirtualBNB + raisedBNB
price (BNB/token) = virtualLiquidity² / (baseVirtualBNB × totalSupply)
```

`baseVirtualBNB` (`virtualBNB` in the schema) is the constant initial BNB reserve
set at token creation. `raisedBNB` grows with every buy and shrinks with every sell.
Their sum is the **virtual liquidity** — the effective BNB depth of the curve at
any moment.

All raw values are stored in wei; the squaring and division cancel the units to
produce BNB/token directly (typically in the range `1e-12` to `1e-6` early in a
token's life).

Volume is in **BNB** (not wei).

---

## Wiring Up Lightweight Charts

### Initial Load

```ts
import { createChart, CandlestickSeries } from "lightweight-charts";

const chart  = createChart(containerEl, { width: 800, height: 400 });
const series = chart.addSeries(CandlestickSeries);

const BASE = "https://api.1coin.meme/api/v1/bsc";

async function loadBars(token: string, resolution = "60", countback = 300) {
  const to  = Math.floor(Date.now() / 1000);
  const url = `${BASE}/charts/history?symbol=${token}&resolution=${resolution}&to=${to}&countback=${countback}`;

  const { bars, migrated, nextTime } = await fetch(url).then(r => r.json());

  if (bars.length === 0 && nextTime) {
    // No data in default range — re-fetch anchored at the first available bar
    return loadBarsFrom(token, resolution, nextTime);
  }

  series.setData(bars);
  return { migrated };
}

async function loadBarsFrom(token: string, resolution: string, from: number) {
  const to  = Math.floor(Date.now() / 1000);
  const url = `${BASE}/charts/history?symbol=${token}&resolution=${resolution}&from=${from}&to=${to}`;
  const { bars, migrated } = await fetch(url).then(r => r.json());
  series.setData(bars);
  return { migrated };
}
```

### Real-Time Updates (Polling)

Lightweight Charts has no built-in polling. Poll the history endpoint on an
interval to push new/updated bars:

```ts
let lastBarTime = 0;

function startPolling(token: string, resolution = "60", intervalMs = 5_000) {
  return setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);
    // Fetch just the last two buckets — enough to update the forming bar
    const url = `${BASE}/charts/history?symbol=${token}&resolution=${resolution}&countback=2&to=${now}`;
    const { bars } = await fetch(url).then(r => r.json());

    for (const bar of bars) {
      if (bar.time >= lastBarTime) {
        series.update(bar);   // creates or replaces the bar
        lastBarTime = bar.time;
      }
    }
  }, intervalMs);
}

// Start after initial load:
const poll = startPolling(tokenAddress, "60");

// Stop on unmount:
clearInterval(poll);
```

### Price Formatting

Prices are tiny floats (e.g. `4.12e-9`). Configure Lightweight Charts to display
them properly:

```ts
series.applyOptions({
  priceFormat: {
    type:      "price",
    precision: 12,
    minMove:   1e-12,
  },
});
```

### Migrated Tokens

When `migrated: true` the bonding-curve chart has no more data. Show a notice and
optionally link to the PancakeSwap pair:

```ts
const { migrated } = await loadBars(tokenAddress);
if (migrated) {
  showMigratedBanner("This token has graduated to PancakeSwap.");
}
```

---

## UDF Endpoints (Advanced Charts / Future Use)

These endpoints implement the TradingView UDF protocol. They are **not called by
Lightweight Charts** but are available if the project later embeds the full
TradingView Advanced Charts widget.

| Endpoint | Description |
|---|---|
| `GET /charts/config`  | Datafeed capabilities |
| `GET /charts/time`    | Current server timestamp |
| `GET /charts/symbols?symbol=<addr>` | Symbol metadata |
| `GET /charts/search?query=<prefix>` | Token address prefix search |

To use the Advanced Charts widget, point its datafeed URL to:
```
https://api.1coin.meme/api/v1/bsc/charts
```

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Treating `open`/`close` as wei | Values are already in BNB/token — display directly |
| Treating `volume` as token count | `volume` is BNB traded in the bucket |
| Passing `resolution=1h` | Use numeric strings (`60`) or `D`/`W` — not `1h` |
| Ignoring `nextTime` on empty response | Seek to `nextTime` before telling the user "no chart data" |
| Calling `/config` or `/symbols` from Lightweight Charts code | Not needed — only the Advanced Charts widget uses those |
