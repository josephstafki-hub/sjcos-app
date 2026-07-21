"use client";

// Drip sequences (P7-N): ordered issues that auto-send to new subscribers on a
// schedule Joe sets.
//
// This panel arms the ONE path in the newsletter feature that emails real people
// without a Release click, so the UI says so plainly rather than hiding it behind
// a neutral toggle. The scary copy is deliberate — everywhere else in this app a
// send is a decision, and the moment that stops being true should not feel
// routine.

import { useState, type TransitionStartFunction } from "react";
import { Clock, Plus, Trash2, Zap } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import {
  addSequenceStep,
  createSequence,
  deleteSequence,
  refreshSequences,
  removeSequenceStep,
  setSequenceActive,
  updateSequenceStep,
} from "@/lib/actions/newsletter";
import type { NewsletterIssue, Sequence } from "@/lib/newsletter";

/** "the day they subscribe" reads better than "day 0" for the first step. */
function delayLabel(days: number): string {
  if (days === 0) return "immediately";
  if (days === 1) return "1 day later";
  if (days % 7 === 0) return `${days / 7} week${days === 7 ? "" : "s"} later`;
  return `${days} days later`;
}

export function SequencePanel({
  sequences,
  issues,
  pending,
  onChanged,
  onNotice,
  start,
}: {
  sequences: Sequence[];
  issues: NewsletterIssue[];
  pending: boolean;
  onChanged: (next: Sequence[]) => void;
  onNotice: (msg: string | null) => void;
  start: TransitionStartFunction;
}) {
  const [newName, setNewName] = useState("");

  /** Every mutation re-reads from the server rather than patching local state —
   *  the step ordering and subscriber counts are computed in SQL, so guessing
   *  them here would drift. */
  function run(fn: () => Promise<{ ok: boolean; error?: string }>, note?: string) {
    onNotice(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        onNotice(res.error ?? "That didn't work.");
      } else if (note) {
        onNotice(note);
      }
      onChanged(await refreshSequences());
    });
  }

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-flag/40 bg-flag-soft/40 px-3 py-2">
        <Zap className="mt-0.5 size-4 shrink-0 text-flag" strokeWidth={1.5} />
        <p className="text-[12px] leading-snug text-ink-2">
          A sequence that is <b>on</b> emails people automatically — no Outbox, no Release step.
          Everyone you add from then on gets these issues on this schedule. Sent mail still appears
          in the Outbox history so you can see exactly what went out.
        </p>
      </div>

      {sequences.length === 0 && (
        <div className="px-2 py-6 text-center text-[12px] text-ink-3">
          No automations yet. A welcome series is the usual first one: a hello right away, a
          project story a week later, a seasonal tip after a month.
        </div>
      )}

      {sequences.map((seq) => (
        <SequenceCard
          key={seq.id}
          seq={seq}
          issues={issues}
          pending={pending}
          run={run}
        />
      ))}

      <Card className="p-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">New automation</div>
        <div className="mt-1.5 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                run(() => createSequence(newName));
                setNewName("");
              }
            }}
            placeholder="Welcome series"
            className="flex-1 rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={pending || !newName.trim()}
            onClick={() => {
              run(() => createSequence(newName));
              setNewName("");
            }}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
          >
            <Plus className="size-3.5" strokeWidth={2} /> Create
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-3">Starts switched off. Add steps, then turn it on.</p>
      </Card>
    </div>
  );
}

function SequenceCard({
  seq,
  issues,
  pending,
  run,
}: {
  seq: Sequence;
  issues: NewsletterIssue[];
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, note?: string) => void;
  }) {
  const [addIssue, setAddIssue] = useState("");
  const [addDelay, setAddDelay] = useState("7");

  const usedIds = new Set(seq.steps.map((s) => s.newsletterId));
  const available = issues.filter((i) => !usedIds.has(i.id));

  function toggle() {
    if (!seq.active) {
      const n = seq.subscriberCount;
      if (
        !confirm(
          `Turn on "${seq.name}"?\n\n` +
            `From now on, everyone you add to the list will be emailed these ${seq.steps.length} ` +
            `issue(s) automatically, on this schedule, without another confirmation.\n\n` +
            `Your ${n === 0 ? "existing" : n.toString()} current contacts will also be enrolled, ` +
            `with their timers starting today.`,
        )
      )
        return;
    }
    run(
      () => setSequenceActive(seq.id, !seq.active),
      seq.active ? `"${seq.name}" is off. Nothing further will send.` : `"${seq.name}" is live.`,
    );
  }

  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-rule-soft px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-ink">{seq.name}</div>
          <div className="font-mono text-[10px] text-ink-3">
            {seq.steps.length} step{seq.steps.length === 1 ? "" : "s"} ·{" "}
            {seq.subscriberCount} active subscriber{seq.subscriberCount === 1 ? "" : "s"}
          </div>
        </div>
        {seq.active ? <Chip kind="flag">SENDING</Chip> : <Chip kind="ghost">OFF</Chip>}
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={`rounded-md px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50 ${
            seq.active
              ? "border border-rule text-ink-2 hover:bg-paper-2"
              : "bg-accent text-white hover:bg-accent-2"
          }`}
        >
          {seq.active ? "Turn off" : "Turn on"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete "${seq.name}"? Subscribers stop receiving it immediately.`))
              run(() => deleteSequence(seq.id));
          }}
          disabled={pending}
          className="text-ink-4 hover:text-flag disabled:opacity-50"
          aria-label="Delete automation"
        >
          <Trash2 className="size-3.5" strokeWidth={1.5} />
        </button>
      </div>

      {seq.steps.length === 0 ? (
        <div className="px-4 py-4 text-center text-[12px] text-ink-3">
          No steps yet — add an issue below.
        </div>
      ) : (
        seq.steps.map((step, i) => (
          <div key={step.id} className={`flex items-center gap-2 px-4 py-2.5 ${i ? "border-t border-rule-soft" : ""}`}>
            <Clock className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-ink">{step.issueTitle}</div>
              <div className="font-mono text-[10px] text-ink-3">
                sends {delayLabel(step.delayDays)}
              </div>
            </div>
            <label className="flex items-center gap-1 text-[11px] text-ink-3">
              day
              <input
                type="number"
                min={0}
                max={3650}
                defaultValue={step.delayDays}
                disabled={pending || seq.active}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== step.delayDays) run(() => updateSequenceStep(step.id, v));
                }}
                className="w-14 rounded-md border border-rule bg-paper px-1.5 py-0.5 text-[12px] text-ink outline-none focus:border-accent disabled:bg-paper-2"
              />
            </label>
            <button
              type="button"
              onClick={() => run(() => removeSequenceStep(step.id))}
              disabled={pending || seq.active}
              className="text-ink-4 hover:text-flag disabled:opacity-30"
              aria-label="Remove step"
            >
              <Trash2 className="size-3.5" strokeWidth={1.5} />
            </button>
          </div>
        ))
      )}

      {/* Steps are frozen while live — re-timing a running sequence mid-flight is
          how people accidentally re-mail their whole list. */}
      {seq.active ? (
        <div className="border-t border-rule-soft px-4 py-2.5 text-[11px] text-ink-3">
          Turn this off to change its steps.
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-rule-soft px-4 py-2.5">
          <select
            value={addIssue}
            onChange={(e) => setAddIssue(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink-2 outline-none focus:border-accent"
          >
            <option value="">Add an issue as a step…</option>
            {available.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-[11px] text-ink-3">
            day
            <input
              type="number"
              min={0}
              max={3650}
              value={addDelay}
              onChange={(e) => setAddDelay(e.target.value)}
              className="w-14 rounded-md border border-rule bg-paper px-1.5 py-0.5 text-[12px] text-ink outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            disabled={pending || !addIssue}
            onClick={() => {
              run(() => addSequenceStep(seq.id, Number(addIssue), Number(addDelay)));
              setAddIssue("");
            }}
            className="inline-flex items-center gap-1 rounded-md border border-rule px-2 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
          >
            <Plus className="size-3.5" strokeWidth={2} /> Add
          </button>
        </div>
      )}
    </Card>
  );
}
