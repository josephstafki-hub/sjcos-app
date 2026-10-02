import "server-only";

// Next.js-side glue for the pure measure/overhead modules: a pool-backed Run
// plus a transaction helper. Keeps `server-only` out of the pure files so the
// node test runner and the MCP server can import them directly.

import { pool } from "@/lib/db";
import type { Run } from "@/lib/commands/core";

export const poolRun: Run = async <R = Record<string, unknown>>(sql: string, params?: unknown[]) => {
  const r = await pool.query(sql, params);
  return r.rows as R[];
};

export async function withMeasureTx<T>(fn: (run: Run) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const run: Run = async <R = Record<string, unknown>>(sql: string, params?: unknown[]) => (await client.query(sql, params)).rows as R[];
  try {
    await client.query("BEGIN");
    const out = await fn(run);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Default observation window: the last 30 days, ISO strings. */
export function defaultWindow(days = 30): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** app_settings key holding the JSON array of registered MCP tool names. The
 *  MCP `procedure_checks` tool writes it from its own registry; scripts/
 *  list-mcp-tools.mjs prints the same list for hand entry. */
export const KNOWN_TOOLS_SETTING = "measure.known_tools";

export async function knownToolsFromSettings(): Promise<string[]> {
  const [row] = await poolRun<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [KNOWN_TOOLS_SETTING]);
  if (!row?.value) return [];
  try {
    const v = JSON.parse(row.value);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
