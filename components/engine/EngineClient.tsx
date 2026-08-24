"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Chip, Eyebrow, type ChipKind } from "@/components/ui";
import {
  WORK_STATUSES,
  STATUS_LABEL,
  PRIORITY_LABEL,
  type QueueBucket,
} from "@/lib/engine-constants";
import type { EngineData, WorkItemView } from "@/lib/engine";
import type { KnowledgeItemView } from "@/lib/brain";
import type { SkillsLibrary, SkillView, RunbookView } from "@/lib/skills";
import type { MemoriesData, MemoryRefView, MemoryView } from "@/lib/memories";
import type { RunbookInstanceView } from "@/lib/runbook-engine";
import type { WorkItemStatus, WorkItemPriority } from "@/lib/types";
import {
  createWorkItem,
  setWorkItemStatus,
  approveWorkItem,
  rejectWorkItem,
  cancelRunbook,
} from "@/lib/actions/engine";
import { captureKnowledge, deleteKnowledge, searchKnowledgeAction } from "@/lib/actions/brain";
import { approveSkill, rejectSkill } from "@/lib/actions/skills";
import {
  approveMemoryEvidence,
  approveMemoryInstruction,
  rejectMemory,
  revokeMemoryInstruction,
  setMemoryStaleAfter,
} from "@/lib/actions/memories";

const inputCls =
  "w-full rounded-md border border-rule bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent";
const btnCls =
  "rounded-md border border-rule bg-paper-2 px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent-2 disabled:opacity-50";
const btnPrimary =
  "rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50";

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
}: {
  engine: EngineData;
  knowledge: KnowledgeItemView[];
  skills: SkillsLibrary;
  memories: MemoriesData;
  activeRunbooks: RunbookInstanceView[];
}) {
  const [tab, setTab] = useState<Tab>("queue");

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "queue", label: "Work queue", count: engine.counts.total },
    { key: "knowledge", label: "Knowledge", count: knowledge.length },
    { key: "skills", label: "Skills & runbooks", count: skills.approved.length + skills.proposed.length },
    { key: "memories", label: "Memories", count: memories.pending.length + memories.instructions.length },
  ];

  return (
    <div>
      <EngineStatusStrip engine={engine} />

      {activeRunbooks.length > 0 && <ActiveRunbooks instances={activeRunbooks} />}

      <div className="mb-4 mt-5 flex gap-1 border-b border-rule">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
              tab === t.key
                ? "border-accent text-accent-2"
                : "border-transparent text-ink-3 hover:text-ink-2",
            ].join(" ")}
          >
            {t.label}
            <span className="ml-1.5 font-mono text-[10px] text-ink-4">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "queue" && <QueueTab engine={engine} skills={skills} />}
      {tab === "knowledge" && <KnowledgeTab initial={knowledge} />}
      {tab === "skills" && <SkillsTab skills={skills} />}
      {tab === "memories" && <MemoriesTab memories={memories} />}
    </div>
  );
}

// ─── Status ledger + receipts strip ─────────────────────────────────────────

function EngineStatusStrip({ engine }: { engine: EngineData }) {
  const { ledgers, receipts } = engine;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card kind="soft" className="p-3.5">
        <Eyebrow muted>Runtime status ledger</Eyebrow>
        {ledgers.length === 0 ? (
          <p className="mt-2 text-[12px] text-ink-4">
            No runtimes have checked in yet. Agents (Hermes, Claude Code, …) post their state here as they run.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {ledgers.map((l) => (
              <li key={l.runtimeName} className="flex items-start gap-2">
                <Chip kind={l.state === "error" || l.state === "blocked" ? "flag" : l.state === "running" ? "accent" : "ghost"} dot>
                  {l.state}
                </Chip>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-ink-2">{l.runtimeName}</div>
                  <div className="truncate text-[12px] text-ink-3">
                    {l.currentWorkItemTitle ?? l.note ?? l.blockedReason ?? "idle"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card kind="soft" className="p-3.5">
        <Eyebrow muted>Recent receipts</Eyebrow>
        {receipts.length === 0 ? (
          <p className="mt-2 text-[12px] text-ink-4">
            Proof-of-work trail. Every agent action (email sent, file written, row changed, …) lands here.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {receipts.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[12px]">
                <Chip kind="ghost">{r.receiptKind}</Chip>
                <span className="min-w-0 flex-1 truncate text-ink-3">{r.label || r.uri || "—"}</span>
                {r.runtimeName && <span className="font-mono text-[10px] text-ink-4">{r.runtimeName}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
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
        <span className="font-mono text-[10px] text-ink-4">{instances.length}</span>
      </div>
      <div className="space-y-2">
        {instances.map((i) => (
          <Card key={i.id} kind="soft" className="p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip kind={runbookStatusChip(i.status)} dot>{RUNBOOK_STATUS_LABEL[i.status]}</Chip>
                  <span className="font-mono text-[11px] text-ink-4">{i.runbookSlug}</span>
                </div>
                <div className="mt-1 text-[13.5px] font-semibold text-ink">
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
                <div className="mt-0.5 text-[12px] text-ink-3">
                  Step {i.currentStep} of {i.stepCount}
                  {i.currentStepTitle ? `: ${i.currentStepTitle}` : ""}
                </div>
                <div className="mt-1 font-mono text-[10px] text-ink-4">
                  started {i.startedAt.slice(0, 10)} · {i.startedBy}
                </div>
              </div>
              <button
                className={btnCls}
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Cancel "${i.runbookTitle}"? Its open step work item is cancelled too.`)) return;
                  start(async () => {
                    await cancelRunbook(i.id);
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

function QueueTab({ engine, skills }: { engine: EngineData; skills: SkillsLibrary }) {
  const [showNew, setShowNew] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const nonEmpty = BUCKET_META.filter((b) => engine.buckets[b.key].length > 0);

  return (
    <div>
      <div className="mb-4 flex justify-between">
        <div />
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
                const r = await createWorkItem(fd);
                if (r.ok) {
                  formRef.current?.reset();
                  setShowNew(false);
                  router.refresh();
                } else alert(r.error);
              })
            }
            className="space-y-3"
          >
            <input name="title" placeholder="What needs to happen?" className={inputCls} required />
            <textarea name="body" placeholder="Details / context (optional)" rows={2} className={inputCls} />
            <div className="grid gap-3 sm:grid-cols-3">
              <select name="priority" defaultValue="normal" className={inputCls}>
                {(["urgent", "high", "normal", "low"] as WorkItemPriority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
              <select name="assignee_key" defaultValue="human-joe" className={inputCls}>
                <option value="human-joe">Joe</option>
                <option value="hermes-telegram">Hermes</option>
                <option value="claude-code-server">Claude Code</option>
                <option value="codex-server">Codex</option>
              </select>
              <input name="due_at" type="date" className={inputCls} />
            </div>
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

      {engine.counts.total === 0 ? (
        <EmptyState
          title="The queue is empty"
          body="Work items land here from you, the temp-CRM import, or agents via MCP (create_work_item). Each item can name the skill/runbook a worker should load."
        />
      ) : (
        <div className="space-y-6">
          {nonEmpty.map((b) => (
            <section key={b.key}>
              <div className="mb-2 flex items-center gap-2">
                <Chip kind={b.kind} dot>{b.label}</Chip>
                <span className="font-mono text-[10px] text-ink-4">{engine.buckets[b.key].length}</span>
              </div>
              <div className="space-y-2">
                {engine.buckets[b.key].map((it) => (
                  <WorkItemCard key={it.id} item={it} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkItemCard({ item }: { item: WorkItemView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  return (
    <Card kind={item.bucket === "approval" ? "flag" : "default"} className="p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip kind={statusChip(item.status)}>{STATUS_LABEL[item.status]}</Chip>
            {item.priority !== "normal" && <Chip kind={priorityChip(item.priority)}>{PRIORITY_LABEL[item.priority]}</Chip>}
            {item.assigneeKey && <Chip kind="ghost">{item.assigneeKey}</Chip>}
            {item.expectedSkillSlug && <Chip kind="ai">skill: {item.expectedSkillSlug}</Chip>}
            {item.expectedRunbookSlug && <Chip kind="ai">runbook: {item.expectedRunbookSlug}</Chip>}
          </div>
          <div className="mt-1.5 text-[13.5px] font-semibold text-ink">{item.title}</div>
          {item.body && <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-3">{item.body}</div>}
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-ink-4">
            {item.dueAt && <span>due {item.dueAt.slice(0, 10)}</span>}
            {item.projectSlug && <Link href={`/projects/${item.projectSlug}`} className="text-accent-2 hover:underline">project ↗</Link>}
            {item.leadSlug && <Link href={`/leads/${item.leadSlug}`} className="text-accent-2 hover:underline">lead ↗</Link>}
            {item.blockedReason && <span className="text-flag">{item.blockedReason}</span>}
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-1.5">
          {item.bucket === "approval" ? (
            <>
              <button className={btnPrimary} disabled={pending} onClick={() => run(() => approveWorkItem(item.id))}>Approve</button>
              <button className={btnCls} disabled={pending} onClick={() => run(() => rejectWorkItem(item.id))}>Reject</button>
            </>
          ) : (
            <select
              className="rounded-md border border-rule bg-paper px-2 py-1 text-[11px] text-ink-2 outline-none focus:border-accent"
              value={item.status}
              disabled={pending}
              onChange={(e) => run(() => setWorkItemStatus(item.id, e.target.value as WorkItemStatus))}
            >
              {WORK_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    </Card>
  );
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
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
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
          <ul className="space-y-2">
            {items.map((k) => (
              <li key={k.id}>
                <Card kind="soft" className="p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip kind="accent">{k.kind}</Chip>
                        <Chip kind="ghost">{k.source}</Chip>
                        {k.projectSlug && <Link href={`/projects/${k.projectSlug}`} className="text-[11px] text-accent-2 hover:underline">{k.projectSlug} ↗</Link>}
                        {k.leadSlug && <Link href={`/leads/${k.leadSlug}`} className="text-[11px] text-accent-2 hover:underline">{k.leadSlug} ↗</Link>}
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{k.content}</p>
                      <div className="mt-1 font-mono text-[10px] text-ink-4">{k.createdBy} · {k.createdAt.slice(0, 10)}</div>
                    </div>
                    <button
                      className="flex-none text-[11px] text-ink-4 hover:text-flag"
                      onClick={() => start(async () => { await deleteKnowledge(k.id); setItems((xs) => xs.filter((x) => x.id !== k.id)); router.refresh(); })}
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
          <Eyebrow>Capture knowledge</Eyebrow>
          <form
            ref={captureRef}
            action={(fd) =>
              start(async () => {
                const r = await captureKnowledge(fd);
                if (r.ok) { captureRef.current?.reset(); runSearch(""); setQ(""); router.refresh(); }
                else alert(r.error);
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
            <Chip kind="flag" dot>Proposed · needs review</Chip>
            <span className="font-mono text-[10px] text-ink-4">{skills.proposed.length}</span>
          </div>
          <div className="space-y-2">
            {skills.proposed.map((s) => <SkillCard key={s.slug} skill={s} review />)}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Chip kind="accent" dot>Skill library</Chip>
          <span className="font-mono text-[10px] text-ink-4">{skills.approved.length}</span>
        </div>
        {skills.approved.length === 0 ? (
          <EmptyState
            title="No approved skills yet"
            body="Reusable operating procedures agents load before working — how to draft a client follow-up, triage a lead under $20k, run the daily ops review. Proposals (from agents or seeded) appear above for your approval."
          />
        ) : (
          <div className="space-y-2">
            {skills.approved.map((s) => <SkillCard key={s.slug} skill={s} />)}
          </div>
        )}
      </section>

      {skills.runbooks.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Chip kind="info" dot>Runbooks</Chip>
            <span className="font-mono text-[10px] text-ink-4">{skills.runbooks.length}</span>
          </div>
          <div className="space-y-2">
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
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  return (
    <Card kind={review ? "flag" : "default"} className="p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip kind="ghost">{skill.category}</Chip>
            <span className="font-mono text-[11px] text-ink-4">{skill.slug}</span>
            {skill.proposedBy && review && <Chip kind="ai">by {skill.proposedBy}</Chip>}
          </div>
          <div className="mt-1 text-[13.5px] font-semibold text-ink">{skill.title}</div>
          {skill.description && <div className="mt-0.5 text-[12px] text-ink-3">{skill.description}</div>}
          {skill.whenToUse && <div className="mt-0.5 text-[12px] text-ink-4"><span className="font-semibold">When:</span> {skill.whenToUse}</div>}
          {skill.body && (
            <button className="mt-1.5 text-[11px] text-accent-2 hover:underline" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide procedure" : "View procedure"}
            </button>
          )}
          {open && (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-rule bg-paper-2 p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
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
        <span className="font-mono text-[11px] text-ink-4">{runbook.slug}</span>
        {!runbook.active && <Chip kind="ghost">inactive</Chip>}
      </div>
      <div className="mt-1 text-[13.5px] font-semibold text-ink">{runbook.title}</div>
      {runbook.description && <div className="mt-0.5 text-[12px] text-ink-3">{runbook.description}</div>}
      {runbook.steps.length > 0 && (
        <ol className="mt-2 space-y-1">
          {runbook.steps.map((s) => (
            <li key={s.stepOrder} className="flex items-start gap-2 text-[12px] text-ink-2">
              <span className="mt-px font-mono text-[10px] text-ink-4">{s.stepOrder}</span>
              <span className="flex-1">
                {s.title}
                {s.skillSlug && <span className="ml-1.5 font-mono text-[10px] text-accent-2">{s.skillSlug}</span>}
                <span className="ml-1.5 font-mono text-[10px] text-ink-4">{s.assignedTo === "human" ? "Joe" : "agent"}</span>
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

function MemoriesTab({ memories }: { memories: MemoriesData }) {
  return (
    <div className="space-y-6">
      {memories.pending.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Chip kind="flag" dot>Pending · needs review</Chip>
            <span className="font-mono text-[10px] text-ink-4">{memories.pending.length}</span>
          </div>
          <div className="space-y-2">
            {memories.pending.map((m) => <MemoryCard key={m.id} memory={m} review />)}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Chip kind="accent" dot>Standing orders to all agents</Chip>
          <span className="font-mono text-[10px] text-ink-4">{memories.instructions.length}</span>
        </div>
        {memories.instructions.length === 0 ? (
          <EmptyState
            title="No standing instructions yet"
            body="When you approve a pending memory as an instruction, it becomes a standing order every agent loads at the start of a pass — until you revoke it or it goes stale. Nothing an agent writes lands here without your click."
          />
        ) : (
          <div className="space-y-2">
            {memories.instructions.map((m) => <MemoryCard key={m.id} memory={m} />)}
          </div>
        )}
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
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  const captured = new Date(memory.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <Card kind={review ? "flag" : "default"} className="p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip kind="ghost">{memory.memoryType}</Chip>
            {memory.runtimeName && <Chip kind="ai">{memory.runtimeName}</Chip>}
            <span className="font-mono text-[10px] text-ink-4">captured {captured}</span>
            {memory.confidence !== null && (
              <span className="font-mono text-[10px] text-ink-4">conf {memory.confidence}</span>
            )}
          </div>
          <div className="mt-1 text-[13.5px] font-semibold text-ink">{memory.summary}</div>
          <button className="mt-1.5 text-[11px] text-accent-2 hover:underline" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide details" : "View details"}
          </button>
          {open && (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-rule bg-paper-2 p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
              {memory.content}
            </pre>
          )}
          {memory.refs.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {memory.refs.map((r, i) => {
                const href = refHref(r);
                return href ? (
                  <Link key={i} href={href} className="font-mono text-[10px] text-accent-2 hover:underline">
                    {r.label || `${r.kind} ${r.id ?? ""}`}
                  </Link>
                ) : (
                  <span key={i} className="font-mono text-[10px] text-ink-4">
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
              Approve as instruction
            </button>
            <button className={btnCls} disabled={pending} onClick={() => run(() => approveMemoryEvidence(memory.id))}>
              Approve as evidence
            </button>
            <button className={btnCls} disabled={pending} onClick={() => run(() => rejectMemory(memory.id))}>
              Reject
            </button>
          </div>
        ) : (
          <div className="flex flex-none flex-col items-end gap-1.5">
            <button className={btnCls} disabled={pending} onClick={() => run(() => revokeMemoryInstruction(memory.id))}>
              Revoke
            </button>
            <label className="text-[10px] text-ink-4">
              stale after
              <input
                type="date"
                value={stale}
                disabled={pending}
                onChange={(e) => {
                  setStale(e.target.value);
                  run(() => setMemoryStaleAfter(memory.id, e.target.value));
                }}
                className="ml-1 rounded-md border border-rule bg-paper px-1.5 py-0.5 text-[11px] text-ink-2"
              />
            </label>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── shared ──────────────────────────────────────────────────────────────────

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card kind="dashed" className="p-6 text-center">
      <div className="text-[14px] font-semibold text-ink-2">{title}</div>
      <p className="mx-auto mt-1 max-w-[460px] text-[12.5px] leading-relaxed text-ink-4">{body}</p>
    </Card>
  );
}
