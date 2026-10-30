"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { removeSubFromProject } from "@/lib/actions/projects";
import { runAction } from "@/lib/run-action";
export function RemoveAssignmentButton({
  projectSlug,
  subSlug,
}: {
  projectSlug: string;
  subSlug: string;
}) {
  const [pending, start] = useTransition(),
    [error, setError] = useState("");
  const router = useRouter();
  return (
    <div>
      <details className="relative">
        <summary
          aria-label="Assignment actions"
          className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md hover:bg-hover max-sm:size-11"
        >
          <MoreHorizontal className="size-4" />
        </summary>
        <div className="absolute right-0 z-10 w-44 rounded-lg border border-rule-soft bg-card p-1 shadow-pop">
          <button
            disabled={pending}
            className="h-9 w-full rounded-md px-2 text-left text-body text-flag hover:bg-hover"
            onClick={() =>
              start(async () => {
                const r = await runAction(async () => {
                  await removeSubFromProject(projectSlug, subSlug);
                  return { ok: true };
                });
                if (r.ok) router.refresh();
                else setError(r.error ?? "Couldn't remove the assignment.");
              })
            }
          >
            Remove assignment
          </button>
        </div>
      </details>
      {error && (
        <p className="text-meta text-flag" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
