"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { getWorkbenchAction } from "@/lib/actions/workbench";
import { Button, Chip } from "@/components/ui";
import { WorkItemEditor } from "@/components/engine/WorkItemEditor";
import { restoreWorkItem, setWorkItemStatus } from "@/lib/actions/engine";
import { agentLabel } from "@/lib/engine-views";
import { STATUS_LABEL } from "@/lib/engine-constants";
import { completeTodayItem, snoozeTodayItem, restoreTodayItem } from "@/lib/actions/today";
import type { WorkItemView } from "@/lib/engine";
import { runAction } from "@/lib/run-action";
import type { WorkbenchSnapshot, EntityRef } from "@/lib/workbench";

// Operator Console · right panel (spec §4.5). Polls the focused entity every 3s
// while a run is active (30s idle) and highlights fields/events that changed
// since the last poll — so a receipt Hermes writes mid-run lights up here within
// ≤3s. The selected to-do remains actionable above its linked record snapshot.

const ACTIVE_MS = 3000;
const IDLE_MS = 30000;

function sameRef(a: EntityRef, b: EntityRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "warranty" && b.kind === "warranty") return a.id === b.id;
  return (a as { slug?: string }).slug === (b as { slug?: string }).slug;
}

const BADGE: Record<WorkbenchSnapshot["events"][number]["source"], string> = {
  lead_activity: "activity",
  agent_receipt: "receipt",
  agent_run: "run",
};

export function WorkbenchPanel({
  subjectId,
  runActive,
}: {
  subjectId: string | null;
  runActive: boolean;
}) {
  // Snapshot is keyed to the subject it came from, so switching entities never
  // shows the previous record's data while the new one loads.
  const [entry, setEntry] = useState<{ forId: string; snapshot: WorkbenchSnapshot | null; item: WorkItemView | null; canEdit: boolean; assignees: WorkItemView["assignedTo"] } | null>(null);
  const [error, setError] = useState("");
  const [changedFields, setChangedFields] = useState<Set<string>>(new Set());
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());
  const prev = useRef<WorkbenchSnapshot | null>(null);

  useEffect(() => {
    if (!subjectId) {
      prev.current = null;
      return;
    }
    let cancelled = false;

    const tick = async () => {
      const r = await runAction(() => getWorkbenchAction(subjectId), { fallback: "Couldn't load the record." });
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error ?? "Couldn't load the record.");
        return;
      }
      setError("");
      const next = r.snapshot;
      if (next && prev.current && sameRef(prev.current.ref, next.ref)) {
        const prevVals = new Map(prev.current.fields.map((f) => [f.label, f.value]));
        setChangedFields(
          new Set(next.fields.filter((f) => prevVals.get(f.label) !== f.value).map((f) => f.label)),
        );
        const prevIds = new Set(prev.current.events.map((e) => e.id));
        setNewEventIds(new Set(next.events.filter((e) => !prevIds.has(e.id)).map((e) => e.id)));
      } else {
        setChangedFields(new Set());
        setNewEventIds(new Set());
      }
      prev.current = next;
      setEntry({ forId: subjectId, snapshot: next, item: r.item, canEdit: r.canEdit, assignees: r.assignees });
    };

    void tick();
    const iv = setInterval(tick, runActive ? ACTIVE_MS : IDLE_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [subjectId, runActive]);

  const head = (
    <div className="border-b border-rule px-4 py-2 font-mono text-meta uppercase tracking-[0.14em] text-ink-3">
      Workbench · live record
    </div>
  );

  const fresh = entry && entry.forId === subjectId ? entry : null;
  const snap = fresh?.snapshot ?? null;

  if (!subjectId) return <Shell head={head}><Placeholder text="Hand a card to an agent, or press Inspect — the record it touches shows here." /></Shell>;
  if (error && !fresh) return <Shell head={head}><Placeholder text={error} /></Shell>;
  if (!fresh) return <Shell head={head}><Placeholder text="Loading record…" /></Shell>;
  if (!snap) return <Shell head={head}>{fresh.item ? <TodoDetails item={fresh.item} canEdit={fresh.canEdit} assignees={fresh.assignees} /> : <Placeholder text="No linked record for this item." />}</Shell>;

  return (
    <section className="flex min-h-[200px] flex-col overflow-hidden rounded-lg border border-rule bg-paper shadow-card">
      {head}
      {error && <p role="alert" className="p-3 text-body text-flag">{error}</p>}
      {fresh.item && <TodoDetails item={fresh.item} canEdit={fresh.canEdit} assignees={fresh.assignees} />}
      <div className="border-b border-rule px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${runActive ? "animate-pulse bg-ai" : "bg-ink-4"}`} />
          <Link href={snap.href} className="font-serif text-subheading font-semibold text-ink hover:underline">
            {snap.title}
          </Link>
        </div>
        <div className="text-meta text-ink-3">{snap.subtitle}</div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-2.5">
        {snap.fields.map((f) => (
          <div
            key={f.label}
            className={changedFields.has(f.label) ? "rounded bg-ai-soft px-1 transition-colors" : "px-1"}
          >
            <div className="font-mono text-meta uppercase tracking-wide text-ink-4">{f.label}</div>
            <div className="truncate text-body text-ink">{f.value}</div>
          </div>
        ))}
      </div>

      {snap.openWorkItems.length > 0 && (
        <div className="border-t border-rule px-4 py-2 text-meta text-ink-2">
          {snap.openWorkItems.map((w) => (
            <div key={w.id} className="truncate">
              • {w.title} <span className="text-ink-4">({w.status})</span>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-rule px-4 py-1.5 font-mono text-meta uppercase tracking-wide text-ink-4">
        Event timeline
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-3">
        {snap.events.length === 0 && <div className="py-2 text-body text-ink-4">No events yet.</div>}
        {snap.events.map((e) => (
          <div
            key={e.id}
            className={`flex gap-2 py-1 text-body ${newEventIds.has(e.id) ? "rounded bg-ai-soft" : ""}`}
          >
            <span className="w-14 flex-none font-mono text-meta text-ink-4">{e.when}</span>
            <span className="w-12 flex-none font-mono text-meta text-ink-3">{BADGE[e.source]}</span>
            <span className="min-w-0 flex-1 text-ink-2">{e.summary}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Shell({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-h-[200px] flex-col overflow-hidden rounded-lg border border-rule bg-paper shadow-card">
      {head}
      {children}
    </section>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center text-body text-ink-3">
      {text}
    </div>
  );
}

function TodoDetails({ item: initial, canEdit, assignees }: { item: WorkItemView; canEdit: boolean; assignees: WorkItemView["assignedTo"] }) {
  const [item, setItem] = useState(initial);
  const [previous, setPrevious] = useState(initial);
  if (previous !== initial) { setPrevious(initial); setItem(initial); }
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState("");
  const closed = item.status === "done" || item.status === "cancelled";
  const act = (kind: "done" | "reopen" | "snooze") => start(async () => {
    const result = await runAction(async () => {
      if (kind === "done") await completeTodayItem(item.id);
      else if (kind === "reopen") {
        if (canEdit && item.assigneeKind === "agent") {
          if (item.archivedAt) { const restored = await restoreWorkItem(item.id); if (!restored.ok) return restored; }
          return setWorkItemStatus(item.id, "queued");
        }
        await restoreTodayItem(item.id, "done");
      } else await snoozeTodayItem(item.id);
      return { ok: true };
    }, { onError: setFeedback });
    if (result.ok) { setItem({ ...item, status: kind === "done" ? "done" : kind === "reopen" ? "queued" : item.status }); setFeedback(kind === "snooze" ? "Snoozed for 3 days" : kind === "done" ? "Marked done" : "Reopened"); }
  });
  const href = item.projectSlug ? `/projects/${item.projectSlug}` : item.leadSlug ? `/leads/${item.leadSlug}` : null;
  return <div className="space-y-3 border-b border-rule p-4">
    <h1 className="break-words text-heading font-semibold text-ink">{item.title}</h1>
    <Chip>{STATUS_LABEL[item.status]}</Chip>
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-body">
      <dt className="text-ink-3">Job / lead</dt><dd>{href ? <Link href={href} className="text-accent-2 hover:underline">{item.projectName ?? item.leadName}</Link> : "None linked"}</dd>
      <dt className="text-ink-3">Assignee</dt><dd>{item.assignedTo.map(a => a.name).join(", ") || "Owner"}{item.assigneeKey && item.assigneeKey !== "human-joe" ? ` · ${agentLabel(item.assigneeKey)}` : ""}</dd>
    </dl>
    <p className="whitespace-pre-wrap break-words text-body text-ink-2">{item.body || "No description added."}</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={pending} onClick={() => act(closed ? "reopen" : "done")}>{closed ? "Reopen" : "Mark done"}</Button>
      {!closed && <Button variant="secondary" disabled={pending} onClick={() => act("snooze")}>Snooze 3 days</Button>}
      {href && <Button href={href} variant="ghost">Open {item.projectSlug ? "job" : "lead"}</Button>}
      {canEdit && <Button variant="ghost" onClick={() => setEditing(!editing)}>{href ? "Edit to-do" : "Link a job / lead"}</Button>}
    </div>
    {!href && <p className="text-meta text-ink-3">No linked record. {canEdit ? "Link a job or lead to show its live record here." : "Ask Joe to link a job or lead."}</p>}
    {feedback && <p role="status" className="text-body text-ink-2">{feedback}</p>}
    {editing && <WorkItemEditor item={item} assignees={assignees} canAssign={canEdit} onClose={() => setEditing(false)} />}
  </div>;
}
