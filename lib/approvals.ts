import "server-only";

// Everything waiting on Joe's yes/no, in one shape, for the surfaces that let
// him answer in place: the corner popup (components/shell/NotificationCenter)
// and the inline cards on /notifications. Two sources:
//   • pending decisions (A10) — including permission requests (kind 'grant'),
//     which carry the exact message when the agent staged it;
//   • work items with a staged draft awaiting approval (submit_draft_for_
//     approval), whose Approve sends the draft when it's to the client.
// Each item says plainly whether Approve SENDS something, so the button can
// read "Approve & send".

import { runDirect } from "@/lib/commands/db";
import { listOpenDecisions } from "@/lib/decisions/resolve";
import { normalizeSummary } from "@/lib/decisions/summary";
import { query } from "@/lib/db";
import { describeStagedSend, stagedSendOf, type OwnerGrant } from "@/lib/owner-grant-types";
import { workItemDraftPreviews } from "@/lib/work-item-draft";

export interface PendingApproval {
  /** "decision:<uuid>" | "work_item:<uuid>" — same as notifications.ref. */
  key: string;
  kind: "decision" | "work_item";
  id: string;
  /** Stale-card guard for decisions: the hash this card was rendered for. */
  contentHash: string | null;
  tag: string;
  title: string;
  requestedBy: string | null;
  to: string | null;
  subject: string | null;
  body: string | null;
  /** What approving does, in one line. */
  effect: string | null;
  /** Approve transmits something (email / text / package). */
  sends: boolean;
  href: string;
  createdAt: string;
}

const ISO = (d: string | Date) => new Date(d).toISOString();

export async function listPendingApprovals(opts: { limit?: number } = {}): Promise<PendingApproval[]> {
  const limit = opts.limit ?? 20;
  const decisions = await listOpenDecisions(runDirect, { limit });
  const decisionIds = decisions.map((d) => d.id);
  const grants = decisionIds.length
    ? (
        await query<Pick<OwnerGrant, "id" | "scope" | "requested_by"> & { decision_id: string }>(
          `SELECT id, scope, requested_by, decision_id FROM owner_grants WHERE decision_id = ANY($1::uuid[]) AND status = 'requested' AND expires_at > now()`,
          [decisionIds],
        )
      ).rows
    : [];
  const grantByDecision = new Map(grants.map((g) => [g.decision_id, g]));
  // Decisions whose sends are parked on them: approving dispatches those.
  const parked = decisionIds.length
    ? (
        await query<{ decision_id: string }>(
          `SELECT DISTINCT decision_id FROM action_intents WHERE decision_id = ANY($1::uuid[]) AND state = 'held'`,
          [decisionIds],
        )
      ).rows.map((r) => r.decision_id)
    : [];
  const parkedSet = new Set(parked);

  const out: PendingApproval[] = [];
  for (const d of decisions) {
    // A grant decision whose request lapsed or was settled on the grant page.
    if (d.kind === "grant" && !grantByDecision.has(d.id)) continue;
    const s = normalizeSummary(d.summary);
    const grant = grantByDecision.get(d.id);
    const staged = grant ? stagedSendOf(grant as OwnerGrant) : null;
    const note = (label: string) => s.notes.find((n) => n.label.toLowerCase() === label)?.text ?? null;
    out.push({
      key: `decision:${d.id}`,
      kind: "decision",
      id: d.id,
      contentHash: d.content_hash,
      tag: d.kind === "grant" ? "Permission" : "Decision",
      title: d.title,
      requestedBy: d.requested_by,
      to: staged?.email?.to ?? staged?.sms?.to ?? (s.recipients.map((r) => r.address || r.name).filter(Boolean).join(", ") || d.recipient || null),
      subject: staged?.email?.subject || note("subject"),
      body: staged?.email?.body ?? staged?.sms?.body ?? note("message") ?? null,
      effect: staged ? describeStagedSend(staged) : (s.effect ?? null),
      sends: Boolean(staged) || parkedSet.has(d.id),
      href: d.kind === "grant" ? "/engine/permissions" : `/engine/decisions?d=${d.id}`,
      createdAt: ISO(d.created_at),
    });
  }

  const drafts = await workItemDraftPreviews({ limit: 10 });
  for (const w of drafts) {
    out.push({
      key: `work_item:${w.id}`,
      kind: "work_item",
      id: w.id,
      contentHash: null,
      tag: "Approval",
      title: w.title,
      requestedBy: null,
      to: w.to,
      subject: w.subject,
      body: w.body,
      effect: w.sends ? `Sends this email to ${w.to}.` : w.note ? `Approve doesn't email it: ${w.note}.` : "Approve hands it back to the agent to finish.",
      sends: w.sends,
      href: w.href,
      createdAt: ISO(w.createdAt),
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
