import { Pool, type QueryResult, type QueryResultRow } from "pg";

// Single shared connection pool. Stashed on globalThis so Next.js hot-reload in
// dev doesn't leak a new pool on every recompile.
const globalForDb = globalThis as unknown as { sjcosPool?: Pool };

export const pool: Pool =
  globalForDb.sjcosPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.sjcosPool = pool;
}

/** Parameterized query helper. Always use $1/$2 placeholders — never interpolate. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

/** Convenience: first row or null. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const { rows } = await query<T>(text, params);
  return rows[0] ?? null;
}
