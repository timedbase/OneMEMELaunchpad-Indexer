# Docker Deployment Guide

Single-container production setup running **Ponder** (indexer) + **NestJS** (API) under PM2.

---

## Prerequisites

- Docker + Docker Compose installed on your VPS
- Neon PostgreSQL database provisioned (see [NEON.md](NEON.md))
- Cloudflare configured for TLS (see [CLOUDFLARE.md](CLOUDFLARE.md))
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
BSC_WSS_URL=wss://...
BSC_RPC_URL=https://...
FACTORY_ADDRESS=0x...
START_BLOCK=...
DATABASE_URL=postgresql://...          # Neon connection string
API_PORT=3001
ALLOWED_ORIGINS=https://1coin.meme,https://www.1coin.meme
NODE_ENV=production
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

Docker will rebuild the image and restart the container. The `ponder_data` volume is preserved — Ponder resumes from its last checkpoint, no re-index needed.

> **Schema changes** (e.g. adding a column to `ponder.schema.ts`) require a full re-index. Ponder detects schema changes automatically and re-syncs from `START_BLOCK`. Plan for downtime during sync.

---

## 5. Viewing logs

```bash
# All logs
docker logs onememe-launchpad -f

# Last 100 lines
docker logs onememe-launchpad --tail 100

# Ponder logs only (filter by prefix)
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

Only do this if you need to re-index from scratch (e.g. `START_BLOCK` changed).

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm onememelaunchpad-indexer_ponder_data
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Architecture

```
Hetzner VPS
└── Docker container (onememe-launchpad)
    ├── PM2
    │   ├── ponder   → reads BSC via WSS/RPC → writes to Neon DB
    │   └── api      → reads Neon DB → serves :3001
    └── Volume: ponder_data → /app/.ponder  (checkpoints, cache)

Cloudflare → VPS:3001 (TLS terminated at Cloudflare)
Neon       → external PostgreSQL
```

---

## Recommended VPS specs (Hetzner)

| Load | Instance | Cost |
|---|---|---|
| Testing / staging | CX22 (2 vCPU, 4GB) | ~$6/mo |
| Production | CX32 (4 vCPU, 8GB) | ~$14/mo |
| High volume | CX42 (8 vCPU, 16GB) | ~$28/mo |
