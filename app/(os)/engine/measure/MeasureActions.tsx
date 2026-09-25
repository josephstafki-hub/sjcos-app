"use client";

import { useState, useTransition } from "react";
import { runProcedureChecks } from "@/lib/measure/actions";
import { runAction } from "@/lib/run-action";

const btnCls =
  "rounded-md border border-ink-4 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40";

export function MeasureActions() {
  const [pending, start] = useTransition();
  const [info, setInfo] = useState("");
  return (
    <div className="flex items-center gap-2">
      {info ? <span className="text-[12px] text-ink-3">{info}</span> : null}
      <button
        type="button"
        className={btnCls}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runAction(() => runProcedureChecks());
            if (r && r.ok !== false && "info" in r) setInfo(r.info ?? "");
          })
        }
      >
        {pending ? "Checking…" : "Snapshot + run checks"}
      </button>
    </div>
  );
}
