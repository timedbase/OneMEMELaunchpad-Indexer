# Better Stack Monitoring Setup

Better Stack covers two things for this project:
- **Logs** — structured log ingestion from the Ponder indexer and NestJS API
- **Uptime** — HTTP monitor on `/health` with alerts when the API goes down

---

## Part 1 — Logs

### Step 1 — Create a Source

1. Go to [logs.betterstack.com](https://logs.betterstack.com) and sign up
2. Click **Sources** → **Connect source**
3. Choose **Node.js**
4. Name it `onememe-launchpad`
5. Copy the **Source token** shown — you'll need it in a moment

---

### Step 2 — Install the SDK

```bash
npm install @logtail/node @logtail/winston winston
```

> The NestJS API uses its own logger. We replace it with Winston + Logtail so every `this.logger.log/warn/error` call is shipped to Better Stack automatically.

---

### Step 3 — Create the Logger

Create `src/api/logger.ts`:

```typescript
import { WinstonModule } from "nest-winston";
import { createLogger, transports, format } from "winston";
import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/winston";

const logtail = new Logtail(process.env.BETTERSTACK_TOKEN ?? "");

export const AppLogger = WinstonModule.createLogger(
  createLogger({
    level: "info",
    format: format.combine(
      format.timestamp(),
      format.errors({ stack: true }),
      format.json(),
    ),
    transports: [
      new transports.Console({
        format: format.combine(format.colorize(), format.simple()),
      }),
      new LogtailTransport(logtail),
    ],
  })
);
```

---

### Step 4 — Wire the Logger into NestJS

In `src/api/main.ts`, replace the default logger:

```typescript
import { AppLogger } from "./logger";

const app = await NestFactory.create(AppModule, {
  logger: AppLogger,
});
```

Remove the old `logger: ["log", "warn", "error"]` line.

---

### Step 5 — Add the Token to `.env`

```dotenv
# Better Stack source token (required for log shipping)
BETTERSTACK_TOKEN=your_source_token_here
```

Add this to `.env.example` too (without the value):

```dotenv
BETTERSTACK_TOKEN=
```

---

### Step 6 — Verify Logs Are Flowing

Start the API:

```bash
npm run api:dev
```

Open Better Stack → **Live Tail** — you should see startup logs appear within a few seconds:

```
BNB price aggregator started (refresh every 10s)
Chat table ready
OneMEME Launchpad API listening on port 3001
```

---

### What Gets Logged Automatically

| Event | Level | Example |
|---|---|---|
| API startup | `info` | `Listening on port 3001` |
| BNB exchange failure | `warn` | `Binance fetch failed: timeout` |
| All exchange failure | `warn` | `All exchange fetches failed — serving stale BNB price` |
| DB prune failure | `warn` | `Chat prune failed: ...` |
| Unhandled exceptions | `error` | Stack trace |
| Request errors (4xx/5xx) | `error` | NestJS exception filter |

---

## Part 2 — Uptime Monitoring

### Step 1 — Create a Monitor

1. Go to [uptime.betterstack.com](https://uptime.betterstack.com)
2. Click **Monitors** → **New monitor**
3. Configure:

| Field | Value |
|---|---|
| Monitor type | `HTTPS` |
| URL | `https://api.1coin.meme/health` |
| Check frequency | `1 minute` |
| Regions | Select 2–3 (e.g. US, EU, Asia) |
| Request timeout | `10 seconds` |

4. Click **Create monitor**

---

### Step 2 — Set Up Alerting

1. Go to **On-call** → **New escalation policy**
2. Add yourself (email, SMS, or Telegram)
3. Set escalation: alert immediately, escalate after 5 minutes if unacknowledged

Attach the policy to your monitor:
- Open the monitor → **Alert policy** → select your policy

---

### Step 3 — Set Up a Status Page

A public status page lets your users check if the API is down without contacting you.

#### 3.1 — Create the page

1. Go to [uptime.betterstack.com](https://uptime.betterstack.com)
2. Click **Status pages** in the left sidebar → **New status page**
3. Fill in:

| Field | Value |
|---|---|
| Name | `OneMEME Launchpad` |
| Subdomain | `onememe` (gives you `onememe.betterstack.com` — you'll replace this with your own domain below) |
| Timezone | Your local timezone |

4. Click **Create status page**

---

#### 3.2 — Add your monitor to the page

1. Open the status page you just created
2. Click **Add resource** → **Monitors**
3. Select your `https://api.1coin.meme/health` monitor
4. Set the **Display name** to `OneMEME API`
5. Click **Save**

You can add more monitors later (e.g. separate entries for indexer health, BNB price feed, etc.).

---

#### 3.3 — Customize the page

1. Click **Settings** on the status page
2. Recommended settings:

| Setting | Value |
|---|---|
| Show uptime graph | On |
| Show incident history | On (last 90 days) |
| Allow subscribers | On — users can subscribe to email alerts |
| Branding | Add your logo and brand color |

3. Click **Save**

---

#### 3.4 — Point your own domain to the page

Set up `status.1coin.meme` so users remember the URL.

**In Cloudflare DNS** (DNS → Records → Add record):

| Type | Name | Target | Proxy status |
|---|---|---|---|
| `CNAME` | `status` | `statuspage.betterstack.com` | DNS only (grey cloud) |

> The grey cloud (unproxied) is required — Better Stack handles TLS for the status page itself.

**In Better Stack:**

1. Open the status page → **Settings** → **Custom domain**
2. Enter `status.1coin.meme`
3. Click **Save** — Better Stack will verify the DNS record and issue a certificate automatically (usually under 2 minutes)

Once live, visiting `https://status.1coin.meme` shows your public status page.

---

#### 3.5 — Post incidents manually (optional)

When you deploy a breaking change or expect downtime:

1. Status page → **Incidents** → **New incident**
2. Fill in title (e.g. `Scheduled maintenance — v1.0.2.6 deploy`)
3. Set status: `Investigating` → `Identified` → `Resolved` as you progress
4. Subscribers receive email updates at each status change automatically

---

## Part 3 — Useful Log Queries

Once logs are flowing, use these queries in Better Stack's search:

```
# All warnings and errors
level:warn OR level:error

# BNB price feed failures
"fetch failed"

# Chat activity
"chat_message"

# Slow or failed DB queries
"statement_timeout" OR "connection refused"

# API 500 errors
"500" level:error
```

---

## Summary

| What | Where |
|---|---|
| Log dashboard | [logs.betterstack.com](https://logs.betterstack.com) |
| Uptime dashboard | [uptime.betterstack.com](https://uptime.betterstack.com) |
| Health endpoint monitored | `https://api.1coin.meme/health` |
| Log token env var | `BETTERSTACK_TOKEN` |
| Packages | `@logtail/node` `@logtail/winston` `winston` `nest-winston` |
