"use client";

import { useState } from "react";
import { Camera, X } from "lucide-react";
import { Card } from "@/components/ui";
import type { DailyLogEntry } from "@/lib/schedule";

/** A logged day in the daily-log lane. Click opens the full entry (the truncated
 *  card body is just a preview). */
export function LogCard({ log }: { log: DailyLogEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-left focus:outline-none">
        <Card className="flex min-h-[110px] flex-col p-2.5 transition-colors hover:bg-paper-2">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-accent-2">
            {log.dow}
            {log.today ? " · TODAY" : ""}
          </div>
          <p className="mt-1.5 line-clamp-4 flex-1 text-[11px] leading-snug text-ink-2">{log.body}</p>
          {log.photos > 0 && (
            <div className="mt-2 flex items-center gap-1 text-ink-3">
              <Camera className="size-3" strokeWidth={1.5} />
              <span className="font-mono text-[10px]">{log.photos}</span>
            </div>
          )}
        </Card>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[520px] rounded-lg border border-rule bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <div>
                <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-accent-2">
                  Daily log · {log.dow}
                </div>
                <h2 className="font-serif text-[17px] font-semibold text-ink">{log.iso}</h2>
              </div>
              <button onClick={() => setOpen(false)} className="text-ink-3 hover:text-ink" aria-label="Close">
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="p-4">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{log.body}</p>
              {log.photos > 0 && (
                <div className="mt-3 flex items-center gap-1.5 text-ink-3">
                  <Camera className="size-3.5" strokeWidth={1.5} />
                  <span className="text-[12px]">{log.photos} photo{log.photos === 1 ? "" : "s"} attached</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
