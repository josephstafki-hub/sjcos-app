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

// ── Live-update signal ───────────────────────────────────────────────────────
// Every write that lands through query() logs one row in app_change_log so
// open browser tabs (components/shell/LiveUpdates.tsx polls MAX(id)) know to
// router.refresh() without a reload. The MCP server's rows() helper does the
// same from its own process — the table is the shared bus between them.

const WRITE_SQL = /^\s*(insert\s+into|update|delete\s+from)\s+(?:only\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i;
const CTE_WRITE_SQL = /^\s*with\b[\s\S]*\b(insert\s+into|update\s+[a-zA-Z_"]+\s+set|delete\s+from)\b/i;

/** Table a write statement touches, "" when hidden behind a CTE, null for reads. */
function writeScope(text: string): string | null {
  const m = WRITE_SQL.exec(text);
  if (m) return m[2].toLowerCase();
  return CTE_WRITE_SQL.test(text) ? "" : null;
}

/** Fire-and-forget: record that `scope` changed, occasionally pruning old rows.
 *  Never throws — a missing table (migration not yet applied) must not break writes. */
export function bumpLiveChange(scope: string, source = "app"): void {
  pool
    .query<{ id: string }>(
      `INSERT INTO app_change_log (scope, source) VALUES ($1, $2) RETURNING id`,
      [scope, source],
    )
    .then(({ rows }) => {
      if (Number(rows[0]?.id) % 500 === 0) {
        return pool.query(`DELETE FROM app_change_log WHERE created_at < now() - interval '7 days'`);
      }
    })
    .catch(() => {});
}

/** Parameterized query helper. Always use $1/$2 placeholders — never interpolate. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const result = await pool.query<T>(text, params as never[]);
  const scope = writeScope(text);
  // rowCount 0 (e.g. ON CONFLICT DO NOTHING, no-op UPDATE) changed nothing —
  // don't make every open tab refetch for it.
  if (scope !== null && scope !== "app_change_log" && (result.rowCount ?? 1) > 0) {
    bumpLiveChange(scope);
  }
  return result;
}

/** Convenience: first row or null. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const { rows } = await query<T>(text, params);
  return rows[0] ?? null;
}
