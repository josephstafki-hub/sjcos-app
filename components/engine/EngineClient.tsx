"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { WorkItemEditor } from "./WorkItemEditor";
import { Card, Chip, Eyebrow, Button, Tabs, EmptyState as UiEmptyState, type ChipKind } from "@/components/ui";
import {
  WORK_STATUSES,
  STATUS_LABEL,
  PRIORITY_LABEL,
  type QueueBucket,
} from "@/lib/engine-constants";
import type { EngineData, WorkItemView } from "@/lib/engine";
import {
  NO_FILTER,
  agentLabel,
  isWaitingOn,
  matchesQueueFilter,
  queueFolders,
  type QueueFilter,
  type QueueFolder,
} from "@/lib/engine-views";
import type { KnowledgeItemView } from "@/lib/brain";
import type { SkillsLibrary, SkillView, RunbookView } from "@/lib/skills";
import type { MemoriesData, MemoryRefView, MemoryView } from "@/lib/memories";
import type { RunbookInstanceView } from "@/lib/runbook-engine";
import type { WorkItemStatus, WorkItemPriority } from "@/lib/types";
import {
  createWorkItem,
  setWorkItemStatus,
  setWorkItemAssignees,
  archiveWorkItems,
  restoreWorkItem,
  listArchivedWorkItems,
  approveWorkItem,
  rejectWorkItem,
  cancelRunbook,
} from "@/lib/actions/engine";
import { captureKnowledge, deleteKnowledge, searchKnowledgeAction } from "@/lib/actions/brain";
import { approveSkill, rejectSkill } from "@/lib/actions/skills";
import { runAction, type ActionLike } from "@/lib/run-action";
import { toast } from "@/components/ui/Toast";
import { describeApproval } from "@/lib/approved-draft-rules";
import { AssigneePicker, assigneeSummary } from "@/components/today/AssigneePicker";
import {
  approveMemoryEvidence,
  approveMemoryInstruction,
  rejectMemory,
  revokeMemoryInstruction,
  setMemoryStaleAfter,
  restoreMemory,
} from "@/lib/actions/memories";

const inputCls =
  "w-full rounded-md border border-rule bg-paper px-3 py-2 text-body text-ink outline-none focus:border-accent";
const btnCls =
  "rounded-md border border-rule bg-paper-2 px-3 py-1.5 text-meta font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent-2 disabled:opacity-50";
const btnPrimary =
  "rounded-md bg-accent px-3 py-1.5 text-meta font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50";

function statusChip(status: WorkItemStatus): ChipKind {
  if (status === "approval_needed" || status === "blocked") return "flag";
  if (status === "in_progress") return "accent";
  if (status.startsWith("waiting_on")) return "info";
  if (status === "done" || status === "cancelled") return "ghost";
  return "default";
}
function priorityChip(p: WorkItemPriority): ChipKind {
  if (p === "urgent" || p === "high") return "flag";
  if (p === "low") return "ghost";
  return "default";
}

const KNOWLEDGE_KINDS = [
  "note", "business_rule", "sop", "lesson", "client_note", "vendor_note",
  "project_decision", "selection_preference", "estimate_assumption",
  "followup_context", "admin_note",
];

type Tab = "queue" | "knowledge" | "skills" | "memories";

const BUCKET_META: { key: QueueBucket; label: string; kind: ChipKind }[] = [
  { key: "approval", label: "Needs approval", kind: "flag" },
  { key: "active", label: "In progress", kind: "accent" },
  { key: "waiting", label: "Waiting / blocked", kind: "info" },
  { key: "queued", label: "Queued", kind: "default" },
  { key: "done", label: "Done · cancelled", kind: "ghost" },
];

export function EngineClient({
  engine,
  knowledge,
  skills,
  memories,
  activeRunbooks,
  canAssign,
  meId,
}: {
  engine: EngineData;
  knowledge: KnowledgeItemView[];
  skills: SkillsLibrary;
  memories: MemoriesData;
  activeRunbooks: RunbookInstanceView[];
  /** Owner only — deciding who's on a to-do is his alone (2026-09-27). */
  canAssign: boolean;
  /** The logged-in user — whose "Waiting on me" it is. */
  meId: string;
}) {
  const [tab, setTab] = useState<Tab>("queue");

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "queue", label: "Work queue", count: engine.counts.total },
    { key: "knowledge", label: "Knowledge", count: knowledge.length },
    { key: "skills", label: "Skills & runbooks", count: skills.approved.length + skills.proposed.length },
    { key: "memories", label: "Memories", count: memories.pending.length + memories.instructions.length + memories.examples.length + memories.history.length },
  ];

  return (
    <div>
      <EngineStatusStrip engine={engine} />

      {activeRunbooks.length > 0 && <ActiveRunbooks instances={activeRunbooks} />}

      <Tabs className="mb-5 mt-4" tabs={tabs.map(t=>t.label)} counts={tabs.map(t=>t.count)} active={tabs.findIndex(t=>t.key===tab)} onSelect={i=>setTab(tabs[i].key)} />

      {tab === "queue" && <QueueTab engine={engine} skills={skills} canAssign={canAssign} meId={meId} />}
      {tab === "knowledge" && <KnowledgeTab initial={knowledge} />}
      {tab === "skills" && <SkillsTab skills={skills} />}
      {tab === "memories" && <MemoriesTab memories={memories} />}
    </div>
  );
}

// ─── Status ledger + receipts strip ─────────────────────────────────────────

function EngineStatusStrip({ engine }: { engine: EngineData }) {
  const { ledgers, receipts } = engine;
  return <details className="min-w-0 rounded-lg border border-rule-soft bg-card px-4 py-3">
    <summary className="cursor-pointer text-body text-ink-2">Runtime status ledger · {ledgers.length} checked in <span className="text-ink-3"> · {receipts.length} recent receipts</span></summary>
    <div className="mt-4 grid min-w-0 gap-5 @3xl/page:grid-cols-2">
      <section className="min-w-0"><Eyebrow muted>Runtime status ledger</Eyebrow>
        {!ledgers.length ? <p className="mt-2 break-words text-body text-ink-3">No runtimes have checked in yet. Agents report their state here as they run.</p> : <ul className="mt-2 divide-y divide-rule-soft">{ledgers.map(l=><li key={l.runtimeName} className="flex gap-2 py-2"><Chip kind={l.state==='error'?'flag':'ghost'}>{l.state}</Chip><div className="min-w-0 text-body"><span>{agentLabel(l.runtimeName)}</span><p className="break-words text-meta text-ink-3">{l.currentWorkItemTitle ?? l.note ?? l.blockedReason ?? 'Idle'}</p></div></li>)}</ul>}
      </section>
      <section className="min-w-0"><Eyebrow muted>Recent receipts</Eyebrow>
        {!receipts.length ? <p className="mt-2 text-body text-ink-3">Agent actions appear here with their proof of work.</p> : <ul className="mt-2 divide-y divide-rule-soft">{receipts.slice(0,6).map(r=><li key={r.id} className="py-2"><details><summary className="cursor-pointer break-words text-body text-ink-2">{r.label || 'Receipt'}</summary><div className="mt-1 break-words text-meta text-ink-3">{r.receiptKind.replaceAll('_',' ')} · {r.runtimeName ? agentLabel(r.runtimeName) : 'Agent'} · {new Date(r.createdAt).toLocaleString()}{r.uri&&<p className="break-all">{r.uri}</p>}</div></details></li>)}</ul>}
      </section>
    </div>
  </details>;
}

// ─── Active runbooks (W6 stepper) ────────────────────────────────────────────

function runbookStatusChip(status: RunbookInstanceView["status"]): ChipKind {
  if (status === "waiting_approval") return "flag";
  if (status === "waiting_human") return "info";
  return "accent";
}

const RUNBOOK_STATUS_LABEL: Record<RunbookInstanceView["status"], string> = {
  running: "Running",
  waiting_approval: "Waiting on approval",
  waiting_human: "Waiting on Joe",
  done: "Done",
  cancelled: "Cancelled",
};

function ActiveRunbooks({ instances }: { instances: RunbookInstanceView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <Chip kind="ai" dot>Active runbooks</Chip>
        <span className="text-meta text-ink-3">{instances.length}</span>
      </div>
      <div className="divide-y divide-rule-soft">
        {instances.map((i) => (
          <Card key={i.id} kind="soft" className="p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip kind={runbookStatusChip(i.status)} dot>{RUNBOOK_STATUS_LABEL[i.status]}</Chip>
                  <span className="text-meta text-ink-3">{i.runbookSlug}</span>
                </div>
                <div className="mt-1 text-subheading font-semibold text-ink">
                  {i.runbookTitle}
                  {i.targetKind && i.targetSlug && (
                    <>
                      {" · "}
                      <Link
                        href={`/${i.targetKind === "lead" ? "leads" : "projects"}/${i.targetSlug}`}
                        className="text-accent-2 hover:underline"
                      >
                        {i.targetName ?? i.targetSlug}
                      </Link>
                    </>
                  )}
                </div>
                <div className="mt-0.5 text-meta text-ink-3">
                  Step {i.currentStep} of {i.stepCount}
                  {i.currentStepTitle ? `: ${i.currentStepTitle}` : ""}
                </div>
                <div className="mt-1 text-meta text-ink-3">
                  started {i.startedAt.slice(0, 10)} · {i.startedBy}
                </div>
              </div>
              <button
                className={btnCls}
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Cancel "${i.runbookTitle}"? Its open step work item is cancelled too.`)) return;
                  start(async () => {
                    await runAction(() => cancelRunbook(i.id), { fallback: "Could not cancel that runbook." });
                    router.refresh();
                  });
                }}
              >
                Cancel
              </button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ─── Queue tab ───────────────────────────────────────────────────────────────
// Folders on the left (everything / each person / each agent — the rules live
// in lib/engine-views.ts), filters on top, and Queue vs Archived. The board
// filters in the browser; the archive is paged from the server.

function QueueFilterDisclosure({ children, label }: { children: ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  return <div className="mb-4">
    <Button variant="secondary" className="mb-3 @3xl/page:hidden" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide folders and filters" : "Folders and filters"} · {label}</Button>
    <div className={`${open ? "block" : "hidden"} @3xl/page:block`}>{children}</div>
  </div>;
}

function QueueTab({
  engine,
  skills,
  canAssign,
  meId,
}: {
  engine: EngineData;
  skills: SkillsLibrary;
  canAssign: boolean;
  meId: string;
}) {
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState<"queue" | "archived">("queue");
  const [filter, setFilter] = useState<QueueFilter>(NO_FILTER);
  // Board-only, so it sits beside QueueFilter rather than in it (the archive
  // is all closed items — nothing there waits on anyone).
  const [onMe, setOnMe] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const folders = queueFolders(engine.items, engine.assignees, engine.ownerId);
  const inFolder = engine.items.filter((it) => matchesQueueFilter(it, filter, engine.ownerId));
  const onMeCount = inFolder.filter((it) => isWaitingOn(it, meId, engine.ownerId)).length;
  const shown = onMe ? inFolder.filter((it) => isWaitingOn(it, meId, engine.ownerId)) : inFolder;
  const buckets = Object.fromEntries(
    BUCKET_META.map((b) => [b.key, shown.filter((it) => it.bucket === b.key)]),
  ) as Record<QueueBucket, WorkItemView[]>;
  const nonEmpty = BUCKET_META.filter((b) => buckets[b.key].length > 0);
  const filtered = onMe || filter.job !== "" || filter.by !== "" || filter.q.trim() !== "";

  const archiveAll = (items: WorkItemView[]) => {
    if (!confirm(`Archive ${items.length} done and cancelled item${items.length === 1 ? "" : "s"}? They move to Archived — nothing is deleted.`)) return;
    start(async () => {
      await runAction(() => archiveWorkItems(items.map((i) => i.id)), {
        fallback: "Could not archive those.",
        onSuccess: (r) => {
          if (r.ok) toast({ kind: "success", message: `Archived ${r.archived} item${r.archived === 1 ? "" : "s"}.` });
        },
      });
      router.refresh();
    });
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex rounded-md border border-rule bg-paper-2 p-0.5">
          {(
            [
              { key: "queue", label: "Queue", count: engine.counts.total },
              { key: "archived", label: "Archived", count: engine.counts.archived },
            ] as const
          ).map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={[
                "rounded px-3 py-1 text-meta font-semibold transition-colors",
                view === v.key ? "bg-paper text-accent-2 shadow-sm" : "text-ink-3 hover:text-ink-2",
              ].join(" ")}
            >
              {v.label}
              <span className="ml-1.5 text-meta text-ink-3">{v.count}</span>
            </button>
          ))}
        </div>
        <button className={btnPrimary} onClick={() => setShowNew((v) => !v)}>
          {showNew ? "Close" : "New work item"}
        </button>
      </div>

      {showNew && (
        <Card kind="soft" className="mb-4 p-4">
          <form
            ref={formRef}
            action={(fd) =>
              start(async () => {
                const r = await runAction(() => createWorkItem(fd), { fallback: "Could not create the work item." });
                if (r.ok) {
                  formRef.current?.reset();
                  setShowNew(false);
                  router.refresh();
                }
              })
            }
            className="space-y-3"
          >
            <input name="title" placeholder="What needs to happen?" className={inputCls} required />
            <textarea name="body" placeholder="Details / context (optional)" rows={2} className={inputCls} />
            <div className="grid gap-3 @xl/page:grid-cols-3">
              <select name="priority" defaultValue="normal" className={inputCls}>
                {(["urgent", "high", "normal", "low"] as WorkItemPriority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
              {/* Which RUNTIME does the work: a person, or a named bot. */}
              <select name="assignee_key" defaultValue="human-joe" className={inputCls}>
                <option value="human-joe">A person</option>
                <option value="hermes-telegram">Hermes</option>
                <option value="claude-code-server">Claude Code</option>
                <option value="codex-server">Codex</option>
              </select>
              <input name="due_at" type="date" className={inputCls} />
            </div>
            {/* Which PEOPLE it's on — any mix of the team. Just the owner (the
                default) is stored as nobody = his own, the same as every other
                writer (detectors, MCP, runbooks) leaves behind. */}
            {canAssign && (
              <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <legend className="sr-only">Who&apos;s on it</legend>
                <span className="text-meta text-ink-3">On it:</span>
                {engine.assignees.map((a, i) => (
                  <label key={a.userId} className="inline-flex items-center gap-1.5 text-body text-ink-2">
                    <input
                      type="checkbox"
                      name="assigned_user_ids"
                      value={a.userId}
                      defaultChecked={i === 0}
                      className="accent-accent"
                    />
                    {i === 0 ? `Me (${a.name.split(" ")[0]})` : a.name}
                  </label>
                ))}
              </fieldset>
            )}
            <select name="expected_skill_slug" defaultValue="" className={inputCls}>
              <option value="">No expected skill</option>
              {skills.approved.map((s) => (
                <option key={s.slug} value={s.slug}>{s.title}</option>
              ))}
            </select>
            <button type="submit" className={btnPrimary} disabled={pending}>
              {pending ? "Adding…" : "Add to queue"}
            </button>
          </form>
        </Card>
      )}

      <QueueFilterDisclosure label={folders.all.who === filter.who ? folders.all.label : [...folders.people, ...folders.agents].find(f => f.who === filter.who)?.label ?? "Selected folder"}>
      <div className="grid gap-3 @5xl/page:grid-cols-[180px_minmax(0,1fr)]">
        <QueueRail
          folders={folders}
          active={filter.who}
          showCounts={view === "queue"}
          onPick={(who) => setFilter((f) => ({ ...f, who }))}
        />

        <div className="min-w-0">
          <QueueFilters
            items={engine.items}
            filter={filter}
            onChange={setFilter}
            onMe={view === "queue" ? { on: onMe, count: onMeCount, set: setOnMe } : null}
          />

        </div>
      </div>
      </QueueFilterDisclosure>
      <p className="mb-3 text-meta text-ink-2">{view === "queue" ? `${shown.length} shown · ${inFolder.length} in this folder and filters · ${onMeCount} waiting on me · ${shown.filter(it => it.bucket === "waiting").length} waiting / blocked shown` : "Archived records · folder and filters apply"}</p>
      <div className="min-w-0">
          {view === "archived" ? (
            <ArchiveList
              filter={filter}
              archivedCount={engine.counts.archived}
              assignees={engine.assignees}
              canAssign={canAssign}
            />
          ) : engine.counts.total === 0 ? (
            <EmptyState
              title="The queue is empty"
              body="Add a work item above. Work created by agents also appears here for review."
            />
          ) : nonEmpty.length === 0 ? (
            <EmptyState
              title="Nothing here"
              body={filtered ? "No work items match these filters." : "Nothing is on the queue for this folder right now."}
            />
          ) : (
            <div className="space-y-6">
              {nonEmpty.map((b) => (
                <section key={b.key}>
                  <div className="mb-2 flex items-center gap-2">
                    <Chip kind={b.kind} dot>{b.label}</Chip>
                    <span className="text-meta text-ink-3">{buckets[b.key].length}</span>
                    {b.key === "done" && (
                      <button
                        className="ml-auto text-meta font-semibold text-accent-2 hover:underline disabled:opacity-50"
                        disabled={pending}
                        onClick={() => archiveAll(buckets.done)}
                      >
                        Archive all {buckets.done.length}
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-rule-soft">
                    {buckets[b.key].map((it) => (
                      <WorkItemCard
                        key={it.id}
                        item={it}
                        assignees={engine.assignees}
                        canAssign={canAssign}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

/** Small-caps mono section label for the folder rail (same as /inbox's). */
function RailLabel({ children }: { children: string }) {
  return (
    <div className="hidden px-1 pb-1 pt-2 text-label font-medium text-ink-3 @4xl/page:block">
      {children}
    </div>
  );
}

function QueueRail({
  folders,
  active,
  showCounts,
  onPick,
}: {
  folders: ReturnType<typeof queueFolders>;
  active: string;
  /** Counts are what's open on the board — meaningless over the archive. */
  showCounts: boolean;
  onPick: (who: string) => void;
}) {
  const row = (f: QueueFolder) => (
    <button
      key={f.who}
      onClick={() => onPick(f.who)}
      className={[
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-meta",
        active === f.who
          ? "bg-accent-soft font-semibold text-accent-2"
          : f.open === 0 && showCounts
            ? "text-ink-3 hover:bg-paper-3"
            : "text-ink-2 hover:bg-paper-3",
      ].join(" ")}
    >
      <span className="min-w-0 flex-1">{f.label}</span>
      {showCounts && <span className="text-meta text-ink-3">{f.open}</span>}
    </button>
  );
  return <>
    <label className="text-label text-ink-3 @5xl/page:hidden">Work queue folder
      <select aria-label="Work queue folder" value={active} onChange={e=>onPick(e.target.value)} className={`${inputCls} mt-1.5`}>
        {[folders.all,...folders.people,...folders.agents].map(f=><option key={f.who} value={f.who}>{f.label}{showCounts?` · ${f.open}`:''}</option>)}
      </select>
    </label>
    <nav aria-label="Work queue folders" className="hidden flex-col gap-0.5 @5xl/page:flex">
      {row(folders.all)}<RailLabel>People</RailLabel>{folders.people.map(row)}<RailLabel>Agents</RailLabel>{folders.agents.map(row)}
    </nav>
  </>;
}

/** Search + job + "filed by" (+ "Waiting on me" on the board). Options come
 *  from what's on the board; the one picked stays listed even if the board no
 *  longer has it (the archive may). */
function QueueFilters({
  items,
  filter,
  onChange,
  onMe,
}: {
  items: WorkItemView[];
  filter: QueueFilter;
  onChange: (f: QueueFilter) => void;
  /** Null over the archive, where it means nothing. */
  onMe: { on: boolean; count: number; set: (on: boolean) => void } | null;
}) {
  const projects = new Map<string, string>();
  const leads = new Map<string, string>();
  const filers = new Map<string, number>();
  for (const it of items) {
    if (it.projectSlug) projects.set(`project:${it.projectSlug}`, it.projectName ?? it.projectSlug);
    if (it.leadSlug) leads.set(`lead:${it.leadSlug}`, it.leadName ?? it.leadSlug);
    filers.set(it.createdBy, (filers.get(it.createdBy) ?? 0) + 1);
  }
  if (filter.job && !projects.has(filter.job) && !leads.has(filter.job)) {
    (filter.job.startsWith("lead:") ? leads : projects).set(filter.job, filter.job.slice(filter.job.indexOf(":") + 1));
  }
  if (filter.by && !filers.has(filter.by)) filers.set(filter.by, 0);
  const byLabel = (m: Map<string, string>) => [...m].sort((a, b) => a[1].localeCompare(b[1]));
  const selectCls =
    "rounded-md border border-rule bg-paper px-2 py-1.5 text-meta text-ink-2 outline-none focus:border-accent";
  const active = filter.job !== "" || filter.by !== "" || filter.q !== "" || !!onMe?.on;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {onMe && (
        <button
          onClick={() => onMe.set(!onMe.on)}
          aria-pressed={onMe.on}
          title="Hide what's waiting on a client, a sub, an agent or someone else"
          className={[
            "rounded-md border px-2.5 py-1.5 text-meta font-semibold transition-colors",
            onMe.on
              ? "border-accent bg-accent-soft text-accent-2"
              : "border-rule bg-paper text-ink-2 hover:border-accent hover:text-accent-2",
          ].join(" ")}
        >
          Waiting on me
          <span className="ml-1.5 text-meta text-ink-3">{onMe.count}</span>
        </button>
      )}
      <input
        value={filter.q}
        onChange={(e) => onChange({ ...filter, q: e.target.value })}
        placeholder="Search work items…"
        className="min-w-[180px] flex-1 rounded-md border border-rule bg-paper px-3 py-1.5 text-meta text-ink outline-none focus:border-accent"
      />
      <select
        value={filter.job}
        onChange={(e) => onChange({ ...filter, job: e.target.value })}
        className={`${selectCls} max-w-[200px]`}
        aria-label="Job"
      >
        <option value="">All jobs</option>
        {projects.size > 0 && (
          <optgroup label="Projects">
            {byLabel(projects).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </optgroup>
        )}
        {leads.size > 0 && (
          <optgroup label="Leads">
            {byLabel(leads).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </optgroup>
        )}
      </select>
      <select
        value={filter.by}
        onChange={(e) => onChange({ ...filter, by: e.target.value })}
        className={`${selectCls} max-w-[180px]`}
        aria-label="Filed by"
      >
        <option value="">Filed by anyone</option>
        {[...filers].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      {active && (
        <button
          className="text-meta text-ink-3 hover:text-accent-2"
          onClick={() => {
            onChange({ ...filter, job: "", by: "", q: "" });
            onMe?.set(false);
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}

/** The Archived view: pages of archived to-dos for the current folder +
 *  filters, newest-archived first. Refetches when the filters change (search
 *  waits for a pause in typing) or something new is archived. */
function ArchiveList({
  filter,
  archivedCount,
  assignees,
  canAssign,
}: {
  filter: QueueFilter;
  archivedCount: number;
  assignees: EngineData["assignees"];
  canAssign: boolean;
}) {
  const [items, setItems] = useState<WorkItemView[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, startMore] = useTransition();
  const filterKey = JSON.stringify(filter);

  useEffect(() => {
    let stale = false;
    const t = setTimeout(
      async () => {
        const r = await runAction(() => listArchivedWorkItems(JSON.parse(filterKey) as QueueFilter, 0), {
          fallback: "Could not load the archive.",
        });
        if (stale || !r.ok) return;
        setItems(r.items);
        setHasMore(r.hasMore);
      },
      JSON.parse(filterKey).q ? 300 : 0,
    );
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [filterKey, archivedCount]);

  const loadMore = () =>
    startMore(async () => {
      const r = await runAction(() => listArchivedWorkItems(filter, items?.length ?? 0), {
        fallback: "Could not load more.",
      });
      if (!r.ok) return;
      setItems((xs) => [...(xs ?? []), ...r.items.filter((n) => !xs?.some((x) => x.id === n.id))]);
      setHasMore(r.hasMore);
    });

  if (items === null) return <p className="py-6 text-center text-meta text-ink-3">Loading the archive…</p>;
  if (items.length === 0)
    return (
      <EmptyState
        title={archivedCount === 0 ? "Nothing archived yet" : "Nothing here"}
        body={
          archivedCount === 0
            ? "Done and cancelled items move here when you archive them from the queue. Nothing is deleted — Restore puts one back."
            : "No archived items match this folder and these filters."
        }
      />
    );

  return (
    <div className="divide-y divide-rule-soft">
      {items.map((it) => (
        <WorkItemCard
          key={it.id}
          item={it}
          assignees={assignees}
          canAssign={canAssign}
          onRestored={() => setItems((xs) => xs?.filter((x) => x.id !== it.id) ?? null)}
        />
      ))}
      {hasMore && (
        <div className="pt-2 text-center">
          <button className={btnCls} disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? "Loading…" : "Show older"}
          </button>
        </div>
      )}
    </div>
  );
}

function WorkItemCard({item,assignees,canAssign,onRestored}: {
  item: WorkItemView; assignees: EngineData["assignees"]; canAssign: boolean; onRestored?:()=>void;
}) {
  const router=useRouter(); const [pending,start]=useTransition();
  const [open,setOpen]=useState(false); const [editing,setEditing]=useState(false);
  const run=(fn:()=>Promise<ActionLike>)=>start(async()=>{await runAction(fn);router.refresh();});
  return <div className="group min-w-0 py-1">
    <div className="flex items-start gap-3 rounded-md px-3 py-3 hover:bg-hover">
      <div className="min-w-0 flex-1">
        <button onClick={()=>setOpen(!open)} aria-expanded={open} className="text-left text-subheading font-semibold text-ink hover:text-accent-2">{item.title}</button>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-meta text-ink-3">
          <Chip kind={statusChip(item.status)}>{STATUS_LABEL[item.status]}</Chip>
          {item.priority!=="normal"&&<span>{PRIORITY_LABEL[item.priority]} priority</span>}
          {(item.projectName||item.leadName)&&<span>{item.projectName??item.leadName}</span>}
          {item.dueAt&&<span>Due {item.dueAt.slice(0,10)}</span>}
          <span>Filed by {item.createdBy === "user" ? "you" : ({"inbox-cron":"Inbox","hermes-cron":"Hermes","claude-in-app":"Claude"}[item.createdBy] ?? agentLabel(item.createdBy))}</span>
          {item.assignedTo.length>0&&<span>{item.assignedTo.map(a=>a.name).join(', ')}</span>}
          {item.assigneeKey&&item.assigneeKey!=="human-joe"&&<span>{agentLabel(item.assigneeKey)}</span>}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={()=>{setOpen(true);setEditing(!editing);}} aria-label={`Edit ${item.title}`}>Edit</Button>
    </div>
    {open&&<div className="mx-3 mb-3 rounded-lg border border-rule-soft bg-card p-4">
      {editing?<WorkItemEditor item={item} assignees={assignees} canAssign={canAssign} onClose={()=>setEditing(false)}/>:<>
        {item.body&&<p className="whitespace-pre-wrap break-words text-body text-ink-2">{item.body}</p>}
        {item.blockedReason&&<p className="mt-2 text-body text-warn">{item.blockedReason}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {item.archivedAt?<Button variant="secondary" size="sm" disabled={pending} onClick={()=>start(async()=>{const r=await runAction(()=>restoreWorkItem(item.id));if(r.ok)onRestored?.();router.refresh();})}>Restore</Button>:item.bucket==='approval'?<><Button size="sm" disabled={pending} onClick={()=>start(async()=>{await runAction(()=>approveWorkItem(item.id),{onSuccess:r=>toast(describeApproval(r))});router.refresh();})}>Approve</Button><Button variant="secondary" size="sm" disabled={pending} onClick={()=>run(()=>rejectWorkItem(item.id))}>Reject</Button></>:<>
            <label className="text-label text-ink-3">Status <select aria-label="Work item status" value={item.status} disabled={pending} onChange={e=>run(()=>setWorkItemStatus(item.id,e.target.value as WorkItemStatus))} className="ml-2 rounded-md border border-rule bg-card px-2 py-1.5 text-body text-ink">{WORK_STATUSES.map(status=><option key={status} value={status}>{STATUS_LABEL[status]}</option>)}</select></label>
            {canAssign&&<AssigneePicker triggerClassName={btnCls} roster={assignees} assigned={item.assignedTo} onChange={ids=>run(()=>setWorkItemAssignees(item.id,ids))} disabled={pending} trigger={`${assigneeSummary(item.assignedTo,assignees)} ▾`}/>}
            {item.bucket==='done'&&<details className="relative"><summary className="cursor-pointer px-2 text-body" aria-label="More work item actions">…</summary><div className="absolute right-0 z-10 rounded-lg border border-rule-soft bg-card p-1 shadow-pop"><Button variant="ghost" size="sm" disabled={pending} onClick={()=>run(()=>archiveWorkItems([item.id]))}>Archive</Button></div></details>}
          </>}
          {item.projectSlug&&<Button variant="ghost" size="sm" href={`/projects/${item.projectSlug}`}>Open job ↗</Button>}
          {item.leadSlug&&<Button variant="ghost" size="sm" href={`/leads/${item.leadSlug}`}>Open lead ↗</Button>}
        </div>
        {(item.expectedSkillSlug||item.expectedRunbookSlug)&&<p className="mt-2 text-meta text-ink-3">{item.expectedSkillSlug ? `Skill: ${item.expectedSkillSlug}` : `Runbook: ${item.expectedRunbookSlug}`}</p>}
      </>}
      <Button variant="ghost" size="sm" className="mt-3" onClick={()=>{setOpen(false);setEditing(false);}}>Close details</Button>
    </div>}
  </div>;
}

// ─── Knowledge tab ───────────────────────────────────────────────────────────

function KnowledgeTab({ initial }: { initial: KnowledgeItemView[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const captureRef = useRef<HTMLFormElement>(null);

  // Fresh server props arrive when the LiveUpdates poller refreshes after an
  // agent captures knowledge over MCP — adopt them unless a search is showing
  // its own result set. Render-phase adjustment, not an effect (react.dev/
  // learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    if (!q.trim()) setItems(initial);
  }

  const runSearch = (query: string) =>
    start(async () => setItems(await searchKnowledgeAction(query)));

  return (
    <div className="grid gap-5 @4xl/page:grid-cols-[1fr_360px]">
      <div>
        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(q); }}
          className="mb-3 flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the knowledge base…"
            className={inputCls}
          />
          <button type="submit" className={btnCls} disabled={pending}>Search</button>
          {q && (
            <button type="button" className={btnCls} onClick={() => { setQ(""); runSearch(""); }}>Clear</button>
          )}
        </form>

        {items.length === 0 ? (
          <EmptyState
            title={q ? "No matches" : "No knowledge captured yet"}
            body="Durable business context — client/vendor notes, decisions, business rules, SOPs, lessons, selection preferences. Agents also write here via MCP (capture_knowledge). The temp-CRM import backfills status/scope/qualification notes."
          />
        ) : (
          <ul className="divide-y divide-rule-soft">
            {items.map((k) => (
              <li key={k.id}>
                <Card kind="soft" className="p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip kind="accent">{k.kind}</Chip>
                        <Chip kind="ghost">{k.source}</Chip>
                        {k.projectSlug && <Link href={`/projects/${k.projectSlug}`} className="text-meta text-accent-2 hover:underline">{k.projectSlug} ↗</Link>}
                        {k.leadSlug && <Link href={`/leads/${k.leadSlug}`} className="text-meta text-accent-2 hover:underline">{k.leadSlug} ↗</Link>}
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap text-body leading-relaxed text-ink-2">{k.content}</p>
                      <div className="mt-1 text-meta text-ink-3">{k.createdBy} · {k.createdAt.slice(0, 10)}</div>
                    </div>
                    <button
                      className="flex-none text-meta text-ink-3 hover:text-flag"
                      onClick={() => start(async () => {
                        const r = await runAction(() => deleteKnowledge(k.id), { fallback: "Could not delete that." });
                        if (!r.ok) return;
                        setItems((xs) => xs.filter((x) => x.id !== k.id));
                        router.refresh();
                      })}
                    >
                      Delete
                    </button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <Card kind="ai" className="p-4">
          <Eyebrow muted>Capture knowledge</Eyebrow>
          <form
            ref={captureRef}
            action={(fd) =>
              start(async () => {
                const r = await runAction(() => captureKnowledge(fd), { fallback: "Could not save that." });
                if (r.ok) { captureRef.current?.reset(); runSearch(""); setQ(""); router.refresh(); }
              })
            }
            className="mt-2 space-y-2.5"
          >
            <textarea name="content" placeholder="A durable fact, decision, rule, or preference…" rows={4} className={inputCls} required />
            <select name="kind" defaultValue="note" className={inputCls}>
              {KNOWLEDGE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button type="submit" className={btnPrimary} disabled={pending}>Save</button>
          </form>
        </Card>
      </div>
    </div>
  );
}

// ─── Skills tab ──────────────────────────────────────────────────────────────

function SkillsTab({ skills }: { skills: SkillsLibrary }) {
  return (
    <div className="space-y-6">
      {skills.proposed.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Chip kind="flag" dot>Needs review</Chip>
            <span className="text-meta text-ink-3">{skills.proposed.length}</span>
          </div>
          <div className="divide-y divide-rule-soft">
            {skills.proposed.map((s) => <SkillCard key={s.slug} skill={s} review />)}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Chip kind="accent" dot>Skill library</Chip>
          <span className="text-meta text-ink-3">{skills.approved.length}</span>
        </div>
        {skills.approved.length === 0 ? (
          <EmptyState
            title="No approved skills yet"
            body="Reusable operating procedures agents load before working — how to draft a client follow-up, triage a lead under $20k, run the daily ops review. Proposals (from agents or seeded) appear above for your approval."
          />
        ) : (
          <div className="divide-y divide-rule-soft">
            {skills.approved.map((s) => <SkillCard key={s.slug} skill={s} />)}
          </div>
        )}
      </section>

      {skills.runbooks.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Chip kind="info" dot>Runbooks</Chip>
            <span className="text-meta text-ink-3">{skills.runbooks.length}</span>
          </div>
          <div className="divide-y divide-rule-soft">
            {skills.runbooks.map((r) => <RunbookCard key={r.slug} runbook={r} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function SkillCard({ skill, review }: { skill: SkillView; review?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionLike>) => start(async () => { await runAction(fn); router.refresh(); });

  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip kind="ghost">{skill.category}</Chip>
            <span className="text-meta text-ink-3">{skill.slug}</span>
            {skill.proposedBy && review && <Chip kind="ai">by {skill.proposedBy}</Chip>}
          </div>
          <div className="mt-1 text-subheading font-semibold text-ink">{skill.title}</div>
          {skill.description && <div className="mt-0.5 text-meta text-ink-3">{skill.description}</div>}
          {skill.whenToUse && <div className="mt-0.5 text-meta text-ink-3"><span className="font-semibold">When:</span> {skill.whenToUse}</div>}
          {skill.body && (
            <button className="mt-1.5 text-meta text-accent-2 hover:underline" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide procedure" : "View procedure"}
            </button>
          )}
          {open && (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-paper-2 p-3 font-sans text-body leading-relaxed text-ink-2">
              {skill.body}
            </pre>
          )}
        </div>
        {review && (
          <div className="flex flex-none flex-col items-end gap-1.5">
            <button className={btnPrimary} disabled={pending} onClick={() => run(() => approveSkill(skill.slug))}>Approve</button>
            <button className={btnCls} disabled={pending} onClick={() => run(() => rejectSkill(skill.slug))}>Reject</button>
          </div>
        )}
      </div>
    </Card>
  );
}

function RunbookCard({ runbook }: { runbook: RunbookView }) {
  return (
    <Card kind="soft" className="p-3.5">
      <div className="flex items-center gap-2">
        <span className="text-meta text-ink-3">{runbook.slug}</span>
        {!runbook.active && <Chip kind="ghost">inactive</Chip>}
      </div>
      <div className="mt-1 text-subheading font-semibold text-ink">{runbook.title}</div>
      {runbook.description && <div className="mt-0.5 text-meta text-ink-3">{runbook.description}</div>}
      {runbook.steps.length > 0 && (
        <ol className="mt-2 space-y-1">
          {runbook.steps.map((s) => (
            <li key={s.stepOrder} className="flex items-start gap-2 text-meta text-ink-2">
              <span className="mt-px text-meta text-ink-3">{s.stepOrder}</span>
              <span className="flex-1">
                {s.title}
                {s.skillSlug && <span className="ml-1.5 text-meta text-accent-2">{s.skillSlug}</span>}
                <span className="ml-1.5 text-meta text-ink-3">{s.assignedTo === "human" ? "Joe" : "agent"}</span>
                {s.requiresHumanApproval && <Chip kind="flag" className="ml-1.5">approval</Chip>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ─── Memories tab ────────────────────────────────────────────────────────────
// W5 learning layer: what agents noticed (denials, edits, rejections) waits
// here for review; the approved-as-instruction list below is literally Joe's
// standing orders to all agents (served via get_standing_instructions).

function MemoriesTab({ memories: all }: { memories: MemoriesData }) {
  const [search, setSearch] = useState("");
  const match = (m: MemoryView) => `${m.summary} ${m.content} ${m.runtimeName ?? ''}`.toLowerCase().includes(search.trim().toLowerCase());
  const memories = { pending: all.pending.filter(match), instructions: all.instructions.filter(match), examples: all.examples.filter(match), history: all.history.filter(match) };
  return (
    <div className="space-y-6">
      <label className="block text-label text-ink-2">Search memories
        <input aria-label="Search memories" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a rule, example or rejected memory…" className={`${inputCls} mt-1.5`} />
      </label>
      {memories.pending.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Chip kind="flag" dot>Pending review</Chip>
            <span className="text-meta text-ink-3">{memories.pending.length}</span>
          </div>
          <div className="divide-y divide-rule-soft">
            {memories.pending.map((m) => <MemoryCard key={m.id} memory={m} review />)}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Chip kind="accent" dot>Standing instructions</Chip>
          <span className="text-meta text-ink-3">{memories.instructions.length}</span>
        </div>
        {memories.instructions.length === 0 ? (
          <EmptyState
            title="No standing instructions yet"
            body="When you approve a pending memory as an instruction, it becomes a standing order every agent loads at the start of a pass — until you revoke it or it goes stale. Nothing an agent writes lands here without your click."
          />
        ) : (
          <div className="divide-y divide-rule-soft">
            {memories.instructions.map((m) => <MemoryCard key={m.id} memory={m} />)}
          </div>
        )}
      </section>

      <section><h2 className="mb-2 text-heading font-serif">Approved examples · {memories.examples.length}</h2>
        <p className="mb-3 text-body text-ink-3">Evidence agents can cite, including revoked rules. Restore to review before approving a rule again.</p>
        <div className="divide-y divide-rule-soft">{memories.examples.map(m=><MemoryCard key={m.id} memory={m}/>)}</div>
      </section>
      <section><h2 className="mb-2 text-heading font-serif">History · {memories.history.length}</h2>
        <p className="mb-3 text-body text-ink-3">Rejected memories stay here with their sources. Restore returns one to review.</p>
        <div className="divide-y divide-rule-soft">{memories.history.map(m=><MemoryCard key={m.id} memory={m}/>)}</div>
      </section>
      {memories.pending.length === 0 && (
        <EmptyState
          title="Nothing waiting for review"
          body="Agents park lessons here automatically — a denied send, a draft you edited before approving, a rejected proposal, or a preference you told an agent to remember."
        />
      )}
    </div>
  );
}

function refHref(r: MemoryRefView): string | null {
  if (r.uri) return r.uri;
  if (!r.id) return null;
  if (r.kind === "grant") return "/engine/permissions";
  if (r.kind === "work_item") return "/engine";
  if (r.kind === "lead") return `/leads/${r.id}`;
  if (r.kind === "project") return `/projects/${r.id}`;
  if (r.kind === "newsletter_issue") return "/newsletter";
  return null;
}

function MemoryCard({ memory, review }: { memory: MemoryView; review?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState(memory.staleAfter ? memory.staleAfter.slice(0, 10) : "");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionLike>) => start(async () => { await runAction(fn); router.refresh(); });

  const captured = new Date(memory.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="py-4">
      <div className="flex flex-col items-start justify-between gap-3 @3xl/page:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip kind="ghost">{memory.memoryType}</Chip>
            {memory.runtimeName && <Chip kind="ai">{memory.runtimeName}</Chip>}
            <span className="text-meta text-ink-3">captured {captured}</span>
            {memory.confidence !== null && (
              <span className="text-meta text-ink-3">conf {memory.confidence}</span>
            )}
          </div>
          <div className="mt-1 text-subheading font-semibold text-ink">{memory.summary}</div>
          <button className="mt-1.5 text-meta text-accent-2 hover:underline" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide details" : "View details"}
          </button>
          {open && (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-paper-2 p-3 font-sans text-body leading-relaxed text-ink-2">
              {memory.content}
            </pre>
          )}
          {memory.refs.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {memory.refs.map((r, i) => {
                const href = refHref(r);
                return href ? (
                  <Link key={i} href={href} className="text-meta text-accent-2 hover:underline">
                    {r.label || `${r.kind} ${r.id ?? ""}`}
                  </Link>
                ) : (
                  <span key={i} className="text-meta text-ink-3">
                    {r.label || `${r.kind} ${r.id ?? ""}`}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        {review ? (
          <div className="flex flex-none flex-col items-end gap-1.5">
            <button className={btnPrimary} disabled={pending} onClick={() => run(() => approveMemoryInstruction(memory.id))}>
              Approve as rule
            </button>
            <button className={btnCls} disabled={pending} onClick={() => run(() => approveMemoryEvidence(memory.id))}>
              Approve as example
            </button>
            <button className={btnCls} disabled={pending} onClick={() => run(() => rejectMemory(memory.id))}>
              Reject
            </button>
          </div>
        ) : memory.canUseAsInstruction && memory.reviewStatus === "approved" ? (
          <div className="flex flex-none flex-col items-end gap-1.5">
            <button className={btnCls} disabled={pending} onClick={() => run(() => revokeMemoryInstruction(memory.id))}>
              Revoke
            </button>
            <label className="text-meta text-ink-3">
              stale after
              <input
                type="date"
                value={stale}
                disabled={pending}
                onChange={(e) => {
                  setStale(e.target.value);
                  run(() => setMemoryStaleAfter(memory.id, e.target.value));
                }}
                className="ml-1 rounded-md border border-rule bg-paper px-1.5 py-0.5 text-meta text-ink-2"
              />
            </label>
          </div>
        ) : <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={pending} onClick={()=>run(()=>restoreMemory(memory.id))}>Restore to review</Button>
          {memory.reviewStatus==='approved'&&<Button variant="ghost" size="sm" disabled={pending} onClick={()=>run(()=>rejectMemory(memory.id))}>Revoke example</Button>}
        </div>}
      </div>
    </div>
  );
}

// ─── shared ──────────────────────────────────────────────────────────────────

function EmptyState({ title, body }: { title: string; body: string }) {
  return <UiEmptyState title={title} description={body} compact />;
}
