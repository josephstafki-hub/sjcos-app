// Idempotent call follow-up creation (A04). lib/call-notes.ts finish() files
// one work item per action item for Joe and appends the summary to the
// voicemail callback item; if it dies half-way the next pass used to redo the
// whole list. ensureCallFollowUps(run, callId) is keyed per (call, action
// kind): each action is a stable source id `call:<id>:action:<i>` (work item)
// or `call:<id>:voicemail-note` (marker in the callback item's body), so a
// resumed run creates ONLY the missing actions and never a twin. Everything
// runs on the caller's `run` (one transaction in the app, a pg.Client in
// tests) and is serialized per call with an advisory xact lock.
//
// How lib/call-notes.ts should call it (not edited here — see
// docs/automation-reliability/status/A04.md):
//
//   import { withTransaction } from "@/lib/commands/db";
//   import { ensureCallFollowUps } from "@/lib/completion/call-followups";
//   ...inside finish(), after the calls row is updated:
//   await withTransaction((run) => ensureCallFollowUps(run, call.id, { by }));
//
// replacing the `for (const [i, a] of mine.entries()) fileCommsWorkItem(...)`
// loop and the voicemail body append.

import type { Run } from "../commands/core.ts";
import { refreshSourcedWorkItem } from "../obligations/work-items.ts";

interface CallRowLite {
  id: string;
  direction: string;
  contact_name: string | null;
  counterparty_number: string;
  started_at: string;
  lead_id: string | null;
  project_id: string | null;
  work_item_id: string | null;
  notes: { summary?: string; action_items?: { text: string; owner: string; due: string | null }[]; flags?: { kind: string }[] } | null;
}

export interface CallFollowUpsResult {
  callId: string;
  created: { key: string; workItemId: string }[];
  existing: { key: string; workItemId: string }[];
  voicemailNote: "appended" | "already" | "none";
  skipped: string[];
}

const OWNER_RE = /^(joe|us|we|sj|owner|sj carpentry)/i;

function dueDate(due: string | null): Date | null {
  if (!due) return null;
  const d = new Date(due);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Joe's action items from the notes shape, with their stable keys. */
export function ownerActionItems(call: Pick<CallRowLite, "id" | "notes">): { key: string; index: number; text: string; due: string | null }[] {
  const items = call.notes?.action_items ?? [];
  const out: { key: string; index: number; text: string; due: string | null }[] = [];
  items.forEach((a, i) => {
    if (!a || typeof a.text !== "string" || !a.text.trim()) return;
    if (!(OWNER_RE.test(a.owner ?? "") || a.owner === "unspecified")) return;
    out.push({ key: `call:${call.id}:action:${i}`, index: i, text: a.text.trim(), due: a.due ?? null });
  });
  return out;
}

export async function ensureCallFollowUps(run: Run, callId: string, opts: { by?: string } = {}): Promise<CallFollowUpsResult> {
  const by = opts.by ?? "call-notes";
  await run(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`call-followups:${callId}`]);
  const [call] = await run<CallRowLite>(
    `SELECT id, direction, contact_name, counterparty_number, started_at::text AS started_at, lead_id, project_id, work_item_id, notes
       FROM calls WHERE id = $1`,
    [callId],
  );
  const result: CallFollowUpsResult = { callId, created: [], existing: [], voicemailNote: "none", skipped: [] };
  if (!call) {
    result.skipped.push("no such call");
    return result;
  }
  if (!call.notes || typeof call.notes !== "object") {
    result.skipped.push("call has no notes yet");
    return result;
  }
  const who = call.contact_name || call.counterparty_number;
  const summary = String(call.notes.summary ?? "");
  const flagged = (call.notes.flags ?? []).length > 0;

  for (const a of ownerActionItems(call)) {
    const r = await refreshSourcedWorkItem(run, {
      sourceKind: "call",
      sourceId: a.key,
      provider: "call",
      title: a.text.slice(0, 140),
      body: `From the ${call.direction} call with ${who} on ${call.started_at.slice(0, 10)}${a.due ? ` (mentioned: ${a.due})` : ""}.\n\n${summary}\n\n[call:${call.id}]`,
      priority: flagged ? "high" : "normal",
      status: "queued",
      leadId: call.lead_id,
      projectId: call.project_id,
      dueAt: dueDate(a.due),
      createdBy: `call-notes:${by}`,
      obligationKind: "call_action",
      occurredAt: call.started_at,
    });
    if (r.action === "created") result.created.push({ key: a.key, workItemId: r.id });
    else result.existing.push({ key: a.key, workItemId: r.id });
  }

  // Voicemail callback item: append the summary once, marked so a re-run can
  // see it is already there.
  if (call.work_item_id && summary) {
    const marker = `[call-notes:${call.id}]`;
    const rows = await run<{ id: string }>(
      `UPDATE work_items
          SET body = body || E'\n\nVoicemail: ' || $2 || E'\n' || $3, updated_at = now()
        WHERE id = $1 AND position($3 in body) = 0
        RETURNING id`,
      [call.work_item_id, summary.slice(0, 600), marker],
    );
    result.voicemailNote = rows.length ? "appended" : "already";
  }
  return result;
}
