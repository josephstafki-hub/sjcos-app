// Client-safe, DB-free half of lib/approved-draft-send.ts: the To:/Subject:
// header parser, the "does Approve send this?" decision, and the copy the
// owner reads afterwards. No imports on purpose — UI components and the unit
// test (tests/approved-draft-rules.test.mjs) both load this directly.

export interface ParsedEmailDraft {
  /** Lower-cased bare address ("Name <a@b>" → "a@b"). */
  to: string;
  subject: string;
  body: string;
}

/** Parse the "To:/Subject:" header block agents put at the top of email
 *  drafts. Returns null when the draft isn't shaped like an email (no To:
 *  line up front, or nothing after the headers). Leading blank lines are
 *  ignored; the header block ends at the first blank or non-header line. */
export function parseEmailDraft(content: string): ParsedEmailDraft | null {
  const lines = content.trimStart().split(/\r?\n/);
  let to: string | null = null;
  let subject = "";
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      break;
    }
    const m = line.match(/^(To|Subject|From|Cc):\s*(.*)$/i);
    if (!m) break;
    const key = m[1].toLowerCase();
    if (key === "to") {
      const angled = m[2].match(/<([^>]+)>/);
      to = (angled ? angled[1] : m[2]).trim().toLowerCase();
    } else if (key === "subject") {
      subject = m[2].trim();
    }
  }
  if (!to) return null;
  const body = lines.slice(i).join("\n").trim();
  if (!body) return null;
  return { to, subject, body };
}

export type RecordKind = "lead" | "project";

export interface ApprovedSendInput {
  /** The record the work item hangs off (lead wins over project), or null. */
  record: { kind: RecordKind; email: string | null } | null;
  /** Text of the freshest staged draft, or null when nothing is staged. */
  draft: string | null;
}

export type ApprovedSendPlan =
  | { outcome: "send"; to: string; subject: string; body: string }
  | { outcome: "not_email"; reason: string }
  | { outcome: "failed"; error: string };

function defaultSubject(kind: RecordKind): string {
  return kind === "lead" ? "Re: your project inquiry — SJ Carpentry" : "Re: your project — SJ Carpentry";
}

/** Decide what an Approve click does with the staged draft. "not_email" means
 *  leave it alone and tell the owner why; "failed" means the draft IS an email
 *  but can't go to this record (the gate reopens so the mismatch gets fixed). */
export function planApprovedSend(input: ApprovedSendInput): ApprovedSendPlan {
  if (!input.draft) return { outcome: "not_email", reason: "no staged draft on the work item" };
  const parsed = parseEmailDraft(input.draft);
  if (!parsed) return { outcome: "not_email", reason: "staged draft has no To: header" };
  if (!input.record) return { outcome: "not_email", reason: "no lead or project on the work item" };
  const email = (input.record.email ?? "").trim().toLowerCase();
  if (!email || parsed.to !== email) {
    return {
      outcome: "failed",
      error: `draft is addressed to ${parsed.to}, but the ${input.record.kind}'s email is ${email || "missing"}`,
    };
  }
  return { outcome: "send", to: email, subject: parsed.subject || defaultSubject(input.record.kind), body: parsed.body };
}

/** The line the owner reads (toast + card) when an approval emailed nothing. */
export function approveNotice(reason: string): string {
  return `Approved. Nothing was emailed: ${reason}.`;
}

/** What approveWorkItem / approveRecordWorkItem resolve to. Success always
 *  says which of the two things happened — an email went out, or it didn't
 *  and why — so the owner never has to guess. */
export type ApproveResult =
  | { ok: true; sent?: { to: string; subject: string }; held?: { to: string; subject: string }; notice?: string }
  | { ok: false; error: string };

/** The line the owner reads when the provider could not confirm the send:
 *  not sent, not failed — held, and NOT to be resent by hand. */
export function heldNotice(to: string, detail?: string | null): string {
  return `Approved. The email to ${to} is held: Gmail did not confirm whether it went out${detail ? ` (${detail})` : ""}. It is being reconciled and must not be resent by hand.`;
}

/** Toast copy for an Approve click. Callers pass it through runAction's
 *  onSuccess, so the failure branch is only a type-level safety net —
 *  runAction has already toasted `{ ok: false }` itself. */
export function describeApproval(r: ApproveResult): {
  kind: "success" | "info" | "error";
  title: string;
  message: string;
} {
  if (!r.ok) return { kind: "error", title: "Approve failed", message: r.error };
  if (r.sent) {
    return { kind: "success", title: "Emailed", message: `Emailed ${r.sent.to} — ${r.sent.subject}` };
  }
  if (r.held) {
    return { kind: "info", title: "Held — outcome unknown", message: r.notice || heldNotice(r.held.to) };
  }
  return { kind: "info", title: "Approved", message: r.notice || approveNotice("nothing to send") };
}
