"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { convertLeadToProject } from "@/lib/actions/leads";
import { SubmitButton } from "@/components/ui";

/** "Convert to project" button + confirm modal. The owner reviews/edits the
 *  suggested project name (the last-name + scope-head heuristic is only a
 *  prefill) before convertLeadToProject creates the project and opens it. */
export function ConvertLeadButton({
  slug,
  suggestedName,
}: {
  slug: string;
  suggestedName: string;
}) {
  const [open, setOpen] = useState(false);

  async function handle(formData: FormData) {
    const name = String(formData.get("project_name") ?? "");
    await convertLeadToProject(slug, name);
    // On success the action redirects to the new project, so we never get here.
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-accent bg-accent px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-accent-2"
      >
        Convert to project
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
              <h2 className="font-serif text-[17px] font-semibold text-ink">Convert to project</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-ink-3 hover:text-ink"
                aria-label="Close"
              >
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>

            <form action={handle} className="flex flex-col gap-3 p-4">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                  Project name
                </span>
                <input
                  name="project_name"
                  required
                  autoFocus
                  defaultValue={suggestedName}
                  maxLength={80}
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </label>
              <p className="text-[12px] text-ink-3">
                This names the project and its link — you can tweak it before creating.
              </p>

              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2"
                >
                  Cancel
                </button>
                <SubmitButton
                  pendingLabel="Creating…"
                  className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2"
                >
                  Create project
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
