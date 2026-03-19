# Neon PostgreSQL Setup

Neon is a serverless PostgreSQL provider. This guide covers creating a database and connecting it to the indexer and API.

---

## Step 1 — Create a Project

1. Go to [console.neon.tech](https://console.neon.tech) and sign up
2. Click **New Project**
3. Fill in:
   - **Name**: `onememe-launchpad`
   - **PostgreSQL version**: `16` (latest)
   - **Region**: pick the one closest to your server (e.g. `AWS eu-west-1` for Europe, `AWS us-east-1` for US)
4. Click **Create Project**

Neon creates a default database named `neondb` and a role named after your project.

---

## Step 2 — Get the Connection String

1. In your project dashboard go to **Connection Details**
2. Select **Connection string** from the dropdown
3. Make sure **Pooled connection** is **OFF** — Ponder requires a direct connection for schema migrations

Copy the string — it looks like:

```
postgresql://alex:AbCdEfG@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

---

## Step 3 — Configure Your Environment

Paste the connection string into your `.env`:

```dotenv
DATABASE_URL=postgresql://alex:AbCdEfG@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

No other changes needed — Ponder and postgres.js both handle `sslmode=require` automatically.

> **Direct connection only for Ponder.** Do not use the pooled connection string for `DATABASE_URL` — Ponder requires a direct connection to run schema migrations. Use the pooled endpoint only for the API if you scale to multiple API instances.

---

## Step 4 — Create a Production Branch (recommended)

Neon's branching lets you test schema changes without touching production data.

1. In the dashboard go to **Branches** → **New Branch**
2. Name it `production`
3. Copy its connection string and use that as your `DATABASE_URL` in production
4. Keep the default `main` branch for local development and testing

When you want to test a schema migration:
1. Create a branch from `production` (instant, no data copy needed)
2. Run the indexer against the branch
3. Verify everything looks correct
4. Promote or apply to `production`

---

## Step 5 — Verify the Connection

```bash
psql "postgresql://alex:AbCdEfG@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?sslmode=require" \
  -c "SELECT version();"
```

You should see the PostgreSQL version printed. If `psql` is not installed:

```bash
npm install -g pg  # or use the Neon SQL editor in the dashboard
```

---

## Step 6 — Start the Indexer

```bash
npm run start   # Ponder indexer — creates all tables automatically
npm run api     # NestJS REST API
```

Ponder creates its tables on first run. The `chat_message` table is created by the API on startup. Nothing needs to be run manually.

---

## Neon-Specific Tips

**Connection pooling**
Neon provides a pooled endpoint (PgBouncer) for high-concurrency workloads. The API's postgres.js pool (`max: 10`) works fine on the direct connection. If you scale the API to multiple instances, switch to the pooled endpoint for the API but keep the direct connection for Ponder.

To use the pooled endpoint for the API only, add a second env var:
```dotenv
DATABASE_URL=postgresql://...direct...    # Ponder (direct)
API_DATABASE_URL=postgresql://...pooled... # API (pooled, higher concurrency)
```
Then update `src/api/db.ts` to read `API_DATABASE_URL ?? DATABASE_URL`.

**Autosuspend**
Neon suspends your compute after 5 minutes of inactivity on the free tier. This causes a ~500ms cold start on the next query. For a live production indexer, disable autosuspend:

1. Go to **Settings → Compute**
2. Set **Suspend compute after** → **Never** (requires a paid plan)

**Storage**
Neon bills on storage. The indexer is write-heavy during initial sync but settles after. The chat table is capped at 200 messages per token, so it won't grow unboundedly. Monitor storage in the dashboard under **Branches → Storage**.

**Monitoring**
Use the **Monitoring** tab in the Neon dashboard to view:
- Active connections
- Query volume
- Storage growth

---

## Summary

| What | Where |
|---|---|
| Dashboard | [console.neon.tech](https://console.neon.tech) |
| Connection type | Direct (not pooled) for Ponder |
| SSL | `sslmode=require` in connection string |
| Branching | Use `production` branch for live data |
| Autosuspend | Disable on paid plan for always-on indexing |
| Tables | Created automatically by Ponder and the API on first start |
