"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Chip, Eyebrow, Button, toast } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import { normalizeSummary } from "@/lib/decisions/summary";
import {
  activatePolicyAction,
  approveDecisionAction,
  disablePolicyAction,
  holdDecisionAction,
  pauseLaneAction,
  rejectDecisionAction,
  requestChangesAction,
  resumeLaneAction,
  revokeDecisionAction,
  type DecisionActionResult,
} from "@/lib/decisions/actions";

export interface DecisionView {
  id: string;
  kind: string;
  action: string;
  title: string;
  summary: Record<string, unknown>;
  status: string;
  recipient: string | null;
  amountCents: number | null;
  contentHash: string | null;
  href: string | null;
  requestedBy: string;
  createdAt: string;
  expiresAt: string;
  heldUntil: string | null;
  holdNote: string | null;
  decidedVia: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  workItemId: string | null;
  projectId: string | null;
  canResolve: boolean;
  authorityReason: string | null;
}

const btn = "rounded-md border border-ink-4 px-2.5 py-1 text-meta font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40";
const primary = "rounded-md border border-accent bg-accent-soft px-2.5 py-1 text-meta font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-50";
const inputCls = "w-full rounded-md border border-rule bg-paper px-3 py-2 text-body text-ink outline-none focus:border-accent";

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function fmt(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}


function KindChip({ d }: { d: DecisionView }) {
  if (d.status !== "pending") return <Chip kind={d.status === "approved" || d.status === "consumed" ? "money" : "ghost"}>{d.status}</Chip>;
  if (d.heldUntil && new Date(d.heldUntil).getTime() > Date.now()) return <><Chip kind="ghost">On hold</Chip><span className="text-meta text-ink-2">Until {fmt(d.heldUntil)}</span></>;
  return <Chip kind="flag">Waiting on you</Chip>;
}

function Section({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-meta font-semibold text-ink-3">{label}</div>
      <ul className="mt-0.5 list-disc pl-4 text-body leading-relaxed text-ink-2">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function Preview({ d }: { d: DecisionView }) {
  // Agent-written summaries come in any shape (lib/decisions/summary.ts).
  const s = normalizeSummary(d.summary);
  const { recipients, quantities, attachments } = s;
  return (
    <div className="flex flex-col gap-3">
      {recipients.length > 0 && (
        <div>
          <div className="text-meta font-semibold text-ink-3">Recipients</div>
          <ul className="mt-0.5 text-body leading-relaxed text-ink-2">
            {recipients.map((r, i) => (
              <li key={i}>
                {r.name}
                {r.role ? <span className="text-ink-3"> · {r.role}</span> : null}
                {r.address ? <span className="text-ink-3"> · {r.address}</span> : <span className="text-flag"> · no address on file</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!recipients.length && d.recipient ? <div className="text-body text-ink-2">To: {d.recipient}</div> : null}
      {d.amountCents != null ? <div className="text-body text-ink-2">Amount: {usd(d.amountCents)}</div> : null}
      {s.notes.map((n, i) => (
        <div key={i}>
          <div className="text-meta font-semibold text-ink-3">{n.label}</div>
          <p className="mt-0.5 whitespace-pre-line text-body leading-relaxed text-ink-2">{n.text}</p>
        </div>
      ))}
      <Section label="Included" items={s.inclusions} />
      <Section label="Excluded" items={s.exclusions} />
      {quantities.length > 0 && (
        <Section label="Quantities" items={quantities.map((q) => `${q.label}: ${q.qty}${q.unit ? ` ${q.unit}` : ""}`)} />
      )}
      {attachments.length > 0 && <Section label="Attachments" items={attachments.map((a) => `${a.label}${a.revision ? ` · rev ${a.revision}` : ""}`)} />}
      <Section label="Assumptions" items={s.assumptions} />
      <Section label="Missing or open" items={s.gaps} />
      <Section label="Since last review" items={s.changes} />
      {s.effect ? (
        <div className="rounded-md border border-rule bg-paper-2 p-2 text-body leading-relaxed text-ink">
          <span className="font-semibold">If approved:</span> {s.effect}
        </div>
      ) : null}
      {d.href ? (
        <a href={d.href} className="text-meta font-medium text-accent-2 underline">
          Open the full artifact
        </a>
      ) : null}
    </div>
  );
}

function DecisionCard({ d, open, onToggle, owner }: { d: DecisionView; open: boolean; onToggle: () => void; owner: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"none" | "changes" | "reject" | "hold">("none");
  const run = (fn: () => Promise<DecisionActionResult>) =>
    start(async () => {
      const r = await runAction(fn);
      if (r.ok && "reply" in r) toast({ kind: "success", title: "Decision", message: String(r.reply) });
      setMode("none");
      setNote("");
      router.refresh();
    });
  const live = d.status === "pending";
  return (
    <Card kind={live ? "default" : "soft"} className="p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <KindChip d={d} />
            <Chip kind="ghost">{d.kind.replace(/_/g, " ")}</Chip>
            <span className="text-meta text-ink-3">asked by {d.requestedBy} · {fmt(d.createdAt)}</span>
          </div>
          <div className="mt-1 text-subheading font-medium text-ink">{d.title}</div>
          {normalizeSummary(d.summary).effect && !open ? <div className="mt-0.5 line-clamp-2 text-meta text-ink-3">{normalizeSummary(d.summary).effect}</div> : null}
          {d.holdNote && live ? <div className="mt-0.5 text-meta text-ink-3">Hold note: {d.holdNote}</div> : null}
          {d.decisionNote && !live ? <div className="mt-0.5 text-meta text-ink-3">{d.decisionNote}</div> : null}
          {!live && d.decidedAt ? <div className="mt-0.5 text-meta text-ink-3">{d.status} via {d.decidedVia ?? "app"} · {fmt(d.decidedAt)}</div> : null}
          {live && !d.canResolve && d.authorityReason ? <div className="mt-0.5 text-meta text-flag">{d.authorityReason}</div> : null}
        </div>
        <button type="button" className={btn} onClick={onToggle}>
          {open ? "Hide preview" : "Full preview"}
        </button>
      </div>

      {open && (
        <div className="mt-3 border-t border-rule pt-3">
          <Preview d={d} />
        </div>
      )}

      {live && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={primary} disabled={pending || !d.canResolve} onClick={() => run(() => approveDecisionAction(d.id, d.contentHash))}>
            Approve
          </button>
          <details className="relative">
            <summary aria-label={`More actions for ${d.title}`} title="More actions" className="cursor-pointer list-none rounded-md border border-rule px-3 py-2 text-body text-ink-2">…</summary>
            <div className="absolute right-0 z-10 mt-1 flex min-w-48 flex-col gap-2 rounded-lg border border-rule bg-card p-2 shadow-pop">
          <button type="button" className={btn} disabled={pending || !d.canResolve} onClick={() => setMode(mode === "changes" ? "none" : "changes")}>
            Request changes
          </button>
          <button type="button" className={btn} disabled={pending || !d.canResolve} onClick={() => setMode(mode === "hold" ? "none" : "hold")}>
            Hold
          </button>
          <button type="button" className={btn} disabled={pending || !d.canResolve} onClick={() => setMode(mode === "reject" ? "none" : "reject")}>
            Reject
          </button>
          {owner ? (
            <button type="button" className={`${btn} ml-auto`} disabled={pending} onClick={() => run(() => revokeDecisionAction(d.id, "Revoked by owner on /engine/decisions"))}>
              Revoke
            </button>
          ) : null}
            </div>
          </details>
          <span className="basis-full text-meta text-ink-3">Expires {fmt(d.expiresAt)}</span>
        </div>
      )}

      {live && mode !== "none" && (
        <form
          className="mt-2 flex flex-col gap-2 @xl/page:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "changes") run(() => requestChangesAction(d.id, note, d.contentHash));
            else if (mode === "reject") run(() => rejectDecisionAction(d.id, note || null, d.contentHash));
            else run(() => holdDecisionAction(d.id, Number(note) || 4, null));
          }}
        >
          {mode === "hold" ? (
            <select className={inputCls} value={note || "4"} onChange={(e) => setNote(e.target.value)}>
              <option value="1">Hold 1 hour</option>
              <option value="4">Hold 4 hours</option>
              <option value="24">Hold until tomorrow</option>
              <option value="72">Hold 3 days</option>
            </select>
          ) : (
            <input className={inputCls} placeholder={mode === "changes" ? "What should change? (the requester reads this)" : "Reason (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
          <button type="submit" className={primary} disabled={pending || (mode === "changes" && !note.trim())}>
            {mode === "changes" ? "Send back" : mode === "reject" ? "Reject" : "Hold"}
          </button>
        </form>
      )}
    </Card>
  );
}

function LaneSwitches({ lanes, pauses }: { lanes: string[]; pauses: { lane: string; paused_at: string; paused_by: string; reason: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const run = (fn: () => Promise<DecisionActionResult>) =>
    start(async () => {
      const r = await runAction(fn);
      if (r.ok && "reply" in r) toast({ kind: "info", title: "Lane", message: String(r.reply) });
      router.refresh();
    });
  const paused = new Map(pauses.map((p) => [p.lane, p]));
  return (
    <Card className="p-3">
      <div className="text-meta text-ink-3">
        A paused lane stops NEW dispatch on it — nothing is lost, held sends wake when it reopens. Anything already in an
        unknown state stays held for reconciliation either way. &ldquo;all&rdquo; stops everything.
      </div>
      <input className={`${inputCls} mt-2`} placeholder="Reason (shown on every held send)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="mt-3 divide-y divide-rule-soft">
        {lanes.map((lane) => {
          const p = paused.get(lane);
          const stopped = p ?? paused.get("all");
          return <div key={lane} className="flex flex-wrap items-center gap-3 py-3">
            <span className="min-w-0 flex-1 text-body font-semibold text-ink">{lane.replace(/_/g, " ")}</span>
            <Chip kind={stopped ? "flag" : "money"}>{stopped ? "Paused" : "Running"}</Chip>
            {p ? <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => resumeLaneAction(lane))}>Resume</Button> : <details className="relative">
              <summary aria-label={`More controls for ${lane}`} title="Lane controls" className="cursor-pointer list-none rounded-md border border-rule px-3 py-2 text-body">…</summary>
              <div className="absolute right-0 z-10 mt-1 min-w-48 rounded-lg border border-rule bg-card p-2 shadow-pop">
                <Button variant="ghost" size="sm" disabled={pending || Boolean(stopped)} onClick={() => run(() => pauseLaneAction(lane, reason))}>Pause {lane === "all" ? "everything" : "lane"}</Button>
                {stopped && <p className="text-meta text-ink-2">Resume “all” to reopen this lane.</p>}
              </div>
            </details>}
            {stopped && <p className="basis-full text-meta text-ink-2">{stopped.reason || "Paused by owner"} · {stopped.paused_by} · {fmt(stopped.paused_at)}</p>}
          </div>;
        })}
      </div>
    </Card>
  );
}

export interface PolicyVersionView {
  key: string;
  version: number;
  state: "draft" | "active" | "disabled" | "retired";
  notes: string;
  config: Record<string, unknown>;
  effectiveFrom: string | null;
  createdBy: string;
  heldSends: number;
}

const POLICY_CHIP: Record<PolicyVersionView["state"], "money" | "ghost" | "flag" | "default"> = { active: "money", draft: "default", disabled: "flag", retired: "ghost" };

/** Owner's policy switches: one row per policy, its versions underneath. A
 *  policy lets one kind of automatic action happen without a card each time;
 *  off, the same action waits for Joe. */
function PolicySwitches({ policies }: { policies: PolicyVersionView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<DecisionActionResult>) =>
    start(async () => {
      const r = await runAction(fn);
      if (r.ok && "reply" in r) toast({ kind: "info", title: "Policy", message: String(r.reply) });
      router.refresh();
    });
  const keys = [...new Set(policies.map((p) => p.key))];
  return (
    <div className="flex flex-col gap-2">
      {keys.map((key) => {
        const versions = policies.filter((p) => p.key === key);
        const active = versions.find((v) => v.state === "active");
        const latest = versions[0];
        const held = versions.reduce((n, v) => n + v.heldSends, 0);
        return (
          <Card key={key} className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body font-semibold text-ink">{key}</span>
              <Chip kind={active ? "money" : "ghost"} dot>
                {active ? `on · v${active.version}` : "off"}
              </Chip>
              {held > 0 && <Chip kind="flag">{held} send{held === 1 ? "" : "s"} held for it</Chip>}
              <div className="ml-auto flex gap-2">
                {active ? (
                  <details className="relative">
                    <summary aria-label={`More controls for ${key}`} title="Policy controls" className="cursor-pointer list-none rounded-md border border-rule px-3 py-2 text-body">…</summary>
                    <div className="absolute right-0 z-10 min-w-40 rounded-lg border border-rule bg-card p-2 shadow-pop">
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => disablePolicyAction(key))}>Turn off</Button>
                    </div>
                  </details>
                ) : null}
                {latest && latest.state !== "active" && (
                  <button type="button" className={btn} disabled={pending} onClick={() => run(() => activatePolicyAction(key, latest.version))}>
                    Turn on v{latest.version}
                  </button>
                )}
              </div>
            </div>
            {(active ?? latest)?.notes && <p className="mt-1.5 text-body leading-relaxed text-ink-3">{(active ?? latest)!.notes}</p>}
            <details className="mt-1.5">
              <summary className="cursor-pointer text-meta text-ink-3">Versions and settings</summary>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {versions.map((v) => (
                  <div key={v.version} className="rounded-md border border-rule p-2">
                    <div className="flex items-center gap-2 text-meta text-ink-3">
                      <span className="font-mono">v{v.version}</span>
                      <Chip kind={POLICY_CHIP[v.state]}>{v.state}</Chip>
                      <span>{v.effectiveFrom ? `since ${fmt(v.effectiveFrom)}` : `by ${v.createdBy}`}</span>
                    </div>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-meta text-ink-2">{JSON.stringify(v.config, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </details>
          </Card>
        );
      })}
      {keys.length === 0 && (
        <Card kind="dashed" className="p-4 text-center text-body text-ink-3">
          No policies yet.
        </Card>
      )}
    </div>
  );
}

export function DecisionsClient({
  ready,
  held,
  resolved,
  owner,
  lanes,
  pauses,
  policies,
  focusId,
}: {
  ready: DecisionView[];
  held: DecisionView[];
  resolved: DecisionView[];
  owner: boolean;
  lanes: string[];
  pauses: { lane: string; paused_at: string; paused_by: string; reason: string }[];
  policies: PolicyVersionView[];
  focusId: string | null;
}) {
  const [open, setOpen] = useState<string | null>(focusId);
  useEffect(() => {
    if (focusId) document.getElementById(`decision-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [focusId]);
  const card = (d: DecisionView) => (
    <div key={d.id} id={`decision-${d.id}`}>
      <DecisionCard d={d} open={open === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} owner={owner} />
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      <section>
        <Eyebrow>Waiting on you</Eyebrow>
        <div className="mt-2 flex flex-col gap-2">
          {ready.map(card)}
          {ready.length === 0 && (
            <Card kind="dashed" className="p-6 text-center">
              <div className="text-body text-ink-3">Nothing is waiting for a decision.</div>
            </Card>
          )}
        </div>
      </section>
      {held.length > 0 && (
        <section>
          <Eyebrow>On hold</Eyebrow>
          <div className="mt-2 flex flex-col gap-2">{held.map(card)}</div>
        </section>
      )}
      {owner && (
        <section>
          <Eyebrow>Kill switches</Eyebrow>
          <div className="mt-2">
            <LaneSwitches lanes={lanes} pauses={pauses} />
          </div>
        </section>
      )}
      {owner && (
        <section id="policies">
          <Eyebrow>Policies</Eyebrow>
          <p className="mt-1 max-w-[680px] text-body text-ink-3">
            A policy that is on lets that kind of automatic action go out without a card each time, inside its settings. Off, the same
            action waits for you as a card. Only you can turn one on.
          </p>
          <div className="mt-2">
            <PolicySwitches policies={policies} />
          </div>
        </section>
      )}
      {owner && resolved.length > 0 && (
        <section>
          <Eyebrow>Recently decided</Eyebrow>
          <div className="mt-2 flex flex-col gap-2">{resolved.map(card)}</div>
        </section>
      )}
    </div>
  );
}
