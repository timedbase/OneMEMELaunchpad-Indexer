# Cloudflare TLS Setup — api.1coin.meme

Cloudflare acts as a reverse proxy: it terminates TLS and forwards plain HTTP to your NestJS server. No certificates needed on the server.

```
Client (HTTPS / WSS)  →  Cloudflare (TLS terminated)  →  Your server :3001 (plain HTTP)
```

---

## Step 0 — Add Your Domain to Cloudflare

Skip this step if your domain is already on Cloudflare.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Add a Site** → enter your domain → choose **Free**
2. Cloudflare assigns two nameservers (e.g. `aria.ns.cloudflare.com`, `bob.ns.cloudflare.com`)
3. Log in to your domain registrar and replace the existing nameservers with the two Cloudflare ones

| Registrar | Where to change nameservers |
|---|---|
| Vercel | Dashboard → Domains → click domain → Nameservers |
| Namecheap | Domain List → Manage → Nameservers → Custom DNS |
| GoDaddy | My Domains → Manage → DNS → Nameservers → Change |
| Others | Find "Nameservers" or "DNS settings" in your registrar's control panel |

4. Wait for propagation (usually under 1 hour), then confirm in Cloudflare

> **Vercel frontend note:** After switching nameservers, add these records in Cloudflare so your frontend stays live:
>
> | Type | Name | Target | Proxy |
> |---|---|---|---|
> | `CNAME` | `www` | `cname.vercel-dns.com` | DNS only (grey cloud) |
> | `A` | `@` | `76.76.21.21` | DNS only (grey cloud) |
>
> Then re-add your domain in Vercel → Domains so it re-issues its certificate.

---

## Step 1 — Add the DNS Record

In Cloudflare: **DNS → Records → Add record**

| Field | Value |
|---|---|
| Type | `A` |
| Name | `api` |
| IPv4 address | Your server's public IP |
| Proxy status | **Proxied** (orange cloud ✓) |
| TTL | Auto |

The orange cloud is required — it routes traffic through Cloudflare for TLS termination.

---

## Step 2 — Set SSL/TLS Mode

**SSL/TLS → Overview** → set encryption mode to **Full**

| Mode | Meaning |
|---|---|
| Flexible | Cloudflare → server is plain HTTP. Not recommended. |
| **Full** | Cloudflare → server may use any certificate. Use this. |
| Full (Strict) | Cloudflare → server must have a valid CA cert. |

---

## Step 3 — Enable WebSockets

**Network** → **WebSockets** → **On**

Required for `GET /api/v1/activity/ws`.

---

## Step 4 — Bypass Cache for API Routes

**Rules → Cache Rules → Create rule**

- **Rule name**: `Bypass cache for API`
- **When**: URI Path starts with `/api`
- **Cache status**: `Bypass`

Click **Deploy**.

---

## Step 5 — Firewall Port 3001

Block direct access to port 3001 from the public internet. Only allow Cloudflare IP ranges.

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

## Step 6 — Verify

```bash
# Health check
curl https://api.1coin.meme/health
# {"status":"ok","service":"onememe-launchpad-api","timestamp":...}

# Confirm Cloudflare certificate
curl -vI https://api.1coin.meme/health 2>&1 | grep -i issuer
# issuer: Cloudflare Inc ECC CA-3
```

```js
// WebSocket — paste in browser console
const ws = new WebSocket("wss://api.1coin.meme/api/v1/activity/ws");
ws.onopen  = () => console.log("connected");
ws.onclose = (e) => console.log("closed", e.code);
```

---

## Summary

| What | Where |
|---|---|
| TLS certificate | Cloudflare (automatic, auto-renewed) |
| SSL/TLS mode | Full |
| WebSockets | Enabled in Cloudflare Network settings |
| API caching | Bypassed via Cache Rule |
| Server port | `3001` (plain HTTP, firewalled to Cloudflare IPs only) |
