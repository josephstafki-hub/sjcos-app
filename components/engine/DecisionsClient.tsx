"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Chip, Eyebrow, toast } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import {
  approveDecisionAction,
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

const btn = "rounded-md border border-ink-4 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40";
const primary = "rounded-md border border-accent bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-50";
const inputCls = "w-full rounded-md border border-rule bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent";

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function fmt(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type Recip = { name: string; address?: string; role?: string };
type Qty = { label: string; qty: string | number; unit?: string };
type Att = { label: string; revision?: string };
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function KindChip({ d }: { d: DecisionView }) {
  if (d.status !== "pending") return <Chip kind={d.status === "approved" || d.status === "consumed" ? "money" : "ghost"}>{d.status}</Chip>;
  if (d.heldUntil && new Date(d.heldUntil).getTime() > Date.now()) return <Chip kind="ghost">On hold until {fmt(d.heldUntil)}</Chip>;
  return <Chip kind="flag">Waiting on you</Chip>;
}

function Section({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <ul className="mt-0.5 list-disc pl-4 text-[13px] leading-relaxed text-ink-2">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function Preview({ d }: { d: DecisionView }) {
  const s = d.summary ?? {};
  const recipients = arr<Recip>(s.recipients);
  const quantities = arr<Qty>(s.quantities);
  const attachments = arr<Att>(s.attachments);
  return (
    <div className="flex flex-col gap-3">
      {recipients.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Recipients</div>
          <ul className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
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
      {!recipients.length && d.recipient ? <div className="text-[13px] text-ink-2">To: {d.recipient}</div> : null}
      {d.amountCents != null ? <div className="text-[13px] text-ink-2">Amount: {usd(d.amountCents)}</div> : null}
      <Section label="Included" items={arr<string>(s.inclusions)} />
      <Section label="Excluded" items={arr<string>(s.exclusions)} />
      {quantities.length > 0 && (
        <Section label="Quantities" items={quantities.map((q) => `${q.label}: ${q.qty}${q.unit ? ` ${q.unit}` : ""}`)} />
      )}
      {attachments.length > 0 && <Section label="Attachments" items={attachments.map((a) => `${a.label}${a.revision ? ` · rev ${a.revision}` : ""}`)} />}
      <Section label="Assumptions" items={arr<string>(s.assumptions)} />
      <Section label="Missing or open" items={arr<string>(s.gaps)} />
      <Section label="Since last review" items={arr<string>(s.changes)} />
      {typeof s.effect === "string" && s.effect ? (
        <div className="rounded-md border border-rule bg-paper-2 p-2 text-[13px] leading-relaxed text-ink">
          <span className="font-semibold">If approved:</span> {s.effect}
        </div>
      ) : null}
      {d.href ? (
        <a href={d.href} className="text-[12px] font-medium text-accent-2 underline">
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
            <span className="text-[11px] text-ink-3">asked by {d.requestedBy} · {fmt(d.createdAt)}</span>
          </div>
          <div className="mt-1 text-[14px] font-medium text-ink">{d.title}</div>
          {typeof d.summary?.effect === "string" && !open ? <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-3">{String(d.summary.effect)}</div> : null}
          {d.holdNote && live ? <div className="mt-0.5 text-[12px] text-ink-3">Hold note: {d.holdNote}</div> : null}
          {d.decisionNote && !live ? <div className="mt-0.5 text-[12px] text-ink-3">{d.decisionNote}</div> : null}
          {!live && d.decidedAt ? <div className="mt-0.5 text-[11px] text-ink-3">{d.status} via {d.decidedVia ?? "app"} · {fmt(d.decidedAt)}</div> : null}
          {live && !d.canResolve && d.authorityReason ? <div className="mt-0.5 text-[12px] text-flag">{d.authorityReason}</div> : null}
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
          <span className="basis-full text-[11px] text-ink-3">Expires {fmt(d.expiresAt)}</span>
        </div>
      )}

      {live && mode !== "none" && (
        <form
          className="mt-2 flex flex-col gap-2 sm:flex-row"
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
      <div className="text-[12px] text-ink-3">
        A paused lane stops NEW dispatch on it — nothing is lost, held sends wake when it reopens. Anything already in an
        unknown state stays held for reconciliation either way. &ldquo;all&rdquo; stops everything.
      </div>
      <input className={`${inputCls} mt-2`} placeholder="Reason (shown on every held send)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-2">
        {lanes.map((lane) => {
          const p = paused.get(lane);
          return p ? (
            <button key={lane} type="button" className={`${btn} border-flag text-flag`} disabled={pending} onClick={() => run(() => resumeLaneAction(lane))} title={`${p.reason} · ${p.paused_by} · ${fmt(p.paused_at)}`}>
              Resume {lane}
            </button>
          ) : (
            <button key={lane} type="button" className={btn} disabled={pending} onClick={() => run(() => pauseLaneAction(lane, reason))}>
              Pause {lane}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export function DecisionsClient({
  ready,
  held,
  resolved,
  owner,
  lanes,
  pauses,
  focusId,
}: {
  ready: DecisionView[];
  held: DecisionView[];
  resolved: DecisionView[];
  owner: boolean;
  lanes: string[];
  pauses: { lane: string; paused_at: string; paused_by: string; reason: string }[];
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
              <div className="text-[13px] text-ink-3">Nothing is waiting for a decision.</div>
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
      {owner && resolved.length > 0 && (
        <section>
          <Eyebrow>Recently decided</Eyebrow>
          <div className="mt-2 flex flex-col gap-2">{resolved.map(card)}</div>
        </section>
      )}
    </div>
  );
}
