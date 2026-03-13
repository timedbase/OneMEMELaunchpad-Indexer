/**
 * Token metadata fetcher with in-memory TTL cache.
 *
 * Each OneMEME token stores a `metaURI` on-chain pointing to a JSON document
 * that describes the token's off-chain identity: name, image, description,
 * website, and social links.
 *
 * Expected metadata JSON shape (all fields optional):
 * {
 *   "name":        "DogeMeme",
 *   "symbol":      "DOGE",
 *   "description": "The first meme token on OneMEME Launchpad",
 *   "image":       "https://... | ipfs://...",
 *   "website":     "https://dogememe.io",
 *   "twitter":     "https://twitter.com/dogememe",
 *   "telegram":    "https://t.me/dogememe",
 *   "discord":     "https://discord.gg/dogememe",
 *   "github":      "https://github.com/dogememe",
 *   // nested socials object also supported:
 *   "socials": {
 *     "twitter":  "...",
 *     "telegram": "...",
 *     "discord":  "..."
 *   }
 * }
 *
 * IPFS URIs are resolved via the configured gateway (default: ipfs.io).
 * Metadata is cached per URI for METADATA_TTL ms to avoid repeat fetches.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenSocials {
  twitter?:  string;
  telegram?: string;
  discord?:  string;
  github?:   string;
  medium?:   string;
  [key: string]: string | undefined;
}

export interface TokenMetadata {
  name?:        string;
  symbol?:      string;
  description?: string;
  /** Resolved HTTP URL (IPFS gateway substituted if original was ipfs://). */
  image?:       string;
  /** Original image URI as stored in the metadata JSON. */
  imageRaw?:    string;
  website?:     string;
  socials:      TokenSocials;
}

// ─── Config ───────────────────────────────────────────────────────────────────

/** Public IPFS HTTP gateway used to resolve ipfs:// URIs. */
const IPFS_GATEWAY = process.env.IPFS_GATEWAY ?? "https://ipfs.io/ipfs/";

/** How long to cache metadata per URI (default: 5 minutes). */
const METADATA_TTL = 5 * 60_000;

/** HTTP fetch timeout for metadata JSON requests (ms). */
const FETCH_TIMEOUT = 8_000;

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data:      TokenMetadata | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// Purge stale entries every 10 minutes.
setInterval(() => {
  const now = Date.now();
  for (const [uri, entry] of cache) {
    if (entry.expiresAt < now) cache.delete(uri);
  }
}, 10 * 60_000).unref();

// ─── URI helpers ──────────────────────────────────────────────────────────────

/**
 * Converts an ipfs:// URI to an HTTP URL via the configured gateway.
 * Returns all other URIs unchanged.
 */
export function resolveUri(uri: string): string {
  if (!uri) return uri;
  if (uri.startsWith("ipfs://")) {
    return IPFS_GATEWAY + uri.slice(7);
  }
  if (uri.startsWith("ipfs/")) {
    return IPFS_GATEWAY + uri.slice(5);
  }
  return uri;
}

// ─── Socials extraction ───────────────────────────────────────────────────────

const SOCIAL_KEYS: (keyof TokenSocials)[] = [
  "twitter", "telegram", "discord", "github", "medium",
];

/**
 * Extracts social links from a raw metadata object.
 * Supports both flat fields and a nested `socials` object.
 */
function extractSocials(raw: Record<string, unknown>): TokenSocials {
  const socials: TokenSocials = {};

  // Flat fields at root level (e.g. { "twitter": "https://..." })
  for (const key of SOCIAL_KEYS) {
    const val = raw[key];
    if (typeof val === "string" && val) socials[key] = val;
  }

  // Nested `socials` object takes precedence over flat fields.
  if (raw.socials && typeof raw.socials === "object") {
    const nested = raw.socials as Record<string, unknown>;
    for (const key of SOCIAL_KEYS) {
      const val = nested[key];
      if (typeof val === "string" && val) socials[key] = val;
    }
    // Also pick up any extra keys in the nested object.
    for (const [key, val] of Object.entries(nested)) {
      if (typeof val === "string" && val && !SOCIAL_KEYS.includes(key as keyof TokenSocials)) {
        socials[key] = val;
      }
    }
  }

  return socials;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Fetches and parses token metadata from a URI, with TTL caching.
 *
 * Returns `null` if:
 *   - The URI is empty or blank
 *   - The HTTP request fails or times out
 *   - The response body is not valid JSON
 *
 * Never throws — callers receive `null` on any failure so the token detail
 * endpoint can still return DB data even when metadata is unavailable.
 */
export async function fetchMetadata(uri: string): Promise<TokenMetadata | null> {
  if (!uri || !uri.trim()) return null;

  // Return cached entry if still fresh.
  const cached = cache.get(uri);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const httpUri = resolveUri(uri.trim());

  let raw: Record<string, unknown>;
  try {
    const res = await fetch(httpUri, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json() as Record<string, unknown>;
  } catch {
    // Cache null briefly so a bad URI doesn't hammer the gateway on every request.
    cache.set(uri, { data: null, expiresAt: Date.now() + 30_000 });
    return null;
  }

  const imageRaw = typeof raw.image === "string" ? raw.image : undefined;

  const metadata: TokenMetadata = {
    name:        typeof raw.name        === "string" ? raw.name        : undefined,
    symbol:      typeof raw.symbol      === "string" ? raw.symbol      : undefined,
    description: typeof raw.description === "string" ? raw.description : undefined,
    image:       imageRaw ? resolveUri(imageRaw) : undefined,
    imageRaw,
    website:     typeof raw.website     === "string" ? raw.website     : undefined,
    socials:     extractSocials(raw),
  };

  cache.set(uri, { data: metadata, expiresAt: Date.now() + METADATA_TTL });
  return metadata;
}
