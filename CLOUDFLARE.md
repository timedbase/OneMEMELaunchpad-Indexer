# Cloudflare Setup — api.1coin.meme

Cloudflare sits between the internet and your server: it terminates TLS, proxies WebSockets, and enforces security rules. Your NestJS server runs plain HTTP on port 3001.

```
Client (HTTPS / WSS)
  → Cloudflare (TLS terminated, WAF, rate limit)
    → Your server :3001 (plain HTTP, firewalled)
```

---

## Step 0 — Add Your Vercel Domain to Cloudflare

Your frontend domain is on Vercel. The API subdomain (`api.1coin.meme`) needs to be routed through Cloudflare while keeping the root and `www` on Vercel.

**1. Add the domain to Cloudflare**

Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Add a Site** → enter `1coin.meme` → choose **Free**.

Cloudflare gives you two nameservers, e.g.:
```
aria.ns.cloudflare.com
bob.ns.cloudflare.com
```

**2. Update nameservers in Vercel**

In Vercel: **Domains** → click `1coin.meme` → **Nameservers** → switch to **Custom** → paste Cloudflare's two nameservers → Save.

> Vercel re-issues its TLS certificate automatically after the nameserver change. Allow 5–30 minutes.

**3. Restore your Vercel frontend records in Cloudflare DNS**

After Cloudflare takes over DNS, add these records so your frontend stays live:

| Type | Name | Target | Proxy |
|---|---|---|---|
| `A` | `@` | `76.76.21.21` | **DNS only** (grey cloud) |
| `CNAME` | `www` | `cname.vercel-dns.com` | **DNS only** (grey cloud) |

> Grey cloud (unproxied) for root and `www` — Vercel handles TLS for your frontend. Only the `api` subdomain goes through Cloudflare.

**4. Verify in Vercel**

In Vercel: **Domains** → `1coin.meme` should show **Valid Configuration**. If it shows a DNS error, re-add the domain in Vercel's project settings so it re-checks.

---

## Step 1 — Add the API DNS Record

In Cloudflare: **DNS → Records → Add record**

| Field | Value |
|---|---|
| Type | `A` |
| Name | `api` |
| IPv4 address | Your server's public IP |
| Proxy status | **Proxied** (orange cloud ✓) |
| TTL | Auto |

The orange cloud is required — it routes `api.1coin.meme` through Cloudflare for TLS and security.

---

## Step 2 — Set SSL/TLS Mode

**SSL/TLS → Overview** → set encryption mode to **Full**

| Mode | Meaning |
|---|---|
| Flexible | Cloudflare → server is plain HTTP. Not secure end-to-end. |
| **Full** | Cloudflare → server may use self-signed cert. Use this. |
| Full (Strict) | Cloudflare → server must have a valid CA cert. Not needed. |

---

## Step 3 — Enable WebSockets

**Network → WebSockets → On**

Required for:
- `wss://api.1coin.meme/api/v1/activity/ws` — real-time activity feed
- `wss://api.1coin.meme/api/v1/chat/ws` — per-token chat

---

## Step 4 — Bypass Cache for API Routes

**Rules → Cache Rules → Create rule**

| Field | Value |
|---|---|
| Rule name | `Bypass cache for API` |
| When | URI Path starts with `/api` |
| Cache status | `Bypass` |

Click **Deploy**. This prevents Cloudflare from caching API responses.

---

## Step 5 — API Security

### 5.1 — WAF Custom Rules (block bad actors)

**Security → WAF → Custom rules → Create rule**

**Rule 1 — Block non-browser requests to origin-restricted endpoints**

This blocks curl/scripts hitting UI-only endpoints without a proper `Origin` header.

| Field | Value |
|---|---|
| Rule name | `Require Origin for API` |
| When | URI Path contains `/api/v1` AND NOT URI Path contains `/health` AND http.request.headers["origin"] eq "" |
| Action | Block |

**Rule 2 — Country block (optional)**

If you want to restrict to specific regions:

| Field | Value |
|---|---|
| Rule name | `Geo restriction` |
| When | ip.geoip.continent not in {"NA" "EU" "AS"} |
| Action | Block |

---

### 5.2 — Rate Limiting at the Edge

**Security → WAF → Rate limiting rules → Create rule**

Add these on top of the in-app rate limits for extra protection:

**Quote endpoints** (RPC-heavy):

| Field | Value |
|---|---|
| Rule name | `Rate limit quote endpoints` |
| When | URI Path contains `/quote/` |
| Requests | 30 per 1 minute per IP |
| Action | Block (with 429) |

**General API**:

| Field | Value |
|---|---|
| Rule name | `Rate limit API` |
| When | URI Path starts with `/api/v1` |
| Requests | 120 per 1 minute per IP |
| Action | Block (with 429) |

> Your NestJS in-app rate limits are the primary defence. Cloudflare edge limits stop traffic before it hits your server at all.

---

### 5.3 — Bot Fight Mode

**Security → Bots → Bot Fight Mode → On**

Blocks known malicious bots automatically. Safe to enable — legitimate browsers and your frontend are not affected.

---

### 5.4 — Security Level

**Security → Settings → Security Level → Medium**

Presents a challenge page to IPs with a poor reputation score before they reach your API.

---

## Step 6 — Firewall Port 3001 on Your Server

Block direct access to port 3001 — only Cloudflare IPs should reach it.

```bash
sudo ufw allow 22

# Cloudflare IPv4 — verify latest at https://www.cloudflare.com/ips/
for ip in \
  103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 \
  104.16.0.0/13  104.24.0.0/14   108.162.192.0/18 \
  131.0.72.0/22  141.101.64.0/18 162.158.0.0/15 \
  172.64.0.0/13  173.245.48.0/20 188.114.96.0/20 \
  190.93.240.0/20 197.234.240.0/22 198.41.128.0/17; do
  sudo ufw allow from $ip to any port 3001
done

# Cloudflare IPv6
for ip in \
  2400:cb00::/32 2606:4700::/32 2803:f800::/32 \
  2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32; do
  sudo ufw allow from $ip to any port 3001
done

sudo ufw enable
sudo ufw status
```

---

## Step 7 — Verify

```bash
# Health check through Cloudflare
curl https://api.1coin.meme/health
# {"status":"ok","service":"onememe-launchpad-api","timestamp":...}

# Confirm Cloudflare is terminating TLS
curl -vI https://api.1coin.meme/health 2>&1 | grep -i issuer
# issuer: Cloudflare Inc ECC CA-3
```

```js
// WebSocket — paste in browser console
const ws = new WebSocket("wss://api.1coin.meme/api/v1/activity/ws");
ws.onopen  = () => console.log("connected");
ws.onclose = (e) => console.log("closed", e.code);

// Chat WebSocket
const chat = new WebSocket("wss://api.1coin.meme/api/v1/chat/ws");
chat.onopen = () => console.log("chat connected");
```

---

## Summary

| What | Detail |
|---|---|
| Frontend DNS | `@` and `www` → Vercel, **DNS only** (grey cloud) |
| API DNS | `api` → your server IP, **Proxied** (orange cloud) |
| TLS | Cloudflare Full mode — automatic, auto-renewed |
| WebSockets | Enabled in Cloudflare Network settings |
| Cache | Bypassed for all `/api` routes |
| WAF | Custom rules block missing Origin + rate limit quote endpoints |
| Bot protection | Bot Fight Mode + Medium security level |
| Server port | `3001` plain HTTP, firewalled to Cloudflare IPs only |
