/**
 * PostgreSQL connection for the OneMEME Launchpad REST API.
 *
 * Uses postgres.js — a fast, zero-dependency PostgreSQL client for Node.js.
 * The same DATABASE_URL used by Ponder connects the API to the indexed data.
 *
 * NOTE: Ponder stores bigint columns as PostgreSQL `numeric`, which postgres.js
 * returns as strings. This is intentional — it preserves uint256 precision
 * without any loss through JavaScript's Number type.
 */

import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and configure it."
  );
}

export const sql = postgres(process.env.DATABASE_URL, {
  max:             10,       // maximum pool size
  idle_timeout:    30,       // close idle connections after 30 s
  connect_timeout: 10,       // fail fast if DB is unreachable
  // Return numeric/decimal columns as strings to preserve uint256 precision.
  // postgres.js does this by default for `numeric` columns.
  connection: {
    statement_timeout: "30000",  // kill queries that run longer than 30 s
  },
});
