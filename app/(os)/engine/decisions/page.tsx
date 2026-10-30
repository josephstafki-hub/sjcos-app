import { Shell } from "@/components/shell/Shell";
import { PageHeader, Eyebrow } from "@/components/ui";
import { requireAccess } from "@/lib/dal";
import { runDirect, sessionPrincipal } from "@/lib/commands/db";
import { authorityFor } from "@/lib/commands/decisions";
import { LANES, listLanePauses, listPolicies } from "@/lib/commands/policies";
import { isOwner } from "@/lib/commands/principal";
import { listOpenDecisions, recentResolvedDecisions, type DecisionRow } from "@/lib/decisions/resolve";
import { DecisionsClient, type DecisionView, type PolicyVersionView } from "@/components/engine/DecisionsClient";

export const dynamic = "force-dynamic";

function view(d: DecisionRow, canResolve: boolean, reason: string | null): DecisionView {
  return {
    id: d.id,
    kind: d.kind,
    action: d.action,
    title: d.title,
    summary: d.summary,
    status: d.status,
    recipient: d.recipient,
    amountCents: d.amount_cents == null ? null : Number(d.amount_cents),
    contentHash: d.content_hash,
    href: d.href,
    requestedBy: d.requested_by,
    createdAt: d.created_at,
    expiresAt: d.expires_at,
    heldUntil: d.held_until,
    holdNote: d.hold_note,
    decidedVia: d.decided_via,
    decidedAt: d.decided_at,
    decisionNote: d.decision_note,
    workItemId: d.work_item_id,
    projectId: d.project_id,
    canResolve,
    authorityReason: reason,
  };
}

/** One-tap decisions (A10): every pending review card, the full preview, and
 *  Approve / Reject / Request changes / Hold. The owner sees everything;
 *  staff see the decisions they hold authority for (authority_grants). The
 *  same decision row is what the Telegram buttons point at, so an answer
 *  here resolves it everywhere. Owner-only lane kill switches and policy
 *  switches live below. */
export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  await requireAccess("engine");
  const principal = await sessionPrincipal();
  const owner = principal ? isOwner(principal) : false;
  const { d: focus } = await searchParams;

  const [open, resolved, pauses, policyRows] = await Promise.all([
    listOpenDecisions(runDirect, { includeHeld: true, limit: 150 }),
    owner ? recentResolvedDecisions(runDirect, 30) : Promise.resolve([] as DecisionRow[]),
    owner ? listLanePauses(runDirect) : Promise.resolve([]),
    owner ? listPolicies(runDirect) : Promise.resolve([]),
  ]);
  const policies: PolicyVersionView[] = policyRows.map((p) => ({
    key: p.key,
    version: p.version,
    state: p.state,
    notes: p.notes,
    config: p.config,
    effectiveFrom: p.effective_from,
    createdBy: p.created_by,
    heldSends: Number(p.held_sends),
  }));

  const pending: DecisionView[] = [];
  for (const d of open) {
    const auth = principal ? await authorityFor(runDirect, principal, d) : { ok: false as const, reason: "Sign in." };
    if (!auth.ok && !owner) continue; // staff only see what they can answer
    pending.push(view(d, auth.ok, auth.ok ? null : auth.reason));
  }
  const held = pending.filter((p) => p.heldUntil && new Date(p.heldUntil).getTime() > Date.now());
  const ready = pending.filter((p) => !held.includes(p));

  return (
    <Shell breadcrumb="OPERATIONS ENGINE · DECISIONS">
      <div className="mx-auto max-w-[980px] px-4 @3xl/page:px-6 pb-16 pt-6">
        <div className="mb-4">
          <PageHeader title={<> Decisions </>} meta={<> {ready.length} waiting on you · {held.length} on hold{owner ? ` · ${pauses.length} lane${pauses.length === 1 ? "" : "s"} paused` : ""} </>} />
          <p className="mt-2 max-w-[680px] text-body leading-relaxed text-ink-3">
            Each card is one exact thing an agent wants to send, buy or release — the recipients, what is in it, what is
            left out, and what approving does. Approve here or from the Telegram buttons; the first answer wins and the
            send goes out through the dispatcher, which re-checks everything at the moment it transmits.
          </p>
        </div>
        <DecisionsClient
          ready={ready}
          held={held}
          resolved={resolved.map((d) => view(d, false, null))}
          owner={owner}
          lanes={[...LANES]}
          pauses={pauses}
          policies={policies}
          focusId={focus ?? null}
        />
      </div>
    </Shell>
  );
}
