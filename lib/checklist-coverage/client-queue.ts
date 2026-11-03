// Client-side edit queue for the hand-ticked discovery checklist (plan §4.2–§4.3).
//
// Pure functions only — no React, no DB, no server actions — so the browser
// hook (components/calls/checklist/useChecklistSync.ts) and node tests share
// one implementation. The server snapshot (`snapshot`) is the acknowledged
// truth; `queue` holds this device's edits that the server hasn't confirmed.
// What the screen shows is the snapshot with the queue laid over it, so an
// optimistic tick is never confused with a saved one.
//
// Revisions: every checklist command bumps the session revision by exactly
// one (0074 `checklist_command`). An edit's `expected_revision` is fixed when
// it is queued (snapshot revision + edits already ahead of it) and never
// changes for that operation id, so a network retry replays the identical
// payload. Rebasing an edit means a NEW operation id (plan §4.3, handoff 5).

import type { CoverageState } from './contract.ts';
import { safeRevision } from './contract.ts';
import type { ChecklistSnapshot, ManualOperation } from './manual.ts';

export interface RowValue { state: CoverageState; value: unknown; reason: string | null }
export interface NotesOperation { session_id: string; notes: string; expected_revision: number; operation_id: string }

export type QueuedOp =
  | { kind: 'set_item'; op: ManualOperation; base: RowValue; sent: boolean; queued_at: number }
  | { kind: 'notes'; op: NotesOperation; base_notes: string; sent: boolean; queued_at: number };

export interface Conflict {
  /** The edit the server refused. */
  mine: QueuedOp;
  /** What the server holds now for that row (or notes). */
  current: RowValue | { notes: string };
}

export interface SyncState { snapshot: ChecklistSnapshot; queue: QueuedOp[]; conflict: Conflict | null }

/** One tap on the state word (plan §4.2 step 3). */
export function nextTapState(state: CoverageState): CoverageState {
  if (state === 'open') return 'covered';
  if (state === 'covered') return 'open';
  if (state === 'partial') return 'covered';
  return 'open'; // N/A → back to Open; its reason no longer applies
}

/** Key-order-independent JSON (jsonb reorders object keys). */
export function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
}

export function sameRow(a: RowValue, b: RowValue): boolean {
  return a.state === b.state && (a.reason?.trim() || null) === (b.reason?.trim() || null) && stableJson(a.value ?? null) === stableJson(b.value ?? null);
}

function serverRow(snapshot: ChecklistSnapshot, itemId: string): RowValue | null {
  const row = snapshot.rows.find((r) => r.identity.item_id === itemId);
  return row ? { state: row.coverage.state, value: row.coverage.value ?? null, reason: row.coverage.reason ?? null } : null;
}

/** The row as this device shows it: server value with queued edits applied in order. */
export function rowView(snapshot: ChecklistSnapshot, queue: QueuedOp[], itemId: string): (RowValue & { pending: boolean }) | null {
  let view = serverRow(snapshot, itemId);
  if (!view) return null;
  let pending = false;
  for (const q of queue) if (q.kind === 'set_item' && q.op.item_id === itemId) { view = { state: q.op.state, value: q.op.value ?? null, reason: q.op.reason }; pending = true; }
  return { ...view, pending };
}

export function notesView(snapshot: ChecklistSnapshot, queue: QueuedOp[]): { notes: string; pending: boolean } {
  let notes = snapshot.session.manual_notes ?? '';
  let pending = false;
  for (const q of queue) if (q.kind === 'notes') { notes = q.op.notes; pending = true; }
  return { notes, pending };
}

/** Revision the next queued edit expects: the server's plus every edit ahead of it. */
export function nextExpectedRevision(snapshot: ChecklistSnapshot, queue: QueuedOp[]): number {
  return safeRevision(snapshot.session.revision + queue.length);
}

export function enqueueSetItem(s: SyncState, input: { item_id: string; state: CoverageState; value: unknown; reason: string | null }, operationId: string, now: number): SyncState {
  const base = rowView(s.snapshot, s.queue, input.item_id);
  if (!base) throw new Error('CHECKLIST_INVALID_ITEM');
  const op: ManualOperation = {
    session_id: s.snapshot.session.id, item_id: input.item_id, state: input.state,
    value: input.value ?? null, reason: input.state === 'not_applicable' ? (input.reason?.trim() || null) : null,
    expected_revision: nextExpectedRevision(s.snapshot, s.queue), operation_id: operationId,
  };
  return { ...s, queue: [...s.queue, { kind: 'set_item', op, base: { state: base.state, value: base.value, reason: base.reason }, sent: false, queued_at: now }] };
}

/** Notes typed while an unsent notes edit is waiting replace it in place
 *  (same id, never sent, so no replay ambiguity); otherwise a new edit queues. */
export function enqueueNotes(s: SyncState, notes: string, operationId: string, now: number): SyncState {
  const last = s.queue.at(-1);
  if (last?.kind === 'notes' && !last.sent) {
    return { ...s, queue: [...s.queue.slice(0, -1), { ...last, op: { ...last.op, notes } }] };
  }
  const base = notesView(s.snapshot, s.queue).notes;
  if (base === notes) return s;
  const op: NotesOperation = { session_id: s.snapshot.session.id, notes, expected_revision: nextExpectedRevision(s.snapshot, s.queue), operation_id: operationId };
  return { ...s, queue: [...s.queue, { kind: 'notes', op, base_notes: base, sent: false, queued_at: now }] };
}

export function markHeadSent(s: SyncState): SyncState {
  const [head, ...rest] = s.queue;
  return head && !head.sent ? { ...s, queue: [{ ...head, sent: true }, ...rest] } : s;
}

/** The server acknowledged the head edit: fold it into the snapshot. */
export function ackHead(s: SyncState, result: { revision: number }): SyncState {
  const [head, ...rest] = s.queue;
  if (!head) return s;
  const revision = safeRevision(Number(result.revision));
  const snapshot: ChecklistSnapshot = { ...s.snapshot, session: { ...s.snapshot.session, revision } };
  if (head.kind === 'set_item') {
    snapshot.rows = s.snapshot.rows.map((r) => r.identity.item_id !== head.op.item_id ? r : {
      ...r, coverage: { ...r.coverage, state: head.op.state, value: head.op.value ?? null, reason: head.op.reason, source: 'manual', manual_lock: true, revision: r.coverage.revision + 1 },
    });
  } else {
    snapshot.session = { ...snapshot.session, manual_notes: head.op.notes };
  }
  return { ...s, snapshot, queue: rest };
}

/** Raw snapshots (conflict payloads) carry BIGINT revisions as strings. */
export function normalizeSnapshot(raw: ChecklistSnapshot): ChecklistSnapshot {
  return {
    ...raw,
    session: { ...raw.session, revision: safeRevision(Number(raw.session.revision)), deletion_epoch: safeRevision(Number(raw.session.deletion_epoch ?? 0)), manual_notes: raw.session.manual_notes ?? '' },
    rows: raw.rows.map((r) => ({ ...r, coverage: { ...r.coverage, revision: safeRevision(Number(r.coverage.revision)) } })),
  };
}

/** Give an edit a new operation id against the server's current revision. */
export function rebaseHead(s: SyncState, operationId: string): SyncState {
  const [head, ...rest] = s.queue;
  if (!head) return s;
  const expected_revision = safeRevision(s.snapshot.session.revision);
  const moved: QueuedOp = head.kind === 'set_item'
    ? { ...head, sent: false, op: { ...head.op, expected_revision, operation_id: operationId } }
    : { ...head, sent: false, op: { ...head.op, expected_revision, operation_id: operationId } };
  return { ...s, conflict: null, queue: [moved, ...rest] };
}

/**
 * The server answered 409 for the head edit. Adopt its snapshot. If the row
 * (or notes) this edit changed is exactly what this device last saw, the other
 * device touched something else — the edit is re-sent under a new id. If the
 * same row was changed elsewhere, stop and ask: never overwrite it silently.
 */
export function onConflict(s: SyncState, rawCurrent: ChecklistSnapshot, newOperationId: string): { state: SyncState; ask: boolean } {
  const snapshot = normalizeSnapshot(rawCurrent);
  const head = s.queue[0];
  const next: SyncState = { ...s, snapshot };
  if (!head) return { state: next, ask: false };
  if (head.kind === 'set_item') {
    const now = serverRow(snapshot, head.op.item_id);
    if (!now) return { state: { ...next, queue: s.queue.slice(1) }, ask: false }; // row no longer on this checklist
    if (sameRow(now, head.base)) return { state: rebaseHead(next, newOperationId), ask: false };
    return { state: { ...next, conflict: { mine: head, current: now } }, ask: true };
  }
  const notes = snapshot.session.manual_notes ?? '';
  if (notes === head.base_notes) return { state: rebaseHead(next, newOperationId), ask: false };
  return { state: { ...next, conflict: { mine: head, current: { notes } } }, ask: true };
}

/** Joe chose this device's version: re-send it under a new id (handoff 5). */
export function keepMine(s: SyncState, operationId: string): SyncState {
  return rebaseHead({ ...s, conflict: null }, operationId);
}

/** Joe chose the saved version: drop this device's edit. */
export function takeSaved(s: SyncState): SyncState {
  return { ...s, conflict: null, queue: s.queue.slice(1) };
}

export type SendFailure = { kind: 'network' } | { kind: 'code'; code: string } | { kind: 'server' };

/** Sort a thrown server-action error. Production builds hide thrown messages,
 *  so an unrecognised error is 'server' (keep the edit, offer a retry). */
export function classifyError(error: unknown, online: boolean): SendFailure {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code = /CHECKLIST_[A-Z_]+/.exec(message)?.[0];
  if (code) return { kind: 'code', code };
  if (!online || error instanceof TypeError || /fetch|network|load failed/i.test(message)) return { kind: 'network' };
  return { kind: 'server' };
}

/** "3 changes" / "1 change". */
export function changesWord(n: number): string {
  return `${n} change${n === 1 ? '' : 's'}`;
}
