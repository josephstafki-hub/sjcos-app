"use client";

import { useState, useTransition } from "react";
import { runAction } from "@/lib/run-action";

type Res = { ok: boolean; error?: string; detail?: unknown };

/** "Check connection" + "Import now" for Settings › Accounting (A14). */
export function AccountingSettingsButtons({ test, importNow }: { test: () => Promise<Res>; importNow: () => Promise<Res> }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const go = (fn: () => Promise<Res>, okText: string, fallback: string) =>
    start(async () => {
      const r = await runAction(fn, { fallback });
      if (r.ok) setNote(okText);
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={() => go(test, "Connection checked.", "Connection check failed.")} className="rounded-md border border-rule px-3 py-1.5 text-[12px] text-ink disabled:opacity-50">
        {pending ? "Working…" : "Check connection"}
      </button>
      <button type="button" disabled={pending} onClick={() => go(importNow, "Import pass finished — see batches below.", "Import failed.")} className="rounded-md border border-rule px-3 py-1.5 text-[12px] text-ink disabled:opacity-50">
        Import now
      </button>
      {note && <span className="text-[11.5px] text-ink-3">{note}</span>}
    </div>
  );
}
