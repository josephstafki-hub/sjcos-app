"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Chip, Eyebrow, type ChipKind } from "@/components/ui";
import { WORK_STATUSES, STATUS_LABEL } from "@/lib/engine-constants";
import {
  DETAIL_BUCKET_ORDER,
  DETAIL_BUCKET_LABEL,
  type DetailBucket,
} from "@/lib/record-ops-buckets";
import type { RecordOps, RecordWorkItem } from "@/lib/record-ops";
import type { WorkItemStatus } from "@/lib/types";
import {
  setRecordWorkItemStatus,
  approveRecordWorkItem,
  rejectRecordWorkItem,
  addRecordWorkItem,
  captureRecordKnowledge,
} from "@/lib/actions/record-ops";

const inputCls =
  "w-full rounded-md border border-rule bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent";
const btnCls =
  "rounded-md border border-rule bg-paper-2 px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent-2 disabled:opacity-50";
const btnPrimary =
  "rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50";

const BUCKET_CHIP: Record<DetailBucket, ChipKind> = {
  approval: "flag",
  active: "accent",
  waiting_joe: "info",
  waiting_client: "info",
  waiting_sub: "info",
  queued: "default",
  done: "ghost",
};

const KNOWLEDGE_KINDS = [
  "note", "client_note", "vendor_note", "project_decision", "selection_preference",
  "estimate_assumption", "followup_context", "admin_note", "business_rule", "lesson",
];

function statusChip(status: WorkItemStatus): ChipKind {
  if (status === "approval_needed" || status === "blocked") return "flag";
  if (status === "in_progress") return "accent";
  if (status.startsWith("waiting_on")) return "info";
  if (status === "done" || status === "cancelled") return "ghost";
  return "default";
}

/** The Open Engine + Brain panel for a single lead/project: stage-gate guidance,
 *  the record's own work queue, its knowledge, and its proof-of-work receipts. */
export function RecordOps({ ops }: { ops: RecordOps }) {
  const { kind, slug } = ops;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-5">
        <WorkQueue ops={ops} />
        <Knowledge ops={ops} />
      </div>
      <div className="space-y-4">
        <StageGateCard ops={ops} />
        <Receipts ops={ops} />
        <AddNote kind={kind} slug={slug} recordId={ops.recordId} />
      </div>
    </div>
  );
}

// ─── Stage-gate guidance (Phase 8) ───────────────────────────────────────────

function StageGateCard({ ops }: { ops: RecordOps }) {
  const g = ops.stageGate;
  return (
    <Card kind="ai" className="p-3.5">
      <Eyebrow>Stage gate · guidance</Eyebrow>
      <div className="mt-1.5 text-[12px] text-ink-2">
        Current {g.kind === "project" ? "status" : "stage"}:{" "}
        <span className="font-semibold text-ink">{g.currentStatus}</span>
        {g.phase && <span className="text-ink-4"> · {g.phase}</span>}
      </div>
      {g.nextStages.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-4">No further stages — this record is at the end of the ladder.</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {g.nextStages.map((s, i) => (
            <li key={s.stage} className={i ? "border-t border-rule-soft pt-2" : ""}>
              <div className="flex items-center gap-1.5">
                <Chip kind={i === 0 ? "accent" : "ghost"}>{i === 0 ? "next" : `+${i + 1}`}</Chip>
                <span className="font-mono text-[11px] text-ink-2">{s.stage}</span>
                {s.target && <span className="font-mono text-[10px] text-ink-4">→ {s.target}</span>}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{s.requirement}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2.5 text-[10.5px] italic text-ink-4">
        Guidance only — advancing isn&apos;t blocked. Use the header controls to move stage.
      </p>
    </Card>
  );
}

// ─── Scoped work queue (Phase 5) ─────────────────────────────────────────────

function WorkQueue({ ops }: { ops: RecordOps }) {
  const [showNew, setShowNew] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const nonEmpty = DETAIL_BUCKET_ORDER.filter((b) => ops.buckets[b].length > 0);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-serif text-[16px] font-semibold text-ink">Work queue</h3>
          <span className="font-mono text-[10px] text-ink-4">{ops.counts.open} open</span>
        </div>
        <button className={btnPrimary} onClick={() => setShowNew((v) => !v)}>
          {showNew ? "Close" : "Add work item"}
        </button>
      </div>

      {showNew && (
        <Card kind="soft" className="mb-3 p-4">
          <form
            ref={formRef}
            action={(fd) =>
              start(async () => {
                const r = await addRecordWorkItem(fd);
                if (r.ok) { formRef.current?.reset(); setShowNew(false); router.refresh(); }
                else alert(r.error);
              })
            }
            className="space-y-2.5"
          >
            <input type="hidden" name="kind" value={ops.kind} />
            <input type="hidden" name="slug" value={ops.slug} />
            <input type="hidden" name="record_id" value={ops.recordId} />
            <input name="title" placeholder="What needs to happen on this job?" className={inputCls} required />
            <textarea name="body" placeholder="Details / context (optional)" rows={2} className={inputCls} />
            <input name="due_at" type="date" className={inputCls} />
            <button type="submit" className={btnPrimary} disabled={pending}>
              {pending ? "Adding…" : "Add to this job"}
            </button>
          </form>
        </Card>
      )}

      {ops.items.length === 0 ? (
        <Card kind="dashed" className="p-6 text-center">
          <div className="text-[13px] font-semibold text-ink-2">No work items on this job yet</div>
          <p className="mx-auto mt-1 max-w-[420px] text-[12px] text-ink-4">
            Add the next action above, or agents can queue one via MCP (<span className="font-mono">create_work_item</span>).
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {nonEmpty.map((b) => (
            <div key={b}>
              <div className="mb-1.5 flex items-center gap-2">
                <Chip kind={BUCKET_CHIP[b]} dot>{DETAIL_BUCKET_LABEL[b]}</Chip>
                <span className="font-mono text-[10px] text-ink-4">{ops.buckets[b].length}</span>
              </div>
              <div className="space-y-2">
                {ops.buckets[b].map((it) => <WorkItemCard key={it.id} item={it} kind={ops.kind} slug={ops.slug} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function WorkItemCard({ item, kind, slug }: { item: RecordWorkItem; kind: RecordOps["kind"]; slug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  return (
    <Card kind={item.bucket === "approval" ? "flag" : "default"} className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip kind={statusChip(item.status)}>{STATUS_LABEL[item.status]}</Chip>
            {item.requiresApproval && <Chip kind="ghost">needs approval</Chip>}
            {item.expectedSkillSlug && <Chip kind="ai">skill: {item.expectedSkillSlug}</Chip>}
            {item.expectedRunbookSlug && <Chip kind="ai">runbook: {item.expectedRunbookSlug}</Chip>}
          </div>
          <div className="mt-1.5 text-[13px] font-semibold text-ink">{item.title}</div>
          {item.body && <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-3">{item.body}</div>}
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-ink-4">
            {item.dueAt && <span>due {item.dueAt.slice(0, 10)}</span>}
            {item.blockedReason && <span className="text-flag">{item.blockedReason}</span>}
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-1.5">
          {item.bucket === "approval" ? (
            <>
              <button className={btnPrimary} disabled={pending} onClick={() => run(() => approveRecordWorkItem(item.id, kind, slug))}>Approve</button>
              <button className={btnCls} disabled={pending} onClick={() => run(() => rejectRecordWorkItem(item.id, kind, slug))}>Reject</button>
            </>
          ) : (
            <select
              className="rounded-md border border-rule bg-paper px-2 py-1 text-[11px] text-ink-2 outline-none focus:border-accent"
              value={item.status}
              disabled={pending}
              onChange={(e) => run(() => setRecordWorkItemStatus(item.id, e.target.value as WorkItemStatus, kind, slug))}
            >
              {WORK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Scoped knowledge (Phase 6) ──────────────────────────────────────────────

function Knowledge({ ops }: { ops: RecordOps }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-serif text-[16px] font-semibold text-ink">Knowledge on this job</h3>
        <span className="font-mono text-[10px] text-ink-4">{ops.knowledge.length}</span>
      </div>
      {ops.knowledge.length === 0 ? (
        <Card kind="dashed" className="p-6 text-center">
          <div className="text-[13px] font-semibold text-ink-2">No knowledge captured yet</div>
          <p className="mx-auto mt-1 max-w-[420px] text-[12px] text-ink-4">
            Durable facts, decisions, client preferences, scope summaries. Add one from the panel on the right.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {ops.knowledge.map((k) => (
            <li key={k.id}>
              <Card kind="soft" className="p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip kind="accent">{k.kind}</Chip>
                  <Chip kind="ghost">{k.source}</Chip>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{k.content}</p>
                <div className="mt-1 font-mono text-[10px] text-ink-4">{k.createdBy} · {k.createdAt.slice(0, 10)}</div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddNote({ kind, slug, recordId }: { kind: RecordOps["kind"]; slug: string; recordId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <Card kind="soft" className="p-3.5">
      <Eyebrow>Add a durable note</Eyebrow>
      <p className="mt-1 text-[11px] text-ink-4">
        Facts, decisions, preferences, or a file/thread summary — not transient task progress.
      </p>
      <form
        ref={ref}
        action={(fd) =>
          start(async () => {
            const r = await captureRecordKnowledge(fd);
            if (r.ok) { ref.current?.reset(); router.refresh(); }
            else alert(r.error);
          })
        }
        className="mt-2 space-y-2.5"
      >
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="record_id" value={recordId} />
        <textarea name="content" placeholder="e.g. Client prefers Cambria quartz; approved $500 allowance bump." rows={3} className={inputCls} required />
        <select name="knowledge_kind" defaultValue="note" className={inputCls}>
          {KNOWLEDGE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button type="submit" className={btnPrimary} disabled={pending}>Save note</button>
      </form>
    </Card>
  );
}

// ─── Proof-of-work receipts (Phase 7) ────────────────────────────────────────

function Receipts({ ops }: { ops: RecordOps }) {
  return (
    <Card kind="soft" className="p-3.5">
      <Eyebrow muted>Receipts · proof of work</Eyebrow>
      {ops.receipts.length === 0 ? (
        <p className="mt-2 text-[11px] text-ink-4">
          Owner and agent actions on this job (status changes, approvals, files, emails) log here as they happen.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {ops.receipts.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-[12px]">
              <Chip kind="ghost">{r.receiptKind}</Chip>
              <span className="min-w-0 flex-1 truncate text-ink-3">{r.label || r.uri || "—"}</span>
              <span className="font-mono text-[10px] text-ink-4">{r.createdAt.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
