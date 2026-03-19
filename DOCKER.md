# Docker Deployment Guide

Single-container production setup running **Ponder** (indexer) + **NestJS** (API) under PM2.

---

## Prerequisites

- Docker + Docker Compose installed on your VPS
- Neon PostgreSQL database provisioned (see [NEON.md](NEON.md))
- Cloudflare configured for TLS and security (see [CLOUDFLARE.md](CLOUDFLARE.md))
- `.env` file ready with all required variables (see `.env.example`)

---

## 1. First-time setup on the VPS

```bash
# Clone the repo
git clone https://github.com/timedbase/OneMEMELaunchpad-Indexer.git
cd OneMEMELaunchpad-Indexer

# Copy and fill in your env vars
cp .env.example .env
nano .env
```

Required variables in `.env`:

```dotenv
# BSC RPC — primary + optional secondary for high availability
BSC_WSS_URL=wss://...
BSC_WSS_URL_2=wss://...          # optional — different provider for redundancy
BSC_RPC_URL=https://...
BSC_RPC_URL_2=https://...        # optional — different provider for redundancy

# Contracts
FACTORY_ADDRESS=0x...
BONDING_CURVE_ADDRESS=0x...
START_BLOCK=...

# Database (Neon direct connection string)
DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require

# API
API_PORT=3001
ALLOWED_ORIGINS=https://1coin.meme,https://www.1coin.meme,https://onememe.folkshq.xyz
NODE_ENV=production

# IPFS (for metadata upload)
PINATA_JWT=...

# Monitoring (optional)
BETTERSTACK_TOKEN=
```

---

## 2. Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This will:
1. Build the image (installs deps, compiles NestJS)
2. Start the container with PM2 managing both processes
3. Mount a named volume for Ponder's checkpoint files

---

## 3. Check it's running

```bash
# Container status
docker compose -f docker-compose.prod.yml ps

# Live logs (both Ponder + API)
docker compose -f docker-compose.prod.yml logs -f

# Health check
curl http://localhost:3001/health
```

---

## 4. Deploying updates

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Docker rebuilds the image and restarts the container. The `ponder_data` volume is preserved — Ponder resumes from its last checkpoint, no re-index needed.

> **Schema changes** (e.g. adding a column to `ponder.schema.ts`) require a full re-index. Ponder detects schema changes automatically and re-syncs from `START_BLOCK`. Plan for downtime during sync.

---

## 5. Viewing logs

```bash
# All logs
docker logs onememe-launchpad -f

# Last 100 lines
docker logs onememe-launchpad --tail 100

# Ponder logs only
docker logs onememe-launchpad -f 2>&1 | grep ponder

# API logs only
docker logs onememe-launchpad -f 2>&1 | grep api
```

---

## 6. Restarting processes

```bash
# Restart the whole container
docker compose -f docker-compose.prod.yml restart

# Restart just one process inside the container (via PM2)
docker exec onememe-launchpad pm2 restart ponder
docker exec onememe-launchpad pm2 restart api

# Check PM2 process status
docker exec onememe-launchpad pm2 status
```

---

## 7. Wiping Ponder state (force full re-index)

Only do this if you need to re-index from scratch (e.g. `START_BLOCK` changed or schema reset).

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm onememelaunchpad-indexer_ponder_data
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Architecture

```
VPS
└── Docker container (onememe-launchpad)
    ├── PM2
    │   ├── ponder  → BSC via WSS1/WSS2/HTTP1/HTTP2
    │   │             → writes to Neon DB (LaunchpadFactory + BondingCurve events)
    │   └── api     → reads Neon DB → serves :3001
    └── Volume: ponder_data → /app/.ponder  (checkpoints, cache)

Cloudflare → VPS:3001 (TLS, WAF, rate limit at edge)
Neon       → external PostgreSQL
BSC        → QuickNode (primary) + Ankr (secondary) — dual WSS + HTTP
```

---

## Recommended VPS specs

| Load | Provider | Plan | Cost |
|---|---|---|---|
| Testing / staging | OVHcloud | VPS Value (2 vCPU, 4GB) | ~€6/mo |
| Production | OVHcloud | VPS Comfort (4 vCPU, 8GB) | ~€12/mo |
| High volume | DigitalOcean | Basic (4 vCPU, 8GB) | ~$48/mo |

> **Region**: pick the datacenter closest to your BSC RPC provider. OVHcloud has Warsaw and Frankfurt — both low-latency to European BSC nodes.
