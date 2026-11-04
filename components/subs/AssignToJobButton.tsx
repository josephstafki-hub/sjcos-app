"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDialogDismiss } from "@/lib/use-dialog-dismiss";
import { Button } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import { Check } from "lucide-react";
import { assignSubToProject } from "@/lib/actions/projects";

/** Sub-detail header action: pick a project and create the real assignment
 *  (same server action as the project Subs tab — idempotent, parks the portal
 *  invite for Joe on a genuinely new assignment). */
export function AssignToJobButton({
  subSlug,
  defaultRole,
  projects,
}: {
  subSlug: string;
  /** Prefilled role label — the sub's trade line. */
  defaultRole: string;
  projects: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useDialogDismiss(open, () => setOpen(false));
  const [project, setProject] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function assign() {
    if (!project) return;
    startTransition(async () => {
      const result = await runAction(async () => {
        await assignSubToProject(project, subSlug, defaultRole);
        return { ok: true };
      });
      if (!result.ok) return;
      setDone(projects.find((p) => p.slug === project)?.name ?? project);
      setOpen(false);
      setProject("");
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {open && (
        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          disabled={pending}
          autoFocus
          className="w-[200px] rounded-md border border-rule bg-paper px-2 py-1 text-label text-ink outline-none focus:border-accent disabled:opacity-60"
        >
          <option value="">Pick a project…</option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <Button
        onClick={() => (open ? assign() : setOpen(true))}
        disabled={pending || (open && !project)}
      >
        {pending ? "Assigning…" : open ? "Assign" : "Assign to job"}
      </Button>
      {open && !pending && (
        <button
          onClick={() => setOpen(false)}
          className="text-meta font-semibold text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
      )}
    </span>
  );
}
