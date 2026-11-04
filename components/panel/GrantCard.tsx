"use client";
import {useState} from "react";
import {ShieldQuestion} from "lucide-react";
import type {PendingGrant} from "@/lib/actions/dev-agents";
import {approveGrant,denyGrant} from "@/lib/actions/owner-grants";
import {approvalState,approvalOutcome} from "@/lib/agent-approval";
import {GrantDetails} from "@/components/engine/GrantDetails";
import {Button} from "@/components/ui/Button";
import {Card} from "@/components/ui/Card";
export function GrantCard({ grant, onDone }: { grant: PendingGrant; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("");
  const [decided, setDecided] = useState(false);
  const state = approvalState(grant);
  const decide = async (approve: boolean) => {
    setBusy(true);
    setOutcome("");
    try {
      const result = approvalOutcome(approve ? await approveGrant(grant.id) : await denyGrant(grant.id, note.trim() || undefined));
      setOutcome(result.message);
      if (result.ok) setDecided(true);
    } catch {
      setOutcome("Could not save your decision. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-flag">
        <ShieldQuestion className="size-3.5" strokeWidth={1.75} />
        Send permission — {grant.requestedBy} asks
      </div>
      <div className="text-[13px] font-medium text-ink">
        {grant.detail?.headline ?? grant.label}
      </div>
      {grant.detail?.job && <div className="text-[11.5px] text-ink-3">{grant.detail.job}</div>}
      {grant.reason && <div className="mt-0.5 text-[12px] text-ink-3">{grant.reason}</div>}
      {grant.detail ? <GrantDetails detail={grant.detail} /> : <a href="/engine/permissions" className="text-body text-accent underline">Open Permissions to review the recipient and action before approving.</a>}
      <p className="mt-1 text-meta text-ink-3">{state} · Applies only to the action and recipients shown here. Expires {new Date(grant.expiresAt).toLocaleString()}.</p>
      {outcome && <p role="status" className="mt-2 text-body">{outcome}</p>}
      {state === "Waiting" && !decided && <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" disabled={busy || !grant.detail} onClick={() => void decide(true)}>Approve once</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide(false)}>Deny</Button>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (kept with a denial)…"
          className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-2 py-1 text-[11.5px] text-ink outline-none placeholder:text-ink-4"
        />
      </div>}
    </Card>
  );
}

