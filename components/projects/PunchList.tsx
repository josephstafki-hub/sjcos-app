"use client";

import { useState, useTransition } from "react";
import { Check, Plus, X } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { setPunchDone, addPunchItem, deletePunchItem } from "@/lib/actions/projects";

interface PunchItem {
  id: number;
  item: string;
  owner: string;
  done: boolean;
}

/** Interactive project punch list. Checkboxes toggle `done` (optimistic, then
 *  persisted via setPunchDone); the composer adds an item and rows can be
 *  removed. Owner-only — each action re-checks the role. */
export function PunchList({ slug, items }: { slug: string; items: PunchItem[] }) {
  const [rows, setRows] = useState(items);
  const [item, setItem] = useState("");
  const [owner, setOwner] = useState("");
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  function toggle(id: number, next: boolean) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, done: next } : r)));
    startTransition(async () => {
      try {
        await setPunchDone(id, next, slug);
      } catch {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, done: !next } : r)));
      }
    });
  }

  function add() {
    const text = item.trim();
    if (!text || adding) return;
    setAdding(true);
    startTransition(async () => {
      try {
        const created = await addPunchItem(slug, text, owner.trim());
        if (created) {
          setRows((prev) => [...prev, created]);
          setItem("");
          setOwner("");
        }
      } finally {
        setAdding(false);
      }
    });
  }

  function remove(id: number) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    startTransition(async () => {
      try {
        await deletePunchItem(id, slug);
      } catch {
        setRows(prev);
      }
    });
  }

  const open = rows.filter((r) => !r.done).length;
  const done = rows.filter((r) => r.done).length;

  return (
    <Card className="max-w-[680px] overflow-hidden p-0">
      <div className="border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        {open} open · {done} done
      </div>

      {rows.map((p, i) => (
        <div
          key={p.id}
          className={`group flex items-center gap-3 px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}
        >
          <button
            type="button"
            onClick={() => toggle(p.id, !p.done)}
            className="flex flex-1 items-center gap-3 text-left"
          >
            <span
              className={[
                "flex size-4 flex-none items-center justify-center rounded-[4px] border",
                p.done ? "border-money bg-money" : "border-ink-4",
              ].join(" ")}
            >
              {p.done && <Check className="size-3 text-paper" strokeWidth={2.5} />}
            </span>
            <span className={`flex-1 text-[13px] ${p.done ? "text-ink-3 line-through" : "text-ink"}`}>
              {p.item}
            </span>
          </button>
          {p.owner && <Chip kind="ghost">{p.owner}</Chip>}
          <button
            type="button"
            onClick={() => remove(p.id)}
            aria-label="Remove item"
            className="flex-none rounded p-0.5 text-ink-4 opacity-0 transition-opacity hover:text-flag group-hover:opacity-100"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      ))}

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex items-center gap-2 border-t border-rule bg-paper-2 px-4 py-2.5"
      >
        <Plus className="size-3.5 flex-none text-ink-3" strokeWidth={1.75} />
        <input
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="Add a punch item…"
          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
        />
        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="Owner"
          className="w-20 bg-transparent text-[12px] text-ink-2 outline-none placeholder:text-ink-4"
        />
        <button
          type="submit"
          disabled={!item.trim() || adding}
          className="flex-none rounded-md bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e] disabled:opacity-40"
        >
          Add
        </button>
      </form>
    </Card>
  );
}
