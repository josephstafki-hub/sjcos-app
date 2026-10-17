// Telegram inline keyboards that carry no server imports, so lib/notify-owner
// (imported nearly everywhere) can build them without pulling in the decision
// resolver. Parsed by lib/decisions/telegram.ts.

// Work-item approvals (submit_draft_for_approval drafts): w|<uuid>|<a|r>.
// Before 2026-10-17 these pushed with no buttons at all, so "Approve" on the
// phone meant opening the app.
export type WorkItemVerb = "approve" | "reject";

export function parseWorkItemCallback(data: string | null | undefined): { workItemId: string; verb: WorkItemVerb } | null {
  if (!data) return null;
  const m = /^w\|([0-9a-f-]{36})\|([ar])$/i.exec(data.trim());
  if (!m) return null;
  return { workItemId: m[1].toLowerCase(), verb: m[2].toLowerCase() === "a" ? "approve" : "reject" };
}

export function workItemKeyboard(workItemId: string, opts: { sends?: boolean } = {}): { text: string; callback_data: string }[][] {
  return [
    [
      { text: opts.sends ? "Approve & send ✓" : "Approve ✓", callback_data: `w|${workItemId}|a` },
      { text: "Decline", callback_data: `w|${workItemId}|r` },
    ],
  ];
}


// Decision cards: d|<decision uuid>|<12 hex of content_hash>|<a|c|h>.
export type CallbackVerb = "approve" | "changes" | "hold";
const VERB_CODE: Record<CallbackVerb, string> = { approve: "a", changes: "c", hold: "h" };

export function buildCallbackData(decisionId: string, contentHash: string | null, verb: CallbackVerb): string {
  return `d|${decisionId}|${(contentHash ?? "").slice(0, 12)}|${VERB_CODE[verb]}`;
}

export function decisionKeyboard(decisionId: string, contentHash: string | null): { text: string; callback_data: string }[][] {
  return [
    [
      { text: "Approve ✓", callback_data: buildCallbackData(decisionId, contentHash, "approve") },
      { text: "Request changes", callback_data: buildCallbackData(decisionId, contentHash, "changes") },
      { text: "Hold 4h", callback_data: buildCallbackData(decisionId, contentHash, "hold") },
    ],
  ];
}

