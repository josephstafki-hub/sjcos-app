"use client";
import { useRef, useState, useTransition } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, SubmitButton } from "@/components/ui";
import {
  archiveDirectoryRecord,
  saveDirectoryRecord,
} from "@/lib/actions/directory-maintenance";
import { useDialogDismiss } from "@/lib/use-dialog-dismiss";
import { runAction } from "@/lib/run-action";

type RecordProps = {
  table: "subs" | "vendors";
  slug: string;
  name: string;
  trade: string;
  email: string;
  phone: string;
  rate?: string;
  archived: boolean;
};
export function DirectoryRecordMenu(props: RecordProps) {
  const [open, setOpen] = useState(false),
    [pending, start] = useTransition(),
    [error, setError] = useState("");
  const router = useRouter();
  const trigger = useRef<HTMLElement | null>(null);
  useDialogDismiss(open, () => setOpen(false), trigger);
  const field =
    "h-9 w-full min-w-0 rounded-md border border-rule bg-card px-3 text-body focus:border-accent focus:outline-none";
  function archive() {
    start(async () => {
      const r = await runAction(() =>
        archiveDirectoryRecord(props.table, props.slug, !props.archived),
      );
      if (!r.ok) setError(r.error ?? "Couldn't update this record.");
      else router.refresh();
    });
  }
  return (
    <div className="relative">
      <details className="relative">
        <summary
          ref={trigger}
          aria-label={`More actions for ${props.name}`}
          title="More actions"
          className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md border border-rule bg-card text-ink-2 hover:bg-hover max-sm:size-11"
        >
          <MoreHorizontal className="size-4" />
        </summary>
        <div className="absolute right-0 z-20 mt-1 min-w-40 rounded-lg border border-rule-soft bg-card p-1 shadow-pop">
          <button
            onClick={(e) => {
              e.currentTarget.closest("details")?.removeAttribute("open");
              setError("");
              setOpen(true);
            }}
            className="h-9 w-full rounded-md px-3 text-left text-body hover:bg-hover"
          >
            Edit details
          </button>
          <button
            disabled={pending}
            onClick={(e) => {
              e.currentTarget.closest("details")?.removeAttribute("open");
              archive();
            }}
            className="h-9 w-full rounded-md px-3 text-left text-body text-flag hover:bg-hover"
          >
            {props.archived ? "Restore" : "Archive"}
          </button>
        </div>
      </details>
      {error && !open && (
        <p role="alert" className="mt-2 text-meta text-flag">
          {error}
        </p>
      )}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-12"
          onClick={() => setOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Edit details"
            className="w-full max-w-lg rounded-lg border border-rule bg-card shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h2 className="font-serif text-title">Edit details</h2>
              <Button
                icon={X}
                iconOnly
                aria-label="Close"
                title="Close"
                onClick={() => setOpen(false)}
              />
            </div>
            <form
              className="space-y-4 p-4"
              action={async (fd) => {
                const r = await runAction(() =>
                  saveDirectoryRecord(props.table, props.slug, fd),
                );
                if (r.ok) {
                  setOpen(false);
                  router.refresh();
                } else setError(r.error ?? "Couldn't save the record.");
              }}
            >
              {(
                [
                  ["name", "Name"],
                  ["trade", "Trade"],
                  ["email", "Email"],
                  ["phone", "Phone"],
                  ...(props.table === "subs" && props.rate !== undefined
                    ? [["rate", "Rate"]]
                    : []),
                ] as const
              ).map(([key, label]) => (
                <label className="block space-y-1.5" key={key}>
                  <span className="text-label text-ink-2">{label}</span>
                  <input
                    className={field}
                    name={key}
                    type={key === "email" ? "email" : "text"}
                    required={key === "name"}
                    autoFocus={key === "name"}
                    defaultValue={
                      (props[key as keyof RecordProps] as string) ?? ""
                    }
                  />
                </label>
              ))}
              {error && (
                <p role="alert" className="text-meta text-flag">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
