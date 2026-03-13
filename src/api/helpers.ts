/**
 * Shared utilities for the OneMEME Launchpad REST API.
 */

import type { Context } from "hono";

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

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;

/**
 * Parses and validates `page` and `limit` from query parameters.
 * Clamps limit to [1, MAX_LIMIT] and page to [1, ∞).
 */
export function parsePagination(c: Context): { page: number; limit: number; offset: number } {
  const page  = Math.max(1, parseInt(c.req.query("page")  ?? "1",  10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(c.req.query("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Builds the pagination metadata returned in every list response.
 */
export function paginationMeta(total: number, page: number, limit: number): PaginationMeta {
  const pages = Math.ceil(total / limit);
  return { page, limit, total, pages, hasMore: page < pages };
}

/**
 * Wraps a list of items and pagination metadata into the standard response shape.
 */
export function paginated<T>(items: T[], total: number, page: number, limit: number): PaginatedResponse<T> {
  return { data: items, pagination: paginationMeta(total, page, limit) };
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

/** Validates `orderDir` query param; defaults to "desc". */
export function parseOrderDir(c: Context, defaultDir: "asc" | "desc" = "desc"): "ASC" | "DESC" {
  const dir = (c.req.query("orderDir") ?? defaultDir).toUpperCase();
  return dir === "ASC" ? "ASC" : "DESC";
}

/**
 * Returns a safe SQL column name from a whitelist.
 * Falls back to the default if the requested column is not allowed.
 */
export function parseOrderBy(
  c: Context,
  allowed: readonly string[],
  defaultCol: string
): string {
  const col = c.req.query("orderBy") ?? defaultCol;
  return allowed.includes(col) ? col : defaultCol;
}

// ─── Address validation ───────────────────────────────────────────────────────

/** Returns true if `s` is a 42-character Ethereum address (0x-prefixed hex). */
export function isAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

// ─── Error responses ──────────────────────────────────────────────────────────

export function badRequest(c: Context, message: string) {
  return c.json({ error: "Bad Request", message }, 400);
}

export function notFound(c: Context, message: string) {
  return c.json({ error: "Not Found", message }, 404);
}

export function serverError(c: Context, err: unknown) {
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
}
