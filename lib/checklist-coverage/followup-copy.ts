// Pure and client-safe: the follow-up draft's approval copy on the checklist
// summary. Joe approves follow-ups himself, so his copy talks to him ("your
// approval"), never about him; staff are told Joe approves it (plan §6.8).

export type SummaryViewer = "owner" | "staff";

export function followupCopy(viewer: SummaryViewer | undefined) {
  const owner = viewer === "owner";
  return {
    /** Under Submit for approval, before it's pressed. */
    hint: owner ? "You approve it in Today; approving sends it." : "Joe approves it in Today; approval sends it.",
    /** The one status line right after it's submitted (owner: with a Today link). */
    submitted: owner ? "Waiting for your approval — it's in Today." : "Submitted for approval. Joe approves it in Today; approval sends it.",
    /** Earlier follow-ups for this checklist, by approval status. */
    status: (approval: string): string => ({
      requested: owner ? "waiting for your approval in Today" : "waiting for approval in Today",
      approved: "approved", rejected: "sent back", not_requested: "not submitted",
    } as Record<string, string>)[approval] ?? approval,
  };
}

/** Follow-ups to list above the draft: not the one just submitted in this view
 *  (its status line already says it), so the screen says it once. */
export function earlierDrafts<D extends { id: string }>(drafts: D[], submittedHere: boolean, before: string[] | null): D[] {
  if (!submittedHere) return drafts;
  const known = new Set(before ?? []);
  return drafts.filter((d) => known.has(d.id));
}
