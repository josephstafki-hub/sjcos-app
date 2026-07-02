"use client";

import { useState, useTransition } from "react";
import { Check, Plus, X, Calendar } from "lucide-react";
import { Card } from "@/components/ui";
import { addLeadTask, setLeadTaskDone, deleteLeadTask } from "@/lib/actions/lead-tasks";
import type { LeadTask } from "@/lib/lead-tasks";

/** Per-lead follow-up checklist. Checkboxes toggle done (optimistic, persisted);
 *  the composer adds a task with an optional due date; rows can be removed.
 *  Owner-only — each action re-checks the role server-side. */
export function LeadTasks({ slug, tasks }: { slug: string; tasks: LeadTask[] }) {
  const [rows, setRows] = useState(tasks);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [adding, setAdding] = useState(false);
  const [, start] = useTransition();

  function toggle(id: number, next: boolean) {
    setRows((prev) =>
      [...prev.map((r) => (r.id === id ? { ...r, done: next } : r))].sort(
        (a, b) => Number(a.done) - Number(b.done),
      ),
    );
    start(async () => {
      try {
        await setLeadTaskDone(id, next, slug);
      } catch {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, done: !next } : r)));
      }
    });
  }

  function add() {
    const text = title.trim();
    if (!text || adding) return;
    setAdding(true);
    start(async () => {
      try {
        const created = await addLeadTask(slug, text, due);
        if (created) {
          setRows((prev) => [...prev, created]);
          setTitle("");
          setDue("");
        }
      } finally {
        setAdding(false);
      }
    });
  }

  function remove(id: number) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    start(async () => {
      try {
        await deleteLeadTask(id, slug);
      } catch {
        setRows(prev);
      }
    });
  }

  const open = rows.filter((r) => !r.done).length;
  const done = rows.filter((r) => r.done).length;

  function dueLabel(iso: string): { text: string; overdue: boolean } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(iso + "T00:00:00");
    const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    if (days < 0) return { text: `${-days}d overdue`, overdue: true };
    if (days === 0) return { text: "due today", overdue: false };
    if (days === 1) return { text: "due tomorrow", overdue: false };
    return { text: `due in ${days}d`, overdue: false };
  }

  return (
    <Card className="max-w-[680px] overflow-hidden p-0">
      <div className="border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        {open} open · {done} done
      </div>

      {rows.map((t, i) => {
        const dl = t.dueDate && !t.done ? dueLabel(t.dueDate) : null;
        return (
          <div
            key={t.id}
            className={`group flex items-center gap-3 px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}
          >
            <button
              type="button"
              onClick={() => toggle(t.id, !t.done)}
              className={`flex size-4 flex-none items-center justify-center rounded-[4px] border ${
                t.done ? "border-money bg-money text-white" : "border-ink-4 hover:border-ink-3"
              }`}
              aria-label={t.done ? "Mark not done" : "Mark done"}
            >
              {t.done && <Check className="size-3" strokeWidth={3} />}
            </button>
            <span className={`min-w-0 flex-1 text-[13px] ${t.done ? "text-ink-4 line-through" : "text-ink"}`}>
              {t.title}
            </span>
            {dl && (
              <span
                className={`inline-flex items-center gap-1 font-mono text-[10px] ${
                  dl.overdue ? "text-flag" : "text-ink-3"
                }`}
              >
                <Calendar className="size-3" strokeWidth={1.5} />
                {dl.text}
              </span>
            )}
            <button
              type="button"
              onClick={() => remove(t.id)}
              className="flex-none text-ink-4 opacity-0 transition-opacity hover:text-flag group-hover:opacity-100"
              aria-label="Delete task"
            >
              <X className="size-3.5" strokeWidth={1.5} />
            </button>
          </div>
        );
      })}

      {rows.length === 0 && (
        <div className="px-4 py-6 text-center text-[12px] text-ink-3">
          No tasks yet. Add the next follow-up below.
        </div>
      )}

      {/* Composer */}
      <div className="flex items-center gap-2 border-t border-rule bg-paper-2 px-4 py-2.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a follow-up…"
          className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="flex-none rounded-md border border-rule bg-paper px-2 py-1.5 font-mono text-[12px] text-ink-2 outline-none focus:border-accent"
          aria-label="Due date"
        />
        <button
          type="button"
          onClick={add}
          disabled={adding || !title.trim()}
          className="inline-flex flex-none items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
        >
          <Plus className="size-3.5" strokeWidth={2} /> Add
        </button>
      </div>
    </Card>
  );
}
