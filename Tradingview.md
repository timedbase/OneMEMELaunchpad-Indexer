# TradingView Integration Guide

This document covers how to use the OneMEME chart API with both
**TradingView Lightweight Charts** (self-hosted library) and
**TradingView Advanced Charts** (full widget / iframe embed).

---

## Overview

| | Lightweight Charts | Advanced Charts |
|---|---|---|
| Package | `lightweight-charts` npm | `charting_library` (TradingView repo) |
| Protocol | Fetch data yourself, call `series.setData()` | UDF (Universal Data Feed) — widget polls automatically |
| Endpoint used | `GET /charts/history` | `GET /charts/config`, `/symbols`, `/history`, `/search`, `/time` |
| Polling | Manual (you implement) | Automatic (widget handles it) |

---

## Base URL

```
https://api.1coin.meme/api/v1/bsc/charts
```

Replace `bsc` with your `CHAIN_SLUG` value if running a different chain.

---

## Chart History Endpoint

All chart data goes through a single endpoint:

```
GET /api/v1/{chain}/charts/history
```

### Query Parameters

| Parameter    | Required | Default          | Description |
|---|---|---|---|
| `symbol`     | yes      | —                | Token contract address (`0x…`) |
| `resolution` | no       | `60`             | Bar width — see table below |
| `to`         | no       | now              | End of range (unix seconds) |
| `from`       | no       | `to − 300×res`   | Start of range (unix seconds) |
| `countback`  | no       | —                | Number of bars to return backwards from `to`. Overrides `from` when present. |

### Supported Resolutions

| Value | Bar width |
|---|---|
| `1`        | 1 minute   |
| `3`        | 3 minutes  |
| `5`        | 5 minutes  |
| `15`       | 15 minutes |
| `30`       | 30 minutes |
| `60`       | 1 hour     |
| `120`      | 2 hours    |
| `240`      | 4 hours    |
| `360`      | 6 hours    |
| `720`      | 12 hours   |
| `D` / `1D` | 1 day      |
| `W` / `1W` | 1 week     |

### Response

```jsonc
// Bars found:
{
  "bars": [
    {
      "time":   1704067200,   // unix seconds (bucket start)
      "open":   4.12e-9,      // BNB per token
      "high":   4.35e-9,
      "low":    4.08e-9,
      "close":  4.29e-9,
      "volume": 2.35          // BNB traded in this bucket
    }
    // ...
  ],
  "migrated": false
}

// No data in range (token still on bonding curve, data exists elsewhere):
{
  "bars":     [],
  "migrated": false,
  "nextTime": 1703980800    // seek here — earliest available snapshot
}

// Token has migrated to PancakeSwap (no more bonding-curve data):
{
  "bars":     [],
  "migrated": true
}
```

**HTTP 404** — token address not found in the index.

### Price Units

Prices (`open`, `high`, `low`, `close`) are in **BNB per token**, derived from
the bonding-curve AMM formula evaluated at each block snapshot:

```
virtualLiquidity  = baseVirtualBNB + raisedBNB
price (BNB/token) = virtualLiquidity² / (baseVirtualBNB × totalSupply)
```

`baseVirtualBNB` is the constant initial BNB reserve set at token creation.
`raisedBNB` grows with every buy and shrinks with every sell. All raw values
are stored in wei; the squaring and division cancel the units to produce
BNB/token directly (typically `1e-12` to `1e-6` early in a token's life).

`volume` is in **BNB** (not wei, not token count).

---

## Part 1 — Lightweight Charts

### Install

```bash
npm install lightweight-charts
```

### Initial Load

```ts
import { createChart, CandlestickSeries } from "lightweight-charts";

const BASE   = "https://api.1coin.meme/api/v1/bsc";
const chart  = createChart(containerEl, { width: 800, height: 400 });
const series = chart.addSeries(CandlestickSeries);

// Format tiny BNB prices correctly
series.applyOptions({
  priceFormat: {
    type:      "price",
    precision: 12,
    minMove:   1e-12,
  },
});

async function loadBars(token: string, resolution = "60", countback = 300) {
  const to  = Math.floor(Date.now() / 1000);
  const res = await fetch(
    `${BASE}/charts/history?symbol=${token}&resolution=${resolution}&to=${to}&countback=${countback}`
  ).then(r => r.json());

  if (res.bars.length === 0 && res.nextTime) {
    // No data in default range — re-fetch anchored at the first available bar
    return loadBarsFrom(token, resolution, res.nextTime);
  }

  series.setData(res.bars);
  return { migrated: res.migrated };
}

async function loadBarsFrom(token: string, resolution: string, from: number) {
  const to  = Math.floor(Date.now() / 1000);
  const res = await fetch(
    `${BASE}/charts/history?symbol=${token}&resolution=${resolution}&from=${from}&to=${to}`
  ).then(r => r.json());

  series.setData(res.bars);
  return { migrated: res.migrated };
}
```

### Real-Time Updates (Polling)

Lightweight Charts has no built-in polling. Fetch the last two buckets on an
interval and call `series.update()`:

```ts
let lastBarTime = 0;

function startPolling(token: string, resolution = "60", intervalMs = 5_000) {
  return setInterval(async () => {
    const to  = Math.floor(Date.now() / 1000);
    const res = await fetch(
      `${BASE}/charts/history?symbol=${token}&resolution=${resolution}&countback=2&to=${to}`
    ).then(r => r.json());

    for (const bar of res.bars) {
      if (bar.time >= lastBarTime) {
        series.update(bar);    // creates or replaces the bar
        lastBarTime = bar.time;
      }
    }
  }, intervalMs);
}

// After initial load:
const { migrated } = await loadBars(tokenAddress);
const poll = startPolling(tokenAddress, "60");

// On unmount:
clearInterval(poll);
```

### Handling Migrated Tokens

```ts
const { migrated } = await loadBars(tokenAddress);
if (migrated) {
  showBanner("This token has graduated to PancakeSwap — bonding-curve chart is final.");
}
```

### Complete Example

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
</head>
<body>
  <div id="chart" style="width:100%;height:400px"></div>
  <script>
    const BASE  = "https://api.1coin.meme/api/v1/bsc";
    const TOKEN = "0xyour_token_address";

    const chart  = LightweightCharts.createChart(document.getElementById("chart"));
    const series = chart.addCandlestickSeries({
      priceFormat: { type: "price", precision: 12, minMove: 1e-12 },
    });

    async function init() {
      const to  = Math.floor(Date.now() / 1000);
      let data  = await fetch(`${BASE}/charts/history?symbol=${TOKEN}&resolution=60&to=${to}&countback=300`).then(r => r.json());

      if (data.bars.length === 0 && data.nextTime) {
        data = await fetch(`${BASE}/charts/history?symbol=${TOKEN}&resolution=60&from=${data.nextTime}&to=${to}`).then(r => r.json());
      }

      series.setData(data.bars);
    }

    init();
  </script>
</body>
</html>
```

---

## Part 2 — Advanced Charts (TradingView Charting Library)

The Advanced Charts widget uses the **UDF (Universal Data Feed)** protocol. The
API implements all required UDF endpoints — point the widget's datafeed URL at:

```
https://api.1coin.meme/api/v1/bsc/charts
```

### UDF Endpoints

| Endpoint | Description |
|---|---|
| `GET /charts/config`                    | Datafeed capabilities |
| `GET /charts/time`                      | Current server unix timestamp |
| `GET /charts/symbols?symbol=<addr>`     | Symbol metadata |
| `GET /charts/search?query=<prefix>&limit=10` | Token address prefix search |
| `GET /charts/history?symbol=…&resolution=…&from=…&to=…` | OHLCV bars (same as Lightweight Charts) |

#### `GET /charts/config` response

```json
{
  "supported_resolutions":      ["1", "5", "15", "30", "60", "240", "D"],
  "supports_group_request":     false,
  "supports_marks":             false,
  "supports_search":            true,
  "supports_timescale_marks":   false
}
```

#### `GET /charts/symbols?symbol=0x…` response

```json
{
  "name":                   "Pepe Coin",
  "ticker":                 "PEPE",
  "description":            "Pepe Coin (PEPE) — OneMEME Standard",
  "type":                   "crypto",
  "session":                "24x7",
  "timezone":               "Etc/UTC",
  "exchange":               "OneMEME",
  "listed_exchange":        "OneMEME",
  "format":                 "price",
  "pricescale":             1000000000,
  "minmov":                 1,
  "has_intraday":           true,
  "has_daily":              true,
  "has_weekly_and_monthly": false,
  "supported_resolutions":  ["1", "5", "15", "30", "60", "240", "D"],
  "volume_precision":       4,
  "data_status":            "streaming"
}
```

#### `GET /charts/search?query=0xabc&limit=10` response

```json
[
  {
    "symbol":      "PEPE",
    "full_name":   "Pepe Coin (PEPE)",
    "description": "Pepe Coin — OneMEME Standard",
    "exchange":    "OneMEME",
    "ticker":      "PEPE",
    "type":        "crypto"
  }
]
```

### Widget Setup

Obtain the `charting_library` bundle from
[TradingView's GitHub](https://github.com/tradingview/charting_library) and copy
it to your project. Then initialise the widget:

```html
<!DOCTYPE html>
<html>
<head>
  <script src="charting_library/charting_library.standalone.js"></script>
</head>
<body>
  <div id="tv_chart"></div>
  <script>
    const widget = new TradingView.widget({
      container:         "tv_chart",
      width:             "100%",
      height:            600,
      symbol:            "0xyour_token_address",
      interval:          "60",
      datafeed: new Datafeeds.UDFCompatibleDatafeed(
        "https://api.1coin.meme/api/v1/bsc/charts"
      ),
      library_path:      "/charting_library/",
      locale:            "en",
      theme:             "dark",
      timezone:          "Etc/UTC",
      autosize:          true,
      // Price is in BNB/token — 12 decimal places
      overrides: {
        "mainSeriesProperties.priceAxisProperties.autoScale": true,
      },
    });
  </script>
</body>
</html>
```

### UDFCompatibleDatafeed (npm)

If you use a bundler you can install the official UDF wrapper instead of the
standalone script:

```bash
npm install @tradingview/udf-compatible-datafeed
```

```ts
import { UDFCompatibleDatafeed } from "@tradingview/udf-compatible-datafeed";

const widget = new TradingView.widget({
  // ...
  datafeed: new UDFCompatibleDatafeed(
    "https://api.1coin.meme/api/v1/bsc/charts",
    5_000  // polling interval in ms (default 10 000)
  ),
});
```

The widget handles `/config`, `/symbols`, `/search`, and periodic `/history`
polls automatically — no additional code needed.

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Treating `open`/`close` as wei | Values are already in BNB/token — display directly |
| Treating `volume` as token count | `volume` is BNB traded in the bucket |
| Passing `resolution=1h` | Use numeric strings (`60`) or `D`/`W` — not `1h` |
| Ignoring `nextTime` on empty response | Seek to `nextTime` before showing "no chart data" |
| Calling `/config` or `/symbols` from Lightweight Charts code | Not needed — only the Advanced Charts widget uses those |
| Setting `pricescale` too low in Advanced Charts | Use `1000000000` (1e9) — prices are in the `1e-9` range |
