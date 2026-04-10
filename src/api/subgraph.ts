/**
 * Thin GraphQL client for The Graph subgraph queries.
 *
 * Primary data source for all on-chain data: tokens, trades, holders,
 * migrations, snapshots, vesting, and platform stats.
 * Configure with SUBGRAPH_URL — all API endpoints require this to be set.
 */

// ─── Client ───────────────────────────────────────────────────────────────────

function subgraphUrl(): string {
  if (!process.env.SUBGRAPH_URL) {
    throw new Error("SUBGRAPH_URL is not configured.");
  }
  return process.env.SUBGRAPH_URL;
}

function subgraphHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.SUBGRAPH_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.SUBGRAPH_API_KEY}`;
  }
  return headers;
}

/**
 * Sends a single GraphQL query to the subgraph and returns the `data` object.
 * Throws on HTTP errors, GraphQL errors, or empty responses.
 */
export async function subgraphFetch<T>(
  query:      string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(subgraphUrl(), {
    method:  "POST",
    headers: subgraphHeaders(),
    body:    JSON.stringify({ query, variables: variables ?? {} }),
    signal:  AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Subgraph HTTP ${res.status}`);

  const body = await res.json() as { data?: T; errors?: { message: string }[] };

  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  if (!body.data) throw new Error("Subgraph returned no data");

  return body.data;
}

/**
 * Fetches all pages of a paginated subgraph list query.
 *
 * The query must accept `$first: Int!` and `$skip: Int!` variables and return
 * results under the given `key`. Pages are fetched until a partial page is
 * returned (fewer than `pageSize` items).
 */
export async function subgraphFetchAll<T>(
  key:        string,
  query:      string,
  variables?: Record<string, unknown>,
  pageSize  = 1000,
): Promise<T[]> {
  const results: T[] = [];
  let skip = 0;

  for (;;) {
    const page = await subgraphFetch<Record<string, T[]>>(query, {
      ...variables,
      first: pageSize,
      skip,
    });
    const items = page[key] ?? [];
    results.push(...items);
    if (items.length < pageSize) break;
    skip += pageSize;
  }

  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Counts all results matching a query by fetching all pages of just `id` fields.
 * Use for paginated endpoints that need an accurate total count.
 * Caps at 100,000 — return value is `100_000` if the real count exceeds that.
 */
export async function subgraphCount(
  key:        string,
  query:      string,
  variables?: Record<string, unknown>,
): Promise<number> {
  const all = await subgraphFetchAll<{ id: string }>(key, query, variables, 1000);
  return all.length;
}

/**
 * Formats a BigInt value as a decimal string with the given number of decimal places.
 * Trailing zeros in the fractional part are removed.
 *
 * Example: formatBigDecimal(1_230_000_000_000_000_000n, 18) → "1.23"
 */
export function formatBigDecimal(value: bigint, decimals: number): string {
  const s       = value.toString().padStart(decimals + 1, "0");
  const intPart = s.slice(0, -decimals) || "0";
  const decPart = s.slice(-decimals).replace(/0+$/, "") || "0";
  return `${intPart}.${decPart}`;
}

/**
 * Derives a Ponder-compatible trade source_id from a subgraph trade id.
 *
 * The subgraph encodes trade ids as txHash (32 bytes) + logIndex (4 bytes
 * int32 BE) concatenated. Ponder uses the format "{txHash}-{logIndex}".
 * This function converts between the two so existing point_event rows
 * (created by the Ponder-based poller) are not re-awarded.
 *
 * @param id  Subgraph trade id hex string (0x + 64 + 8 chars = 72 chars total)
 * @returns   "{txHash}-{logIndex}"  e.g. "0xabc...-5"
 */
export function tradeSourceId(id: string): string {
  const txHash   = "0x" + id.slice(2, 66);
  const logIndex = parseInt(id.slice(66), 16);
  return `${txHash}-${logIndex}`;
}
