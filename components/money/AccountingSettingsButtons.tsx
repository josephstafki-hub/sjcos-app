"use client";

import { useState, useTransition } from "react";
import { runAction } from "@/lib/run-action";

type Res = { ok: boolean; error?: string; detail?: unknown };

/** "Check connection" + "Import now" for Settings › Accounting (A14). */
export function AccountingSettingsButtons({ test, importNow, testMode = false, connected = false }: { testMode?: boolean; connected?: boolean; test: () => Promise<Res>; importNow: () => Promise<Res> }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const go = (fn: () => Promise<Res>, okText: string, fallback: string) =>
    start(async () => {
      const r = await runAction(fn, { fallback });
      setNote(r.ok ? okText : null);
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={() => go(test, testMode ? "Sample company checked — no live connection." : "Connection checked.", "Connection check failed.")} className="rounded-md border border-rule px-3 py-1.5 text-label text-ink disabled:opacity-50">
        {pending ? "Working…" : "Check connection"}
      </button>
      <button type="button" disabled={pending || (!testMode && !connected)} title={!testMode && !connected ? "Connect QuickBooks before importing" : undefined} onClick={() => go(importNow, testMode ? "Test import finished — see sample-company batches below." : "Import pass finished — see batches below.", "Import failed.")} className="rounded-md border border-rule px-3 py-1.5 text-label text-ink disabled:opacity-50">
        {testMode ? "Test import" : "Import now"}
      </button>
      {note && <span className="text-meta text-ink-3">{note}</span>}
    </div>
  );
}
