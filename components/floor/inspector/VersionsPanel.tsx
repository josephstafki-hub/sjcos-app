"use client";

// Versions tab: save state, immutable snapshots, 3D captures, and the
// publish / send-for-signature block (docs §10).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { Chip } from "@/components/ui";
import type { DesignerContext } from "../view-state";
import { deletePlanVersion, restorePlanVersion, savePlanVersion } from "@/lib/actions/plan-designs";
import { removePlanFile, renamePlanFile, uploadPlanCapture } from "@/lib/actions/plan-files";
import { runAction } from "@/lib/run-action";
import { BTN_GHOST, BTN_PRIMARY, Empty, INPUT_CLS, SectionHeader } from "./fields";
import { SheetBuilder } from "./SheetBuilder";

export function VersionsPanel({ ctx }: { ctx: DesignerContext }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const ro = ctx.readOnly;

  const saveVersion = () =>
    start(async () => {
      await ctx.d.saveNow();
      const r = await runAction(() => savePlanVersion(ctx.design.id, label.trim() || `Version ${ctx.versions.length + 1}`));
      if (r.ok) {
        setLabel("");
        router.refresh();
      }
    });

  const restore = (versionId: number, n: number) =>
    start(async () => {
      if (!window.confirm(`Restore v${n}? The current working doc is replaced (autosave keeps the rev history).`)) return;
      const r = await runAction(() => restorePlanVersion(versionId));
      if (r.ok) window.location.reload();
    });

  const capture = () =>
    start(async () => {
      const blob = await ctx.capture3d(2);
      if (!blob) {
        window.alert("Open the 3D view first, then capture.");
        return;
      }
      const cam = ctx.view.activeCameraId ? ctx.d.doc.cameras.find((c) => c.id === ctx.view.activeCameraId) : null;
      const fd = new FormData();
      fd.set("file", new File([blob], "capture.png", { type: "image/png" }));
      fd.set("label", cam?.name ?? "View");
      fd.set("camera", JSON.stringify(cam ?? { mode: ctx.view.cameraMode, style: ctx.view.renderStyle }));
      const r = await runAction(() => uploadPlanCapture(ctx.design.id, fd));
      if (r.ok) router.refresh();
    });

  const captures = ctx.files.filter((f) => f.kind === "capture");

  return (
    <div>
      <SaveLine ctx={ctx} />

      {!ro && (
        <div className="mt-3 flex gap-1.5">
          <input className={INPUT_CLS} placeholder="Version label (e.g. Client review 1)" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveVersion()} />
          <button type="button" className={`${BTN_PRIMARY} flex-none`} disabled={pending} onClick={saveVersion}>
            Save version
          </button>
        </div>
      )}

      <SectionHeader>Versions ({ctx.versions.length})</SectionHeader>
      {ctx.versions.length === 0 ? (
        <Empty>No versions yet. Save one before publishing.</Empty>
      ) : (
        <div className="flex flex-col gap-1">
          {ctx.versions.map((v) => (
            <div key={v.id} className="rounded-md border border-rule px-2.5 py-1.5 text-[12px]">
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-ink">v{v.number}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2">{v.label}</span>
                {v.published && <Chip kind="money">Published</Chip>}
              </div>
              <div className="mt-0.5 flex items-center gap-2 font-mono text-[10.5px] text-ink-3">
                <span>{v.createdLabel}</span>
                <span>·</span>
                <span>
                  {v.counts.walls}w {v.counts.items}i {v.counts.areaSf}sf
                </span>
                <span className="flex-1" />
                {!ro && (
                  <>
                    <button type="button" className="text-ink-3 hover:text-ink" onClick={() => restore(v.id, v.number)}>
                      Restore
                    </button>
                    {!v.published && (
                      <button
                        type="button"
                        className="text-ink-3 hover:text-flag"
                        onClick={() =>
                          start(async () => {
                            if (!window.confirm(`Delete v${v.number}?`)) return;
                            const r = await runAction(() => deletePlanVersion(v.id));
                            if (r.ok) router.refresh();
                          })
                        }
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionHeader
        right={
          !ro ? (
            <button type="button" className={BTN_GHOST} disabled={pending} onClick={capture}>
              <Camera className="size-3" strokeWidth={1.75} /> Capture 3D view
            </button>
          ) : undefined
        }
      >
        Captures ({captures.length})
      </SectionHeader>
      {captures.length === 0 ? (
        <div className="text-[12px] text-ink-3">Captures from the 3D view go on the cover and the “3D views” sheet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {captures.map((f) => (
            <div key={f.id} className="overflow-hidden rounded-md border border-rule">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={f.label} className="aspect-[4/3] w-full object-cover" />
              <div className="flex items-center gap-1 px-1.5 py-1">
                <input
                  className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none"
                  defaultValue={f.label}
                  disabled={ro}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== f.label) start(async () => void (await runAction(() => renamePlanFile(f.id, v))));
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                {!ro && (
                  <button
                    type="button"
                    className="text-ink-3 hover:text-flag"
                    aria-label="Remove capture"
                    onClick={() =>
                      start(async () => {
                        const r = await runAction(() => removePlanFile(f.id));
                        if (r.ok) router.refresh();
                      })
                    }
                  >
                    <Trash2 className="size-3" strokeWidth={1.75} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionHeader>Publish</SectionHeader>
      <SheetBuilder ctx={ctx} />
    </div>
  );
}

function SaveLine({ ctx }: { ctx: DesignerContext }) {
  const s = ctx.d.save;
  if (ctx.readOnly) return <div className="text-[12px] text-ink-3">Read-only.</div>;
  switch (s.kind) {
    case "saved":
      return <div className="text-[12px] text-money">Saved · rev {ctx.d.rev}</div>;
    case "dirty":
      return <div className="text-[12px] text-ink-3">Unsaved changes…</div>;
    case "saving":
      return <div className="text-[12px] text-ink-3">Saving…</div>;
    case "offline":
      return <div className="text-[12px] text-flag">Offline — {s.queued} change set queued, retrying.</div>;
    case "error":
      return <div className="text-[12px] text-flag">Save failed: {s.message}</div>;
    case "conflict":
      return (
        <div className="rounded-md border border-flag bg-flag-soft px-2.5 py-2 text-[12px]">
          <div className="font-medium text-flag">Someone else saved rev {s.rev} while you were editing.</div>
          <div className="mt-1.5 flex gap-2">
            <button type="button" className={BTN_GHOST} onClick={ctx.d.reloadFromConflict}>
              Reload theirs
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={ctx.d.keepMineOverConflict}>
              Keep mine
            </button>
          </div>
        </div>
      );
  }
}
