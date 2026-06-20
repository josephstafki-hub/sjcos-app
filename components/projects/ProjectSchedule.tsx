"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Card } from "@/components/ui";
import { createProjectScheduleBlock, deleteScheduleBlock } from "@/lib/actions/schedule";

interface Block {
  id: string;
  iso: string;
  dateLabel: string;
  time: string;
  label: string;
  tone: "accent" | "ai" | "ghost";
}

const DOT: Record<string, string> = {
  accent: "bg-accent",
  ai: "bg-ai",
  ghost: "bg-ink-4",
};

/** Project Schedule tab — real, project-scoped blocks. Owner can add (date +
 *  time + label) and remove blocks; they also appear on the cross-project
 *  /schedule overview linked to this job. */
export function ProjectSchedule({ slug, blocks }: { slug: string; blocks: Block[] }) {
  const [rows, setRows] = useState(blocks);
  const [adding, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const add = createProjectScheduleBlock.bind(null, slug);

  function remove(id: string) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    startTransition(async () => {
      try {
        await deleteScheduleBlock(id, slug);
      } catch {
        setRows(prev);
      }
    });
  }

  return (
    <Card className="max-w-[680px] overflow-hidden p-0">
      <div className="border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        {rows.length} block{rows.length === 1 ? "" : "s"} scheduled
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12px] text-ink-3">
          No blocks scheduled for this project yet.
        </div>
      ) : (
        rows.map((b, i) => (
          <div
            key={b.id}
            className={`group flex items-center gap-3 px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}
          >
            <span className="w-24 flex-none font-mono text-[11px] text-ink-3">{b.dateLabel}</span>
            <span className={`size-1.5 flex-none rounded-full ${DOT[b.tone]}`} />
            <span className="flex-1 text-[13px] text-ink">{b.label}</span>
            <span className="flex-none font-mono text-[11px] text-ink-3">{b.time}</span>
            <button
              type="button"
              onClick={() => remove(b.id)}
              aria-label="Remove block"
              className="flex-none rounded p-0.5 text-ink-4 opacity-0 transition-opacity hover:text-flag group-hover:opacity-100"
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        ))
      )}

      {/* Composer */}
      <form
        ref={formRef}
        action={async (fd) => {
          await add(fd);
          formRef.current?.reset();
          router.refresh();
        }}
        className="flex flex-wrap items-center gap-2 border-t border-rule bg-paper-2 px-4 py-2.5"
      >
        <Plus className="size-3.5 flex-none text-ink-3" strokeWidth={1.75} />
        <input
          name="date"
          type="date"
          required
          className="rounded border border-rule bg-card px-1.5 py-0.5 text-[12px] text-ink-2 outline-none"
        />
        <input
          name="time"
          placeholder="8:00"
          className="w-16 rounded border border-rule bg-card px-1.5 py-0.5 text-[12px] text-ink-2 outline-none placeholder:text-ink-4"
        />
        <input
          name="label"
          required
          placeholder="What's happening…"
          className="min-w-[120px] flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
        />
        <button
          type="submit"
          disabled={adding}
          className="flex-none rounded-md bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e] disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </Card>
  );
}
