import {cleanRowSummary} from './inbox-review.ts';
import type {DraftIdentity, DraftText, DraftWriteResult, InboxDraft} from './inbox-draft-types';
import type {DraftSyncSnapshot, DraftSyncStatus} from './inbox-draft-sync';
import type {InboxThread, ThreadReader} from './inbox';

export function matchingSuggestion(rows: InboxDraft[], threadKey: string, reader: ThreadReader | undefined, owner: boolean): InboxDraft | null {
  const latest = reader?.messages.findLast(m => !m.outbound)?.id;
  if (!owner || !latest || reader?.channel !== 'email') return null;
  return rows.find(r => r.threadKey === threadKey && r.channel === 'email' && r.source === 'ai' && r.status === 'ready' && r.sourceMessageId === latest) ?? null;
}
export function draftRow(thread: InboxThread, suggestion?: InboxDraft | null): InboxThread {
  if (!suggestion || thread.automated || thread.filedOther || thread.newSender || thread.view === 'done') return thread;
  return {...thread, needsMeReason: `Draft ready · ${thread.needsMeReason || 'Reply to review'}`, preview: cleanRowSummary(suggestion.summary || thread.preview,thread.fromName)};
}
export function draftStatusLabel(status: DraftSyncStatus): string {
  return {saved:'Saved',saving:'Saving…','local only':'Saved on this device only',conflict:'This draft changed on another device'}[status];
}
export async function prepareDraftSend(draft: DraftText, flush: () => Promise<DraftSyncSnapshot> | undefined): Promise<DraftSyncSnapshot> {
  const snapshot = await flush();
  if (!snapshot || snapshot.conflict || snapshot.status === 'conflict') throw new Error('Resolve the draft conflict before sending.');
  if (snapshot.status !== 'saved') throw new Error('Your draft is still saving. Try again once it is Saved.');
  if (JSON.stringify(snapshot.draft) !== JSON.stringify(draft)) throw new Error('This draft changed while saving. Review it before sending.');
  return snapshot;
}
/** Provider send has already succeeded. Cleanup errors are always warnings. */
export async function finishDraftSend(input: DraftIdentity & {suggestionId?: string}, mark: (input: DraftIdentity & {suggestionId?: string}) => Promise<DraftWriteResult>, refresh: () => Promise<void> | undefined): Promise<string | undefined> {
  let warning: string | undefined;
  try {
    const result = await mark(input);
    if (result.conflict) warning = 'Sent. A newer draft on another device was kept. Review it before sending again.';
  } catch { warning = 'Sent. Could not clear the synced draft. Do not send it again.'; }
  try { await refresh(); } catch { warning ??= 'Sent. Could not refresh the synced draft. Do not send it again.'; }
  return warning;
}
