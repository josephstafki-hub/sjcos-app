"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { createScheduleBlock } from "@/lib/actions/schedule";
import { SubmitButton } from "@/components/ui";

/** A project option for the picker. Mirrors lib/schedule ScheduleProject but
 *  declared locally so this client file never imports the db-coupled lib. */
export interface ScheduleProjectOption {
  id: string;
  slug: string;
  name: string;
}

/** Add-time-block modal, reused by the header "Block" button and the per-day
 *  "+" on the week strip. `initialDate` (YYYY-MM-DD) prefills the date; the
 *  header omits it and defaults to today. `projects` populates the project
 *  picker; `meeting` mode reframes it as a standalone (non-project) meeting. */
export function ScheduleBlockModal({
  triggerClassName,
  triggerContent,
  triggerAriaLabel,
  initialDate,
  projects = [],
  meeting = false,
}: {
  triggerClassName: string;
  triggerContent: ReactNode;
  triggerAriaLabel?: string;
  initialDate?: string;
  projects?: ScheduleProjectOption[];
  meeting?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(initialDate ?? "");

  useEffect(() => {
    // en-CA renders YYYY-MM-DD in local time. Default to today when unset.
    if (!date) setDate(initialDate ?? new Date().toLocaleDateString("en-CA"));
  }, [date, initialDate]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={triggerAriaLabel}
        className={triggerClassName}
      >
        {triggerContent}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[440px] rounded-lg border border-rule bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h2 className="font-serif text-[17px] font-semibold text-ink">
                {meeting ? "New meeting" : "New time block"}
              </h2>
              <button onClick={() => setOpen(false)} className="text-ink-3 hover:text-ink" aria-label="Close">
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>

            <form
              action={async (fd) => {
                await createScheduleBlock(fd);
                setOpen(false);
              }}
              className="flex flex-col gap-3 p-4"
            >
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">What</span>
                <input
                  name="label"
                  required
                  autoFocus
                  placeholder={meeting ? "Client walkthrough" : "Tile — Henderson"}
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Date</span>
                  <input
                    name="date"
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                  />
                </label>
                <label className="flex w-[110px] flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Time</span>
                  <input
                    name="time"
                    placeholder="8:00"
                    className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Project</span>
                <select
                  name="project_id"
                  defaultValue=""
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                >
                  <option value="">No project — standalone meeting</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Type</span>
                <select
                  name="tone"
                  defaultValue={meeting ? "ghost" : "accent"}
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                >
                  <option value="accent">Job</option>
                  <option value="ai">AI-scheduled</option>
                  <option value="ghost">Routine / other</option>
                </select>
              </label>

              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2"
                >
                  Cancel
                </button>
                <SubmitButton
                  pendingLabel="Adding…"
                  className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
                >
                  {meeting ? "Add meeting" : "Add block"}
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
