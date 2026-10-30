"use client";
import { useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button, SubmitButton } from "@/components/ui";
import {
  createScheduleBlock,
  updateScheduleBlock,
} from "@/lib/actions/schedule";
import { runAction } from "@/lib/run-action";
import { businessDate } from "@/lib/business-time";
import { parseScheduleTime } from "@/lib/schedule-time";
import { useDialogDismiss } from "@/lib/use-dialog-dismiss";
import type { ScheduleBlock } from "@/lib/schedule";
export interface ScheduleProjectOption {
  id: string;
  slug: string;
  name: string;
}
const input =
  "h-9 w-full min-w-0 rounded-md border border-rule bg-card px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-focus max-sm:h-11";
export function ScheduleBlockModal({
  triggerClassName,
  triggerContent,
  triggerAriaLabel,
  initialDate,
  projects = [],
  meeting = false,
  block,
}: {
  triggerClassName: string;
  triggerContent: ReactNode;
  triggerAriaLabel?: string;
  initialDate?: string;
  projects?: ScheduleProjectOption[];
  meeting?: boolean;
  block?: ScheduleBlock;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(initialDate ?? "");
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  useDialogDismiss(open, () => setOpen(false), trigger);
  let defaultTime = "";
  try {
    const t = parseScheduleTime(block?.time ?? "");
    defaultTime = t.label === "All day" ? "" : t.label;
  } catch {
    /* legacy labels must be corrected before saving */
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setDate(initialDate ?? businessDate());
          setError("");
          setOpen(true);
        }}
        aria-label={triggerAriaLabel}
        className={triggerClassName}
      >
        {triggerContent}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-dialog-title"
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-rule-soft bg-card shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule-soft px-5 py-4">
              <h2 id="schedule-dialog-title" className="font-serif text-title">
                {block
                  ? "Edit time block"
                  : meeting
                    ? "New meeting"
                    : "New time block"}
              </h2>
              <Button
                icon={X}
                iconOnly
                aria-label="Close"
                title="Close"
                onClick={() => setOpen(false)}
              />
            </div>
            <form
              className="space-y-4 p-5"
              action={async (fd) => {
                setError("");
                const r = await runAction(() =>
                  block?.id
                    ? updateScheduleBlock(block.id, fd)
                    : createScheduleBlock(fd),
                );
                if (r.ok) setOpen(false);
                else setError(r.error ?? "Couldn't save this block.");
              }}
            >
              <label className="block text-label text-ink-2">
                What
                <input
                  autoFocus
                  name="label"
                  required
                  defaultValue={block?.label}
                  placeholder={meeting ? "Client walkthrough" : "Work planned"}
                  className={`${input} mt-1.5`}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="min-w-0 text-label text-ink-2">
                  Date
                  <input
                    name="date"
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={`${input} mt-1.5`}
                  />
                </label>
                <label className="min-w-0 text-label text-ink-2">
                  Time · Central
                  <input
                    name="time"
                    type="time"
                    defaultValue={defaultTime}
                    className={`${input} mt-1.5`}
                  />
                </label>
              </div>
              <p className="text-meta text-ink-3">
                Leave time blank for all day. Start times do not reserve a
                duration.
              </p>
              <label className="block text-label text-ink-2">
                Project
                <select
                  name="project_id"
                  defaultValue={block?.projectId ?? ""}
                  className={`${input} mt-1.5`}
                >
                  <option value="">No project · standalone meeting</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-label text-ink-2">
                Type
                <select
                  name="tone"
                  defaultValue={block?.tone ?? (meeting ? "ghost" : "accent")}
                  className={`${input} mt-1.5`}
                >
                  <option value="accent">Job</option>
                  <option value="ai">AI-scheduled</option>
                  <option value="ghost">Routine / other</option>
                </select>
              </label>
              {error && (
                <p role="alert" className="text-meta text-flag">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <SubmitButton pendingLabel="Saving…">
                  {block
                    ? "Save changes"
                    : meeting
                      ? "Add meeting"
                      : "Add block"}
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
