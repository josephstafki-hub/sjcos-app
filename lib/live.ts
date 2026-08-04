import "server-only";
import { queryOne } from "./db";

/** Cursor into app_change_log. `scopes` lists the tables touched since the
 *  caller's previous cursor (deduped), "" meaning "something, table unknown". */
export interface LiveChanges {
  cursor: number;
  scopes: string[];
}

/** What changed since `since`? First call passes null to just learn the current
 *  cursor (no backlog replay — a freshly opened tab already rendered fresh data). */
export async function getLiveChanges(since: number | null): Promise<LiveChanges> {
  if (since == null) {
    const row = await queryOne<{ max: string | null }>(
      `SELECT MAX(id) AS max FROM app_change_log`,
    );
    return { cursor: Number(row?.max ?? 0), scopes: [] };
  }
  const row = await queryOne<{ max: string | null; scopes: string[] | null }>(
    `SELECT MAX(id) AS max, ARRAY_AGG(DISTINCT scope) AS scopes
       FROM app_change_log WHERE id > $1`,
    [since],
  );
  const cursor = row?.max == null ? since : Number(row.max);
  return { cursor, scopes: row?.scopes ?? [] };
}
