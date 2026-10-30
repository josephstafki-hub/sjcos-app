"use client";

import { ActionMenu } from "@/components/projects/ActionMenu";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, LayoutGrid, Plus, X } from "lucide-react";
import { Button, Card, Chip, EmptyState } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import { ROOM_TEMPLATES } from "@/lib/plan-library";
import type { PlanDesignSummary } from "@/lib/plan-designs";
import { createPlanDesign, deletePlanDesign, duplicatePlanDesign } from "@/lib/actions/plan-designs";

/** The "Designs" strip on a project's Floor tab and a lead's Floor plan tab:
 *  every live design for that job (open it, duplicate, delete) plus "New
 *  design" which starts blank or from a room template and opens the
 *  designer. Published versions live below it in the existing version list. */
export function DesignsStrip({
  scope,
  designs,
  compact = false,
}: {
  scope: { projectSlug?: string; leadSlug?: string };
  designs: PlanDesignSummary[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [modal, setModal] = useState(false);
  const [name, setName] = useState("Kitchen");
  const [template, setTemplate] = useState("");

  function create() {
    start(async () => {
      const r = await runAction(() => createPlanDesign({ ...scope, name, templateKey: template || undefined }));
      if (r.ok && "id" in r) {
        setModal(false);
        router.push(`/floor/${r.id}`);
      }
    });
  }

  function duplicate(id: number) {
    start(async () => {
      const r = await runAction(() => duplicatePlanDesign(id));
      if (r.ok && "id" in r) router.push(`/floor/${r.id}`);
    });
  }

  function remove(id: number, label: string) {
    if (!confirm(`Delete the design "${label}"? Published versions stay; the live design is gone.`)) return;
    start(async () => {
      await runAction(() => deletePlanDesign(id));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <h3 className="flex-1 font-serif text-heading font-semibold text-ink">Designs</h3>
        <Button icon={Plus} onClick={() => setModal(true)}>New design</Button>
      </div>

      {designs.length === 0 ? (
        <EmptyState compact icon={LayoutGrid} title="No designs yet" description="Start a design to draft the room in 2D, see it in 3D, and publish a plan version for client approval." />
      ) : (
        <div className={compact ? "flex flex-col gap-1.5" : "grid grid-cols-1 gap-2 @xl/page:grid-cols-2 @4xl/page:grid-cols-3"}>
          {designs.map((d) => (
            <Card key={d.id} className="flex items-start gap-2.5 p-2.5">
              <Link
                href={`/floor/${d.id}`}
                className="flex size-9 flex-none items-center justify-center rounded-md border border-rule bg-paper-2 text-ink-2 hover:bg-paper-3"
                aria-label={`Open ${d.name}`}
              >
                <LayoutGrid className="size-4" strokeWidth={1.5} />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/floor/${d.id}`} className="block break-words text-body font-semibold text-ink hover:underline">
                  {d.name}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-meta text-ink-3">
                  <span>rev {d.rev}</span>
                  <span>·</span>
                  <span>{d.counts.rooms} room{d.counts.rooms === 1 ? "" : "s"}</span>
                  <span>·</span>
                  <span>{d.counts.areaSf} sf</span>
                  <span>·</span>
                  <span>{d.counts.cabinets} cab</span>
                  <span>·</span>
                  <span>{d.updatedLabel}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {d.latestVersion ? (
                    <Chip kind="ghost">v{d.latestVersion.number}{d.latestVersion.label ? ` · ${d.latestVersion.label}` : ""}</Chip>
                  ) : (
                    <Chip kind="ghost">no version yet</Chip>
                  )}
                </div>
              </div>
              <div className="flex flex-none flex-col gap-1">
                <button
                  title="Duplicate"
                  disabled={pending}
                  onClick={() => duplicate(d.id)}
                  className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-ink"
                >
                  <Copy className="size-3.5" strokeWidth={1.5} />
                </button>
                <ActionMenu label={`More actions for ${d.name}`}><Button variant="ghost" className="text-flag" disabled={pending} onClick={() => remove(d.id,d.name)}>Delete design</Button></ActionMenu>
              </div>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh]" onClick={() => setModal(false)}>
          <div className="w-full max-w-[520px] rounded-lg border border-rule bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h2 className="font-serif text-heading font-semibold text-ink">New design</h2>
              <button onClick={() => setModal(false)} className="text-ink-3 hover:text-ink" aria-label="Close">
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <label className="flex flex-col gap-1">
                <span className="text-label font-medium text-ink-3">Name</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Kitchen"
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
                />
              </label>
              <div>
                <div className="mb-1.5 text-label font-medium text-ink-3">Start from</div>
                <div className="grid grid-cols-2 gap-1.5 @3xl/page:grid-cols-3">
                  <TemplateTile active={template === ""} label="Blank" desc="Draw the room yourself" onClick={() => setTemplate("")} />
                  {ROOM_TEMPLATES.map((t) => (
                    <TemplateTile key={t.key} active={template === t.key} label={t.label} desc={t.description} onClick={() => setTemplate(t.key)} />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setModal(false)} className="rounded-md border border-rule bg-card px-3 py-1.5 text-label text-ink-2 hover:bg-paper-2">
                  Cancel
                </button>
                <button
                  onClick={create}
                  disabled={pending || !name.trim()}
                  className="rounded-md border border-ink bg-ink px-3 py-1.5 text-label font-semibold text-paper hover:bg-ink-hover disabled:opacity-60"
                >
                  {pending ? "Creating…" : "Create & open"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateTile({ active, label, desc, onClick }: { active: boolean; label: string; desc: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-md border p-2 text-left transition-colors",
        active ? "border-ink bg-ink text-paper" : "border-rule bg-paper text-ink hover:bg-paper-2",
      ].join(" ")}
    >
      <div className="text-label font-semibold">{label}</div>
      <div className={`mt-0.5 line-clamp-2 text-meta ${active ? "text-paper/80" : "text-ink-3"}`}>{desc}</div>
    </button>
  );
}
