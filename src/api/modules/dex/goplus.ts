/**
 * GoPlus Security API client.
 * https://docs.gopluslabs.io/reference/api-reference/token-security-details
 *
 * Authentication (two-step):
 *   1. POST /api/v1/token  — exchange GOPLUS_APP_KEY + GOPLUS_APP_SECRET for a
 *      short-lived access token (sign = SHA1(app_key + time + app_secret)).
 *   2. Subsequent requests carry  Authorization: Bearer <access_token>.
 *
 * Omit both env vars to use the free (unauthenticated, rate-limited) tier.
 */

import { createHash } from "node:crypto";

// ─── Raw API types ────────────────────────────────────────────────────────────

export interface GoPlusRawToken {
  token_name?:                   string;
  token_symbol?:                 string;
  buy_tax?:                      string;
  sell_tax?:                     string;
  is_honeypot?:                  string;
  cannot_buy?:                   string;
  cannot_sell_all?:              string;
  transfer_pausable?:            string;
  is_blacklisted?:               string;
  is_mintable?:                  string;
  is_proxy?:                     string;
  is_open_source?:               string;
  can_take_back_ownership?:      string;
  owner_change_balance?:         string;
  hidden_owner?:                 string;
  selfdestruct?:                 string;
  external_call?:                string;
  gas_abuse?:                    string;
  fake_token?:                   string;
  is_anti_whale?:                string;
  anti_whale_modifiable?:        string;
  trading_cooldown?:             string;
  slippage_modifiable?:          string;
  personal_slippage_modifiable?: string;
  holder_count?:                 string;
  total_supply?:                 string;
  lp_holder_count?:              string;
  lp_total_supply?:              string;
  is_in_dex?:                    string;
  owner_address?:                string;
  creator_address?:              string;
  creator_balance?:              string;
  creator_percent?:              string;
  trust_list?:                   string;
  note?:                         string;
  other_potential_risks?:        string;
  dex?: Array<{
    name:      string;
    liquidity: string;
    pair:      string;
  }>;
  holders?: Array<{
    address:     string;
    tag?:        string;
    is_locked:   number;
    balance:     string;
    percent:     string;
    is_contract: number;
  }>;
  lp_holders?: Array<{
    address:     string;
    tag?:        string;
    is_locked:   number;
    balance:     string;
    percent:     string;
    is_contract: number;
  }>;
}

interface GoPlusResponse {
  code:    number;
  message: string;
  result:  Record<string, GoPlusRawToken>;
}

interface GoPlusTokenResponse {
  code:   number;
  result: { access_token: string };
}

// ─── Access-token cache ───────────────────────────────────────────────────────

// Access tokens are cached for 50 min (conservative — actual GoPlus TTL is ~1 hr).
const TOKEN_TTL = 50 * 60 * 1_000;
let _accessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const appKey    = process.env.GOPLUS_APP_KEY    ?? "";
  const appSecret = process.env.GOPLUS_APP_SECRET ?? "";
  if (!appKey || !appSecret) return null;

  const now = Date.now();
  if (_accessToken && _accessToken.expiresAt > now) return _accessToken.token;

  const time = Math.floor(now / 1_000);
  const sign = createHash("sha1").update(`${appKey}${time}${appSecret}`).digest("hex");

  try {
    const res = await fetch(`${GOPLUS_BASE}/token`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ app_key: appKey, time, sign }),
      signal:  AbortSignal.timeout(3_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as GoPlusTokenResponse;
    if (json.code !== 1) throw new Error(`code ${json.code}`);

    _accessToken = { token: json.result.access_token, expiresAt: now + TOKEN_TTL };
    return _accessToken.token;
  } catch (err) {
    console.warn(`[GoPlus] token fetch failed: ${String(err)}`);
    return null;
  }
}

// ─── Token-data cache + in-flight dedup ──────────────────────────────────────

const _cache    = new Map<string, { data: GoPlusRawToken | null; expiresAt: number }>();
const _inflight = new Map<string, Promise<GoPlusRawToken | null>>();

const CACHE_TTL_HIT  = 12 * 60 * 60 * 1_000; // 12 hr — normal result
const CACHE_TTL_MISS =      60 * 1_000;        //  1 min — error / not found (retry sooner)

const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evicts the cached entry for a specific token so the next call re-fetches from GoPlus.
 * Also cancels any in-flight request so the fresh fetch starts immediately.
 */
export function clearGoPlusCache(chainId: number, address: string): void {
  const key = `${chainId}:${address.toLowerCase()}`;
  _cache.delete(key);
  _inflight.delete(key);
}

/**
 * Fetches raw token security data from GoPlus for one token address.
 * Returns `null` when GoPlus has no record for the token or the request fails.
 *
 * Concurrent calls for the same key share a single HTTP request (in-flight dedup).
 * Results are cached: 12 hr on success, 1 min on failure.
 */
export async function fetchGoPlusTokenSecurity(
  chainId: number,
  address: string,
): Promise<GoPlusRawToken | null> {
  const key = `${chainId}:${address.toLowerCase()}`;
  const now = Date.now();

  const hit = _cache.get(key);
  if (hit && hit.expiresAt > now) return hit.data;

  // Deduplicate concurrent requests for the same token.
  const existing = _inflight.get(key);
  if (existing) return existing;

  const p = _doFetch(chainId, address, key, now);
  _inflight.set(key, p);
  p.finally(() => _inflight.delete(key));
  return p;
}

// ─── Internal fetch ───────────────────────────────────────────────────────────

async function _doFetch(
  chainId: number,
  address: string,
  cacheKey: string,
  now: number,
): Promise<GoPlusRawToken | null> {
  const headers: Record<string, string> = {};
  const token = await getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Address is user-supplied — encode to prevent query-string injection.
  const url = `${GOPLUS_BASE}/token_security/${chainId}?contract_addresses=${encodeURIComponent(address.toLowerCase())}`;

  try {
    const res  = await fetch(url, { headers, signal: AbortSignal.timeout(3_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as GoPlusResponse;
    if (json.code !== 1) throw new Error(`code ${json.code}: ${json.message}`);

    const data = json.result[address.toLowerCase()] ?? null;
    _cache.set(cacheKey, { data, expiresAt: now + CACHE_TTL_HIT });
    return data;
  } catch (err) {
    console.warn(`[GoPlus] fetch failed for ${cacheKey}: ${String(err)}`);
    _cache.set(cacheKey, { data: null, expiresAt: now + CACHE_TTL_MISS });
    return null;
  }
}
