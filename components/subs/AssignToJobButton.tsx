"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  const [project, setProject] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function assign() {
    if (!project) return;
    startTransition(async () => {
      await assignSubToProject(project, subSlug, defaultRole);
      setDone(projects.find((p) => p.slug === project)?.name ?? project);
      setOpen(false);
      setProject("");
      router.refresh();
    });
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-money/40 bg-money/10 px-2.5 py-1 text-[12px] font-semibold text-money">
        <Check className="size-3" strokeWidth={2} /> Assigned to {done}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {open && (
        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          disabled={pending}
          autoFocus
          className="w-[200px] rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-60"
        >
          <option value="">Pick a project…</option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={() => (open ? assign() : setOpen(true))}
        disabled={pending || (open && !project)}
        className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
      >
        {pending ? "Assigning…" : open ? "Assign" : "Assign to job"}
      </button>
      {open && !pending && (
        <button
          onClick={() => setOpen(false)}
          className="text-[11px] font-semibold text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
      )}
    </span>
  );
}
