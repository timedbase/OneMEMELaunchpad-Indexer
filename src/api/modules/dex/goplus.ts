/**
 * GoPlus Security API client.
 * https://docs.gopluslabs.io/reference/api-reference/token-security-details
 *
 * Set GOPLUS_API_KEY in env to use an authenticated (higher-rate) plan.
 * Unauthenticated requests hit the free tier (rate-limited).
 */

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

// ─── Cache + in-flight dedup ──────────────────────────────────────────────────

const _cache    = new Map<string, { data: GoPlusRawToken | null; expiresAt: number }>();
const _inflight = new Map<string, Promise<GoPlusRawToken | null>>();

const CACHE_TTL_HIT  = 10 * 60 * 1_000; // 10 min — normal result
const CACHE_TTL_MISS =      60 * 1_000;  //  1 min — error / not found (retry sooner)

const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1";

// ─── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Fetches raw token security data from GoPlus for one token address.
 * Returns `null` when GoPlus has no record for the token or the request fails.
 *
 * Concurrent calls for the same key share a single HTTP request (in-flight dedup).
 * Results are cached: 10 min on success, 1 min on failure.
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

async function _doFetch(
  chainId: number,
  address: string,
  cacheKey: string,
  now: number,
): Promise<GoPlusRawToken | null> {
  const apiKey  = process.env.GOPLUS_API_KEY ?? "";
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = apiKey;

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
