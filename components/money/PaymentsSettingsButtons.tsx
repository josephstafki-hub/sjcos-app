"use client";

import { useTransition, useState } from "react";
import { runAction } from "@/lib/run-action";

/** "Test connection" for Settings › Payments (A20). */
export function PaymentsSettingsButtons({ test }: { test: () => Promise<{ ok: boolean; error?: string; capabilities?: Record<string, unknown> }> }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runAction(test, { fallback: "Connection test failed." });
            if (r.ok) setNote("Connection checked — see the checklist above.");
          })
        }
        className="rounded-md border border-rule px-3 py-1.5 text-[12px] text-ink disabled:opacity-50"
      >
        {pending ? "Testing…" : "Test connection"}
      </button>
      {note && <span className="text-[11.5px] text-ink-3">{note}</span>}
    </div>
  );
}
