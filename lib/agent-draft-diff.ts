// W5 learning layer — deterministic, model-free "did Joe edit it?" diffing.
//
// Both hooks (document drafts at signature-submit, newsletter issues at
// release) reduce their content to plain text lines, then ask materialDiff
// whether the final text differs enough from the agent's submitted snapshot
// to be worth a memory. No edits → null → no memory. Do not capture noise.

const NUM_DATE_RE = /\d+(?:[.,/:\-]\d+)*/g;

/** Sorted `key: value` lines for a document draft's field_values jsonb. */
export function fieldValuesText(values: Record<string, unknown>): string {
  return Object.keys(values)
    .sort()
    .map((k) => `${k}: ${typeof values[k] === "string" ? values[k] : JSON.stringify(values[k] ?? "")}`)
    .join("\n");
}

/** One line per part of a newsletter issue (title, intro, each block). */
export function issueText(issue: { title: string; intro: string; blocks: unknown }): string {
  const blocks = Array.isArray(issue.blocks) ? issue.blocks : [];
  return [
    `title: ${issue.title}`,
    `intro: ${issue.intro}`,
    ...blocks.map((b, i) => `block ${i + 1}: ${JSON.stringify(b ?? {})}`),
  ].join("\n");
}

/**
 * Compact diff of the changed lines only (`- ` removed / `+ ` added, capped at
 * 1500 chars), or null when the change isn't material. Material = more than
 * 10% of chars sit on changed lines, or any number/date token differs —
 * a tweaked amount or moved date always matters, a comma never does.
 */
export function materialDiff(oldText: string, newText: string): string | null {
  if (oldText === newText) return null;

  // Multiset line compare — order changes alone don't register as edits.
  const counts = new Map<string, number>();
  for (const l of oldText.split("\n")) counts.set(l, (counts.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of newText.split("\n")) {
    const c = counts.get(l) ?? 0;
    if (c > 0) counts.set(l, c - 1);
    else added.push(l);
  }
  const removed: string[] = [];
  for (const [l, c] of counts) for (let i = 0; i < c; i++) removed.push(l);
  if (!added.length && !removed.length) return null;

  const changedChars = added.join("").length + removed.join("").length;
  const totalChars = Math.max(oldText.length + newText.length, 1);
  const numTokens = (s: string) => (s.match(NUM_DATE_RE) ?? []).sort().join("|");
  const material = changedChars / totalChars > 0.1 || numTokens(oldText) !== numTokens(newText);
  if (!material) return null;

  const out = [
    ...removed.filter((l) => l.trim()).map((l) => `- ${l}`),
    ...added.filter((l) => l.trim()).map((l) => `+ ${l}`),
  ].join("\n");
  if (!out) return null;
  return out.length > 1500 ? `${out.slice(0, 1497)}…` : out;
}
