/**
 * Multi-endpoint GraphQL client for all DEX-related subgraphs.
 *
 * Subgraph routing:
 *   MAIN        → SUBGRAPH_URL          — 1MEME launchpad (tokens, trades, migrations)
 *   AGGREGATOR  → AGGREGATOR_SUBGRAPH_URL — FourMEME / Flap.SH bonding-curve data +
 *                                          OneMEMEAggregator swap events
 *   PANCAKE_V2  → NodeReal free endpoint (hardcoded default, override via env)
 *   PANCAKE_V3  → The Graph gateway (THE_GRAPH_API_KEY required)
 *   PANCAKE_V4  → The Graph gateway
 *   UNISWAP_V2  → The Graph gateway
 *   UNISWAP_V3  → The Graph gateway
 *   UNISWAP_V4  → The Graph gateway
 */

// ─── Endpoint types ───────────────────────────────────────────────────────────

export type DexEndpoint =
  | "MAIN"
  | "AGGREGATOR"
  | "PANCAKE_V2"
  | "PANCAKE_V3"
  | "PANCAKE_V4"
  | "UNISWAP_V2"
  | "UNISWAP_V3"
  | "UNISWAP_V4";

/** All DEX protocol endpoints (excludes MAIN and AGGREGATOR). */
export const DEX_PROTOCOL_ENDPOINTS: DexEndpoint[] = [
  "PANCAKE_V2", "PANCAKE_V3", "PANCAKE_V4",
  "UNISWAP_V2", "UNISWAP_V3", "UNISWAP_V4",
];

// ─── Hardcoded subgraph IDs (BSC mainnet) ─────────────────────────────────────

const SUBGRAPH_IDS: Partial<Record<DexEndpoint, string>> = {
  PANCAKE_V3: "ChmxqA9bX71cB2cQTRRULbWUBKoMRk7oh3JnpZShDQ2V",
  PANCAKE_V4: "8jFYxwKP8tNGSDisucpHRK1ojUchZd7ELd8zh2ugHGDN",
  UNISWAP_V2: "8EjCaWZumyAfN3wyB4QnibeeXaYS8i4sp1PiWT91AGrt",
  UNISWAP_V3: "G5MUbSBM7Nsrm9tH2tGQUiAF4SZDGf2qeo1xPLYjKr7K",
  UNISWAP_V4: "EAq1nJKgjnuKH6Gj4RFjCW7LcL7E2uipbncdwV7TTWkX",
};

// ─── URL resolution ───────────────────────────────────────────────────────────

function theGraphApiKey(): string {
  if (!process.env.THE_GRAPH_API_KEY) {
    throw new Error("THE_GRAPH_API_KEY is not configured.");
  }
  return process.env.THE_GRAPH_API_KEY;
}

function theGraphUrl(subgraphId: string): string {
  return `https://gateway.thegraph.com/api/${theGraphApiKey()}/subgraphs/id/${subgraphId}`;
}

export function getEndpointUrl(endpoint: DexEndpoint): string {
  switch (endpoint) {
    case "MAIN":
      if (!process.env.SUBGRAPH_URL) throw new Error("SUBGRAPH_URL is not configured.");
      return process.env.SUBGRAPH_URL;

    case "AGGREGATOR":
      if (!process.env.AGGREGATOR_SUBGRAPH_URL) throw new Error("AGGREGATOR_SUBGRAPH_URL is not configured.");
      return process.env.AGGREGATOR_SUBGRAPH_URL;

    case "PANCAKE_V2":
      return (process.env.PANCAKE_V2_SUBGRAPH_URL
        ?? "https://open-platform.nodereal.io/c35b4664037541d0a3a163783019d4c4/pancakeswap-free/graphql");

    case "PANCAKE_V3":
      return process.env.PANCAKE_V3_SUBGRAPH_URL ?? theGraphUrl(SUBGRAPH_IDS.PANCAKE_V3!);

    case "PANCAKE_V4":
      return process.env.PANCAKE_V4_SUBGRAPH_URL ?? theGraphUrl(SUBGRAPH_IDS.PANCAKE_V4!);

    case "UNISWAP_V2":
      return process.env.UNISWAP_V2_SUBGRAPH_URL ?? theGraphUrl(SUBGRAPH_IDS.UNISWAP_V2!);

    case "UNISWAP_V3":
      return process.env.UNISWAP_V3_SUBGRAPH_URL ?? theGraphUrl(SUBGRAPH_IDS.UNISWAP_V3!);

    case "UNISWAP_V4":
      return process.env.UNISWAP_V4_SUBGRAPH_URL ?? theGraphUrl(SUBGRAPH_IDS.UNISWAP_V4!);
  }
}

function getEndpointHeaders(endpoint: DexEndpoint): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (endpoint === "AGGREGATOR" && process.env.AGGREGATOR_SUBGRAPH_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.AGGREGATOR_SUBGRAPH_API_KEY}`;
  }
  if (endpoint === "MAIN" && process.env.SUBGRAPH_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.SUBGRAPH_API_KEY}`;
  }
  return headers;
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

/** Strips the The Graph API key from a URL before using it in error messages. */
function redactUrl(url: string): string {
  const key = process.env.THE_GRAPH_API_KEY;
  return key ? url.replace(key, "***") : url;
}

async function fetchFrom<T>(
  url:       string,
  headers:   Record<string, string>,
  query:     string,
  variables: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers,
      body:    JSON.stringify({ query, variables }),
      signal:  controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`${redactUrl(url)} HTTP ${res.status}`);

  const body = await res.json() as { data?: T; errors?: { message: string }[] };

  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  if (!body.data) throw new Error(`${redactUrl(url)} returned no data`);

  return body.data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch from a specific endpoint.
 * Throws if the required env var is not set.
 */
export async function dexFetchFrom<T>(
  endpoint:   DexEndpoint,
  query:      string,
  variables?: Record<string, unknown>,
): Promise<T> {
  return fetchFrom<T>(
    getEndpointUrl(endpoint),
    getEndpointHeaders(endpoint),
    query,
    variables ?? {},
  );
}

/** Fetch from the AGGREGATOR subgraph (backward compat). */
export async function dexFetch<T>(
  query:      string,
  variables?: Record<string, unknown>,
): Promise<T> {
  return dexFetchFrom<T>("AGGREGATOR", query, variables);
}

/** Fetch from the MAIN launchpad subgraph (SUBGRAPH_URL). */
export async function mainFetch<T>(
  query:      string,
  variables?: Record<string, unknown>,
): Promise<T> {
  return dexFetchFrom<T>("MAIN", query, variables);
}

/**
 * Paginated fetch — iterates pages until fewer than pageSize results are returned.
 */
const MAX_FETCH_PAGES = 100;

export async function dexFetchAll<T>(
  endpoint:   DexEndpoint,
  key:        string,
  query:      string,
  variables?: Record<string, unknown>,
  pageSize  = 1000,
): Promise<T[]> {
  const results: T[] = [];
  let skip  = 0;
  let pages = 0;

  for (;;) {
    if (pages >= MAX_FETCH_PAGES) break;
    const page = await dexFetchFrom<Record<string, T[]>>(endpoint, query, {
      ...variables,
      first: pageSize,
      skip,
    });
    const items = page[key] ?? [];
    results.push(...items);
    pages++;
    if (items.length < pageSize) break;
    skip += pageSize;
  }

  return results;
}

/** Count results by fetching only id fields across all pages. */
export async function dexCount(
  endpoint:   DexEndpoint,
  key:        string,
  query:      string,
  variables?: Record<string, unknown>,
): Promise<number> {
  const all = await dexFetchAll<{ id: string }>(endpoint, key, query, variables, 1000);
  return all.length;
}
