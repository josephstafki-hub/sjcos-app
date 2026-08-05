import "server-only";

import { query, queryOne } from "@/lib/db";

// Run effects: which entities an agent run actually touched (run_effects
// table, db/apply-orchestration-p1.mjs). Two feeds for Hermes — it executes
// its MCP tools invisibly in its own gateway process, so the app can't see
// the writes directly:
//   - reported: a ```sjcos-effects fence Hermes appends to a reply (exact,
//     best-effort — parsed with the same paranoia as lib/today-actions.ts:
//     whitelists, caps, never throws, never fabricates);
//   - inferred: app_change_log rows with source='mcp' inside the run's time
//     window (guaranteed floor, table-level only; a concurrent MCP writer can
//     mis-attribute a scope — blast radius is a spurious refresh, not a wrong
//     action).
// App-executed actions (the pending-writes path) insert exact rows directly.

export interface RunEffect {
  entityKind: string;
  entityId: string | null;
  action: string;
}

export type EffectSource = "app" | "hermes-reported" | "hermes-inferred" | "claude";

const EXPLICIT_FENCE_RE = /```sjcos-effects[^\S\n]*\n([\s\S]*?)```/i;
const KIND_RE = /^[a-z][a-z0-9_]{0,39}$/;
const ID_RE = /^[\w.:\-\/]{1,120}$/;
const ACTIONS = new Set(["created", "updated", "deleted", "status", "sent", "queued", "touched"]);
const MAX_EFFECTS = 20;

/** Coerce fence JSON into valid effects. Anything malformed is dropped, never
 *  repaired — the fence is advisory metadata, not an instruction channel. */
function coerce(text: string): RunEffect[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RunEffect[] = [];
  for (const item of parsed.slice(0, MAX_EFFECTS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = typeof o.entity_kind === "string" ? o.entity_kind.toLowerCase() : "";
    const action = typeof o.action === "string" ? o.action.toLowerCase() : "touched";
    const id = typeof o.entity_id === "string" ? o.entity_id : null;
    if (!KIND_RE.test(kind)) continue;
    if (!ACTIONS.has(action)) continue;
    if (id != null && !ID_RE.test(id)) continue;
    out.push({ entityKind: kind, entityId: id, action });
  }
  return out;
}

/** Split a reply into display text (fence removed) and reported effects. */
export function parseModelEffects(body: string): { body: string; effects: RunEffect[] } {
  const m = EXPLICIT_FENCE_RE.exec(body);
  if (!m) return { body, effects: [] };
  return { body: body.replace(m[0], "").trimEnd(), effects: coerce(m[1]) };
}

export async function recordRunEffects(
  runId: string,
  effects: RunEffect[],
  source: EffectSource,
): Promise<void> {
  for (const e of effects) {
    await query(
      `INSERT INTO run_effects (run_id, entity_kind, entity_id, action, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, e.entityKind, e.entityId, e.action, source],
    );
  }
}

/** The guaranteed floor: any MCP-side write logged during this run's lifetime
 *  is attributed to it, table-level. Called when a Hermes run completes. */
export async function inferHermesEffects(runId: string): Promise<void> {
  const run = await queryOne<{ created_at: string }>(
    `SELECT created_at FROM dev_agent_runs WHERE id = $1`,
    [runId],
  );
  if (!run) return;
  const { rows } = await query<{ scope: string }>(
    `SELECT DISTINCT scope FROM app_change_log
      WHERE source = 'mcp' AND scope <> '' AND scope <> 'run_effects'
        AND created_at >= $1 AND created_at <= now()`,
    [run.created_at],
  );
  await recordRunEffects(
    runId,
    rows.map((r) => ({ entityKind: r.scope, entityId: null, action: "touched" })),
    "hermes-inferred",
  );
}

/** Completion hook for every Hermes turn: strip + record the effects fence,
 *  correlate MCP writes, return the display answer. Bookkeeping must never
 *  fail the turn. */
export async function finalizeHermesAnswer(runId: string, raw: string): Promise<string> {
  const { body, effects } = parseModelEffects(raw);
  try {
    if (effects.length) await recordRunEffects(runId, effects, "hermes-reported");
    await inferHermesEffects(runId);
  } catch {
    // Effects are telemetry; the answer still lands.
  }
  return body;
}
