"use client";

import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { useDialogDismiss } from "@/lib/use-dialog-dismiss";
import { Card } from "@/components/ui";
import type { DailyLogEntry } from "@/lib/schedule";

/** A logged day in the daily-log lane. Click opens the full entry (the truncated
 *  card body is just a preview). */
export function LogCard({ log }: { log: DailyLogEntry }) {
  const [open, setOpen] = useState(false);

  const trigger = useRef<HTMLButtonElement>(null);
  useDialogDismiss(open, () => setOpen(false), trigger);
  return (
    <>
      <button
        ref={trigger}
        onClick={() => setOpen(true)}
        className="text-left focus:outline-none"
      >
        <Card className="flex min-h-20 flex-col p-2.5 transition-colors hover:bg-paper-2">
          <div className="text-label font-semibold text-accent-2">
            {log.dow[0] + log.dow.slice(1).toLowerCase()}
            {log.today ? " · Today" : ""}
          </div>
          <p className="mt-1.5 line-clamp-2 flex-1 text-meta leading-snug text-ink-2">
            {log.body}
          </p>
          {log.photos > 0 && (
            <div className="mt-2 flex items-center gap-1 text-ink-3">
              <Camera className="size-3" strokeWidth={1.5} />
              <span className="text-meta">{log.photos}</span>
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
            role="dialog"
            aria-modal="true"
            aria-label="Daily log"
            className="w-full max-w-lg rounded-xl border border-rule-soft bg-card shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <div>
                <div className="text-label font-semibold text-accent-2">
                  Daily log · {log.dow[0] + log.dow.slice(1).toLowerCase()}
                </div>
                <h2 className="font-serif text-heading font-semibold text-ink">
                  {log.iso}
                </h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-ink-3 hover:text-ink"
                aria-label="Close"
              >
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="p-4">
              <p className="whitespace-pre-wrap text-body leading-relaxed text-ink-2">
                {log.body}
              </p>
              {log.photos > 0 && (
                <div className="mt-3 flex items-center gap-1.5 text-ink-3">
                  <Camera className="size-3.5" strokeWidth={1.5} />
                  <span className="text-meta">
                    {log.photos} photo{log.photos === 1 ? "" : "s"} attached
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
