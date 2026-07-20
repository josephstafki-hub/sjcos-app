"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getWorkbenchAction } from "@/lib/actions/workbench";
import type { WorkbenchSnapshot, EntityRef } from "@/lib/workbench";

// Operator Console · right panel (spec §4.5). Polls the focused entity every 3s
// while a run is active (30s idle) and highlights fields/events that changed
// since the last poll — so a receipt Hermes writes mid-run lights up here within
// ≤3s. Read-only view; edits happen on the entity's own page via the header link.

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
  const [entry, setEntry] = useState<{ forId: string; snapshot: WorkbenchSnapshot | null } | null>(null);
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
      const r = await getWorkbenchAction(subjectId);
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
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
      setEntry({ forId: subjectId, snapshot: next });
    };

    void tick();
    const iv = setInterval(tick, runActive ? ACTIVE_MS : IDLE_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [subjectId, runActive]);

  const head = (
    <div className="border-b border-rule px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
      Workbench · live record
    </div>
  );

  const fresh = entry && entry.forId === subjectId ? entry : null;
  const snap = fresh?.snapshot ?? null;

  if (!subjectId) return <Shell head={head}><Placeholder text="Hand a card to an agent, or press Inspect — the record it touches shows here." /></Shell>;
  if (error) return <Shell head={head}><Placeholder text={`⚠️ ${error}`} /></Shell>;
  if (!fresh) return <Shell head={head}><Placeholder text="Loading record…" /></Shell>;
  if (!snap) return <Shell head={head}><Placeholder text="No linked record for this item." /></Shell>;

  return (
    <section className="flex max-h-[calc(100vh-160px)] min-h-[200px] flex-col overflow-hidden rounded-[10px] border border-rule bg-paper shadow-card">
      {head}
      <div className="border-b border-rule px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${runActive ? "animate-pulse bg-ai" : "bg-ink-4"}`} />
          <Link href={snap.href} className="font-serif text-[15px] font-semibold text-ink hover:underline">
            {snap.title}
          </Link>
        </div>
        <div className="text-[11.5px] text-ink-3">{snap.subtitle}</div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-2.5">
        {snap.fields.map((f) => (
          <div
            key={f.label}
            className={changedFields.has(f.label) ? "rounded bg-ai-soft px-1 transition-colors" : "px-1"}
          >
            <div className="font-mono text-[9.5px] uppercase tracking-wide text-ink-4">{f.label}</div>
            <div className="truncate text-[12.5px] text-ink">{f.value}</div>
          </div>
        ))}
      </div>

      {snap.openWorkItems.length > 0 && (
        <div className="border-t border-rule px-4 py-2 text-[11.5px] text-ink-2">
          {snap.openWorkItems.map((w) => (
            <div key={w.id} className="truncate">
              • {w.title} <span className="text-ink-4">({w.status})</span>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-rule px-4 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-ink-4">
        Event timeline
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-3">
        {snap.events.length === 0 && <div className="py-2 text-[12px] text-ink-4">No events yet.</div>}
        {snap.events.map((e) => (
          <div
            key={e.id}
            className={`flex gap-2 py-1 text-[12px] ${newEventIds.has(e.id) ? "rounded bg-ai-soft" : ""}`}
          >
            <span className="w-14 flex-none font-mono text-[10px] text-ink-4">{e.when}</span>
            <span className="w-12 flex-none font-mono text-[10px] text-ink-3">{BADGE[e.source]}</span>
            <span className="min-w-0 flex-1 text-ink-2">{e.summary}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Shell({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-h-[200px] flex-col overflow-hidden rounded-[10px] border border-rule bg-paper shadow-card">
      {head}
      {children}
    </section>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center text-[12.5px] text-ink-3">
      {text}
    </div>
  );
}
