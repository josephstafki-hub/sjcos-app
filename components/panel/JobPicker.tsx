"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FolderPlus, Loader2, Search, Unlink } from "lucide-react";
import { searchJobsAction } from "@/lib/actions/ai-chat";
import type { JobPick } from "@/lib/thread-folders";
import type { FolderEntityKind, FolderEntityRef } from "@/lib/thread-rail";

/**
 * The rail's job picker: a sheet dropping from its anchor row (full rail
 * width) with a search box over
 * projects / leads / vendors / subs. Used to link a folder to a job and to
 * start a new folder (pick a job, or type a name and create a free folder).
 * Empty query lists the current jobs, most recently touched first.
 *
 * Keyboard: ↑/↓ move, Enter picks, Esc closes (the parent's outside-click
 * handler also closes it; mousedown inside is stopped so it doesn't).
 */

const KIND_LABEL: Record<FolderEntityKind, string> = {
  project: "Projects",
  lead: "Leads",
  vendor: "Vendors",
  sub: "Subs",
};
const KIND_ORDER: FolderEntityKind[] = ["project", "lead", "vendor", "sub"];

type Row =
  | { key: string; type: "job"; job: JobPick }
  | { key: string; type: "create"; name: string }
  | { key: string; type: "unlink" };

export function JobPicker({
  title,
  placeholder = "Search jobs…",
  current = null,
  allowUnlink = false,
  allowCreate = false,
  onPick,
  onCreate,
  onUnlink,
  onDone,
}: {
  /** Accessible name only; the placeholder carries the visible context. */
  title?: string;
  placeholder?: string;
  /** The job currently linked (shows a check, excluded from "in use" dimming). */
  current?: FolderEntityRef | null;
  allowUnlink?: boolean;
  /** Offer "Create folder “<typed>”" when the query matches nothing exactly. */
  allowCreate?: boolean;
  onPick: (job: JobPick) => void | Promise<void>;
  onCreate?: (name: string) => void | Promise<void>;
  onUnlink?: () => void | Promise<void>;
  onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [jobs, setJobs] = useState<JobPick[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search; the latest request wins.
  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await searchJobsAction(q);
        if (seq.current === id) setJobs(r);
      } catch {
        if (seq.current === id) setJobs([]);
      }
    }, q ? 120 : 0);
    return () => clearTimeout(t);
  }, [q]);

  const term = q.trim();
  const rows: Row[] = [];
  if (allowUnlink && !term) rows.push({ key: "unlink", type: "unlink" });
  const grouped = new Map<FolderEntityKind, JobPick[]>();
  for (const j of jobs ?? []) grouped.set(j.kind, [...(grouped.get(j.kind) ?? []), j]);
  for (const k of KIND_ORDER) for (const j of grouped.get(k) ?? []) rows.push({ key: `${j.kind}/${j.slug}`, type: "job", job: j });
  const exact = (jobs ?? []).some((j) => j.name.toLowerCase() === term.toLowerCase());
  if (allowCreate && term && !exact) rows.push({ key: "create", type: "create", name: term });

  // Keep the highlight on a real row as results change (clamped at render).
  const cur = Math.min(cursor, Math.max(0, rows.length - 1));

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cur}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cur]);

  const choose = async (row: Row | undefined) => {
    if (!row || busy) return;
    setBusy(true);
    try {
      if (row.type === "job") await onPick(row.job);
      else if (row.type === "create") await onCreate?.(row.name);
      else await onUnlink?.();
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, rows.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void choose(rows[cur]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDone();
    }
  };

  const isCurrent = (j: JobPick) => !!current && current.kind === j.kind && current.id === j.slug;

  let lastKind: FolderEntityKind | null = null;
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="absolute inset-x-0 top-full z-30 mt-0.5 overflow-hidden rounded-md border border-rule bg-paper shadow-card"
      role="dialog"
      aria-label={title ?? "Pick a job"}
    >
      <div className="flex items-center gap-1.5 border-b border-rule px-2 py-1.5">
        {busy ? (
          <Loader2 className="size-3 flex-none animate-spin text-ink-4" strokeWidth={2} />
        ) : (
          <Search className="size-3 flex-none text-ink-4" strokeWidth={2} />
        )}
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKey}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ink placeholder:text-ink-4 focus:outline-none"
        />
      </div>

      <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
        {jobs === null && <p className="px-2.5 py-1.5 text-[11px] text-ink-4">Loading jobs…</p>}
        {jobs !== null && rows.length === 0 && (
          <p className="px-2.5 py-2 text-[11px] text-ink-4">No jobs match “{term}”.</p>
        )}
        {rows.map((row, idx) => {
          const active = idx === cur;
          const base = `flex w-full items-center gap-2 px-2.5 py-1 text-left ${active ? "bg-paper-2" : ""}`;
          if (row.type === "unlink") {
            return (
              <button
                key={row.key}
                data-idx={idx}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => void choose(row)}
                className={`${base} text-[11.5px] text-ink-3`}
              >
                <Unlink className="size-3 flex-none" strokeWidth={1.75} />
                <span>Unlink from job</span>
              </button>
            );
          }
          if (row.type === "create") {
            return (
              <button
                key={row.key}
                data-idx={idx}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => void choose(row)}
                className={`${base} border-t border-rule-soft text-[11.5px] text-ink-2`}
              >
                <FolderPlus className="size-3 flex-none text-ink-4" strokeWidth={1.75} />
                <span className="truncate">
                  Create folder <span className="text-ink">“{row.name}”</span>
                </span>
              </button>
            );
          }
          const j = row.job;
          const header = j.kind !== lastKind;
          lastKind = j.kind;
          const linked = isCurrent(j);
          const taken = !linked && j.folderId != null;
          return (
            <div key={row.key}>
              {header && (
                <div className="px-2.5 pb-0.5 pt-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-4">
                  {KIND_LABEL[j.kind]}
                </div>
              )}
              <button
                data-idx={idx}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => void choose(row)}
                title={taken ? `Already has a folder${j.folderName ? `: ${j.folderName}` : ""}` : j.name}
                className={base}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[12px] ${j.current ? "text-ink" : "text-ink-3"}`}>{j.name}</span>
                  {j.sub && <span className="block truncate text-[10.5px] text-ink-4">{j.sub}</span>}
                </span>
                {linked ? (
                  <Check className="size-3 flex-none text-ai-2" strokeWidth={2} />
                ) : taken ? (
                  <span className="flex-none font-mono text-[9px] uppercase tracking-[0.1em] text-ink-4">filed</span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
