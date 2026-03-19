# Deployment Guide

Complete production deployment guide for the OneMEME Launchpad Indexer on a Ubuntu VPS using Neon PostgreSQL, Cloudflare TLS, Vercel domain, and BetterStack monitoring.

---

## Stack Overview

```
Vercel Domain (e.g. api.1coin.meme)
        ↓
Cloudflare (TLS, WAF, DDoS protection)
        ↓
VPS — Ubuntu server
  ├── Ponder   (indexer, port 42069 — internal only)
  └── NestJS   (API, port 3001)
        ↓
Neon PostgreSQL (external DB)
        ↓
BetterStack (logs + uptime monitoring)
```

---

## Step 1 — Server Setup

SSH in as root and harden the server.

```bash
ssh root@YOUR_VPS_IP

# Update system
apt update && apt upgrade -y

# Install essentials
apt install -y curl git ufw fail2ban

# Create a non-root user
adduser deploy
usermod -aG sudo deploy

# Copy SSH key to new user
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# Switch to deploy user for all remaining steps
su - deploy
```

---

## Step 2 — Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 3001    # NestJS API — Cloudflare proxies this
sudo ufw enable
sudo ufw status
```

> Port 42069 (Ponder) stays closed — internal only, never exposed publicly.

---

## Step 3 — Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
newgrp docker

# Verify
docker --version
docker compose version
```

---

## Step 4 — Neon PostgreSQL

1. Go to [neon.tech](https://neon.tech) → create account → **New Project**
2. Name it `onememe-indexer`, pick the region closest to your VPS
3. Go to **Dashboard → Connection Details**
4. Copy the connection string:

```
postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require
```

Save this as your `DATABASE_URL` for the next step.

> You do **not** need Neon Auth — only the plain PostgreSQL connection string.

---

## Step 5 — Clone & Configure

```bash
cd ~
git clone https://github.com/YOUR_ORG/OneMEMELaunchpad-Indexer.git
cd OneMEMELaunchpad-Indexer

cp .env.example .env
nano .env
```

Fill in every value:

```env
# Database
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require

# BSC RPC — use two providers for high availability
BSC_WSS_URL=wss://your-primary-rpc
BSC_WSS_URL_2=wss://your-secondary-rpc
BSC_RPC_URL=https://your-primary-rpc
BSC_RPC_URL_2=https://your-secondary-rpc

# Contracts
FACTORY_ADDRESS=0x...
BONDING_CURVE_ADDRESS=0x...
START_BLOCK=...

# API
API_PORT=3001
ALLOWED_ORIGINS=https://api.1coin.meme,https://1coin.meme,https://www.1coin.meme

# Pinata (IPFS uploads)
PINATA_JWT=...

# BetterStack (logs)
BETTERSTACK_TOKEN=...
```

---

## Step 6 — Build & Run

```bash
docker compose -f docker-compose.prod.yml up -d --build

# Watch startup logs
docker compose -f docker-compose.prod.yml logs -f

# Check both processes are running
docker compose -f docker-compose.prod.yml ps

# Verify API responds locally
curl http://localhost:3001/health
```

---

## Step 7 — Vercel Domain → Cloudflare → VPS

### 7.1 Add domain to Cloudflare

1. Go to [cloudflare.com](https://cloudflare.com) → **Add a Site** → enter your domain
2. Cloudflare provides two nameservers, e.g.:
   ```
   ada.ns.cloudflare.com
   bob.ns.cloudflare.com
   ```

### 7.2 Point Vercel domain to Cloudflare

1. Go to **Vercel → Domains → your domain → Nameservers**
2. Replace the existing nameservers with the two Cloudflare ones
3. Wait 5–30 minutes for propagation

### 7.3 Add DNS A record in Cloudflare

Go to **Cloudflare → your domain → DNS → Add record**:

| Field | Value |
|---|---|
| Type | A |
| Name | api |
| Content | YOUR_VPS_IP |
| Proxy | ON (orange cloud) |
| TTL | Auto |

This routes `api.1coin.meme` through Cloudflare to your VPS.

### 7.4 SSL/TLS

**Cloudflare → SSL/TLS → Full** mode.

> Do **not** use Full (Strict) — your VPS runs plain HTTP. Cloudflare handles TLS externally.

### 7.5 WebSockets

**Cloudflare → Network → WebSockets → ON**

Required for the chat WebSocket and SSE activity feed.

### 7.6 Cache bypass for API routes

**Cloudflare → Rules → Cache Rules → Create rule:**

```
If:   URI path starts with /api
Then: Cache — Bypass
```

### 7.7 WAF rate limiting

**Cloudflare → Security → WAF → Rate Limiting Rules → Create rule:**

```
Name:   API Rate Limit
If:     URI path starts with /api
Rate:   100 requests per 10 seconds per IP
Action: Block
```

---

## Step 8 — BetterStack

### 8.1 Connect logs

1. Go to [betterstack.com](https://betterstack.com) → **Logs → New source**
2. Select **Docker** → copy the source token
3. Add to your `.env`:
   ```env
   BETTERSTACK_TOKEN=your_token
   ```
4. Rebuild:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

### 8.2 Uptime monitor

**BetterStack → Uptime → New monitor:**

| Field | Value |
|---|---|
| URL | `https://api.1coin.meme/health` |
| Check frequency | 1 minute |
| Alert after | 2 failures |
| Alert via | Email / Telegram |

### 8.3 Status page

**BetterStack → Status Pages → New status page:**

| Field | Value |
|---|---|
| Subdomain | `status.1coin.meme` (or use BetterStack's free subdomain) |
| Monitors | Add `api.1coin.meme/health` |

---

## Step 9 — Verify Everything

```bash
# API health
curl https://api.1coin.meme/health

# Token list
curl https://api.1coin.meme/api/v1/tokens

# BNB price
curl https://api.1coin.meme/api/v1/price/bnb

# Confirm indexer is syncing blocks
docker compose -f docker-compose.prod.yml logs ponder -f
```

---

## Step 10 — Updating

When you release a new version:

```bash
cd ~/OneMEMELaunchpad-Indexer
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Ponder resumes from its last checkpoint — no full re-index needed unless the schema changed.

---

## Quick Reference

| Service | URL |
|---|---|
| API | `https://api.1coin.meme` |
| Health | `https://api.1coin.meme/health` |
| Status page | `https://status.1coin.meme` |
| Neon dashboard | `https://console.neon.tech` |
| Cloudflare dashboard | `https://dash.cloudflare.com` |
| BetterStack dashboard | `https://betterstack.com` |
