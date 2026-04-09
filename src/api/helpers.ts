/**
 * Shared utilities for the OneMEME Launchpad REST API.
 * Framework-agnostic — no dependency on Hono, Express, or NestJS.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaginationMeta {
  page:    number;
  limit:   number;
  total:   number;
  pages:   number;
  hasMore: boolean;
}

export interface PaginatedResponse<T> {
  data:       T[];
  pagination: PaginationMeta;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export const MAX_LIMIT     = 100;
export const DEFAULT_LIMIT = 20;

/**
 * Parses and validates `page` and `limit` from a query-param map.
 * Clamps limit to [1, MAX_LIMIT] and page to [1, 10_000].
 */
export function parsePagination(
  query: Record<string, string | undefined>
): { page: number; limit: number; offset: number } {
  const page     = Math.max(1, parseInt(query["page"]  ?? "1",  10) || 1);
  const safePage = Math.min(page, 10_000);
  const limit    = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(query["limit"] ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );
  return { page: safePage, limit, offset: (safePage - 1) * limit };
}

export function paginationMeta(total: number, page: number, limit: number): PaginationMeta {
  const pages = Math.ceil(total / limit);
  return { page, limit, total, pages, hasMore: page < pages };
}

export function paginated<T>(
  items: T[],
  total: number,
  page:  number,
  limit: number
): PaginatedResponse<T> {
  return { data: items, pagination: paginationMeta(total, page, limit) };
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

export function parseOrderDir(
  query:      Record<string, string | undefined>,
  defaultDir: "asc" | "desc" = "desc"
): "ASC" | "DESC" {
  const dir = (query["orderDir"] ?? defaultDir).toUpperCase();
  return dir === "ASC" ? "ASC" : "DESC";
}

export function parseOrderBy(
  query:      Record<string, string | undefined>,
  allowed:    readonly string[],
  defaultCol: string
): string {
  const col = query["orderBy"] ?? defaultCol;
  return allowed.includes(col) ? col : defaultCol;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** Returns true if `s` is a 42-character Ethereum address (0x-prefixed hex). */
export function isAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

/** Normalises an Ethereum address to lowercase for consistent DB lookups. */
export function normalizeAddress(addr: string): string {
  return addr.toLowerCase();
}
