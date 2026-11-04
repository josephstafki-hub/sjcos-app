"use client";

import { useState, useTransition } from "react";
import { selectPreviewProject } from "@/app/client-portal/preview-actions";

export function PreviewPicker({ projects, selected }: { projects: { slug: string; name: string }[]; selected: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return <div className="flex-none border-b border-rule bg-card px-4 py-2">
    <label className="flex flex-wrap items-center gap-2 text-body font-semibold">Preview as
      <select value={selected} disabled={pending} onChange={e => {
        const data = new FormData(); data.set("project", e.target.value); setError("");
        startTransition(async () => { try { await selectPreviewProject(data); } catch { setError("Could not switch project. Try again."); } });
      }} className="min-h-11 min-w-0 max-w-full rounded-md border border-rule bg-paper px-3 font-normal">
        <option value="">Choose a project…</option>
        {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
      </select><span className="text-meta font-normal text-ink-3">{pending ? "Loading…" : "Owner preview · client identity unchanged"}</span>
    </label>{error && <p role="alert" className="text-body text-flag">{error}</p>}
  </div>;
}
