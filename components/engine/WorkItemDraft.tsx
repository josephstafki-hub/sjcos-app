import type { WorkItemDraftPreview } from "@/lib/work-item-draft";

/** The same preview carries the binding submitted by the surrounding Approve. */
export function WorkItemDraft({ draft }: { draft: WorkItemDraftPreview }) {
  return <div className="mt-2 space-y-1 rounded border border-rule bg-paper-2 p-2 text-label text-ink-2">
    {draft.to && <div className="break-words">To: {draft.to}</div>}
    {draft.subject && <div className="break-words">Subject: {draft.subject}</div>}
    {draft.body && <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words">{draft.body}</div>}
    {draft.note && <div className="text-meta text-ink-3">{draft.note}</div>}
  </div>;
}
