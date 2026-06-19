"use client";

import { useState, useTransition } from "react";
import { Check, Pencil } from "lucide-react";
import { Card } from "@/components/ui";
import { saveIntakeAnswer } from "@/lib/actions/leads";

type Item = { label: string; value: string };

/** Editable 5-question intake. Each answer saves on blur (or Cmd+Enter) via the
 *  saveIntakeAnswer action; optimistic local state, owner-gated server-side. */
export function LeadIntake({ slug, items }: { slug: string; items: Item[] }) {
  return (
    <Card className="p-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className="flex-1 font-serif text-[16px] font-semibold text-ink">
          5-Question intake
        </h3>
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          <Pencil className="size-3" strokeWidth={1.5} /> click to edit
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <IntakeField key={it.label} slug={slug} label={it.label} value={it.value} />
        ))}
      </div>
    </Card>
  );
}

function IntakeField({ slug, label, value }: { slug: string; label: string; value: string }) {
  const [val, setVal] = useState(value);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);

  function commit() {
    if (!dirty) return;
    start(async () => {
      const res = await saveIntakeAnswer(slug, label, val);
      if (res.ok) {
        setDirty(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        {label}
        {pending && <span className="text-ink-4">saving…</span>}
        {saved && <Check className="size-3 text-money" strokeWidth={2} />}
      </div>
      <textarea
        value={val}
        rows={2}
        placeholder="—"
        onChange={(e) => {
          setVal(e.target.value);
          setDirty(true);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        className="mt-0.5 w-full resize-y rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] text-ink-2 outline-none hover:border-rule-soft focus:border-accent focus:bg-paper"
      />
    </div>
  );
}
