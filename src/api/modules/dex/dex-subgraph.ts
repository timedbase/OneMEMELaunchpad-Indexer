/**
 * GraphQL client for the OneMEMEAggregator subgraph.
 *
 * Intentionally separate from src/api/subgraph.ts — uses AGGREGATOR_SUBGRAPH_URL
 * and never reads or touches SUBGRAPH_URL. All field names reflect the aggregator
 * subgraph schema; verify against your schema.graphql if you self-host the node.
 */

// ─── Client ───────────────────────────────────────────────────────────────────

function aggregatorUrl(): string {
  if (!process.env.AGGREGATOR_SUBGRAPH_URL) {
    throw new Error("AGGREGATOR_SUBGRAPH_URL is not configured.");
  }
  return process.env.AGGREGATOR_SUBGRAPH_URL;
}

function aggregatorHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.AGGREGATOR_SUBGRAPH_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.AGGREGATOR_SUBGRAPH_API_KEY}`;
  }
  return headers;
}

/**
 * Single GraphQL query against the aggregator subgraph.
 * Throws on HTTP errors, GraphQL errors, or missing data.
 */
export async function dexFetch<T>(
  query:      string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(aggregatorUrl(), {
    method:  "POST",
    headers: aggregatorHeaders(),
    body:    JSON.stringify({ query, variables: variables ?? {} }),
    signal:  AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Aggregator subgraph HTTP ${res.status}`);

  const body = await res.json() as { data?: T; errors?: { message: string }[] };

  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  if (!body.data) throw new Error("Aggregator subgraph returned no data");

  return body.data;
}

/**
 * Fetches all pages of a paginated aggregator subgraph query.
 * Query must accept $first: Int! and $skip: Int! and return results under `key`.
 */
export async function dexFetchAll<T>(
  key:       string,
  query:     string,
  variables?: Record<string, unknown>,
  pageSize  = 1000,
): Promise<T[]> {
  const results: T[] = [];
  let skip = 0;

  for (;;) {
    const page = await dexFetch<Record<string, T[]>>(query, {
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

/**
 * Counts all results matching a query by fetching all id fields.
 */
export async function dexCount(
  key:       string,
  query:     string,
  variables?: Record<string, unknown>,
): Promise<number> {
  const all = await dexFetchAll<{ id: string }>(key, query, variables, 1000);
  return all.length;
}
