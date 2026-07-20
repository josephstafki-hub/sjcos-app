// Today v2 · Phase 7 (stretch) — model-emitted action chips.
//
// A local/agent reply MAY end with a fenced block naming Today items to act on:
//
//   ```sjcos-actions
//   [{"kind":"mark_done","work_item_id":"…","label":"Mark #2 done"}]
//   ```
//
// This module is the ONLY place that reads that block. It is pure and
// deliberately paranoid: any malformed input yields ZERO actions (and the fence
// still gets stripped from the display text), so a model emitting garbage can
// never fabricate a privileged action. The chips it produces render only when
// their work_item_id matches a card in the CURRENT queue snapshot, and their
// handlers call the same owner-verified server actions (lib/actions/today.ts)
// as the app-rendered cards — the block chooses WHICH item, never WHAT is
// allowed. See docs/today-interactive-plan.md §Phase 7.

export type ModelActionKind = "mark_done" | "snooze" | "open";

export interface ModelAction {
  kind: ModelActionKind;
  workItemId: string;
  label: string;
}

const KINDS: ReadonlySet<string> = new Set<ModelActionKind>([
  "mark_done",
  "snooze",
  "open",
]);

// The preferred explicit fence. Non-greedy body so a stray later fence can't
// be swallowed into it.
const EXPLICIT_FENCE_RE = /```sjcos-actions[^\n]*\n?([\s\S]*?)```/;
// Fallback: ANY fenced block (```json, ```, …). Small local models drift on the
// fence label, so we also accept a generic fence — but ONLY when its content is
// entirely a valid action array (see coerce(strict)), which ordinary code/JSON
// won't be. Global so we can scan every block.
const ANY_FENCE_RE = /```[a-zA-Z0-9_-]*[^\n]*\n?([\s\S]*?)```/g;

/** Validate + normalize a JSON array of action objects.
 *  - lenient (default): keep the valid entries, drop the rest.
 *  - strict: return [] unless the payload is a non-empty array in which EVERY
 *    entry validates (used for the generic-fence fallback so a random ```json
 *    block is never mistaken for actions). */
function coerce(text: string, strict = false): ModelAction[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const seen = new Set<string>();
  const actions: ModelAction[] = [];
  for (const entry of raw) {
    const e = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const kind = e?.kind;
    const id = e?.work_item_id;
    const label = e?.label;
    const valid =
      typeof kind === "string" &&
      KINDS.has(kind) &&
      typeof id === "string" &&
      id.length > 0 &&
      typeof label === "string" &&
      label.trim().length > 0;
    if (!valid) {
      if (strict) return []; // one bad entry ⇒ this isn't an actions block
      continue;
    }
    const dedupeKey = `${kind}:${id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    actions.push({
      kind: kind as ModelActionKind,
      workItemId: id as string,
      label: (label as string).trim().slice(0, 60),
    });
  }
  return actions.slice(0, 6); // cap so a runaway array can't flood the card
}

/** Split a model reply into its display text (fence removed) and the list of
 *  valid actions it declared. On ANY parse/validation error, returns the body
 *  with the fence stripped (when we identified one) and no actions — never
 *  throws, never fabricates an action. */
export function parseModelActions(body: string): {
  body: string;
  actions: ModelAction[];
} {
  // 1. Preferred explicit ```sjcos-actions fence: strip it regardless, keep any
  //    valid entries.
  const explicit = EXPLICIT_FENCE_RE.exec(body);
  if (explicit) {
    return { body: body.replace(explicit[0], "").trimEnd(), actions: coerce(explicit[1]) };
  }

  // 2. Fallback: the first generic fence whose content is entirely an action
  //    array. Only that block is stripped; other fenced content is left alone.
  ANY_FENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANY_FENCE_RE.exec(body)) !== null) {
    const actions = coerce(m[1], true);
    if (actions.length > 0) {
      return { body: body.replace(m[0], "").trimEnd(), actions };
    }
  }

  return { body, actions: [] };
}
