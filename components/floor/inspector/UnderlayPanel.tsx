"use client";

// Trace-plan tab: put a floor plan (photo, scan or PDF sheet) under the
// current level, give it a true scale — measure a known length, or pick the
// sheet's drawing scale for a PDF — line it up, then trace walls over it.
// One underlay per level; everything is an undoable PlanOp.

import { useEffect, useRef, useState } from "react";
import { FileText, ImageUp, Lock, Move, RotateCcw, RotateCw, Ruler, Trash2, Unlock } from "lucide-react";
import { fmtIn, levelSlice, type Underlay } from "@/lib/plan-doc";
import { levelBounds, rotateUnderlayAbout, underlayScaleForDrawing } from "@/lib/plan-geometry";
import { runAction } from "@/lib/run-action";
import { importPlanUnderlay, listUnderlayCandidates, uploadPlanUnderlay, type UnderlayUpload } from "@/lib/actions/plan-files";
import type { DesignerContext } from "../view-state";
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, Empty, SectionHeader, Toggle } from "./fields";

/** Drawing scales printed on plan sheets, in paper inches per foot. */
const DRAWING_SCALES: { label: string; inPerFt: number }[] = [
  { label: '1/16" = 1\'-0"', inPerFt: 1 / 16 },
  { label: '1/8" = 1\'-0"', inPerFt: 1 / 8 },
  { label: '3/16" = 1\'-0"', inPerFt: 3 / 16 },
  { label: '1/4" = 1\'-0"', inPerFt: 1 / 4 },
  { label: '3/8" = 1\'-0"', inPerFt: 3 / 8 },
  { label: '1/2" = 1\'-0"', inPerFt: 1 / 2 },
  { label: '3/4" = 1\'-0"', inPerFt: 3 / 4 },
  { label: '1" = 1\'-0"', inPerFt: 1 },
  { label: '1-1/2" = 1\'-0"', inPerFt: 1.5 },
];

type Candidate = { id: string; name: string; isPdf: boolean; url: string; uploaded: string };

export function UnderlayPanel({ ctx }: { ctx: DesignerContext }) {
  const { d, view, setView, design } = ctx;
  const ro = ctx.readOnly;
  const level = d.doc.levels.find((l) => l.id === d.levelId) ?? d.doc.levels[0];
  const u = levelSlice(d.doc, d.levelId).underlay;
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [opacity, setOpacity] = useState<number | null>(null);

  useEffect(() => {
    if (ro) return;
    let live = true;
    void listUnderlayCandidates(design.id).then((r) => {
      if (live) setCandidates(r.ok ? r.files : []);
    });
    return () => {
      live = false;
    };
  }, [design.id, ro]);

  /** Put a freshly rendered plan under this level. Another page of the same
   *  file keeps the old placement and scale (same sheet); anything else gets a
   *  starting guess — 1/4" = 1'-0" for a PDF, ~50' across for a photo — and
   *  goes straight into "measure a known length". */
  const place = (r: Extract<UnderlayUpload, { ok: true }>, keep: Underlay | null) => {
    const b = levelBounds(d.doc, d.levelId);
    // The scale printed on the sheet if we could read one, else 1/4".
    const guess = r.dpi ? underlayScaleForDrawing(r.dpi, r.sheetInPerFt ?? 0.25) : 600 / Math.max(r.widthPx, r.heightPx);
    // Another page of the same file keeps the scale (same sheet); a different
    // plan keeps only where it sits and how faint it is.
    const sameDpi = !!keep && keep.sourceFileId === r.sourceFileId && (keep.dpi ?? null) === r.dpi;
    const next: Underlay = {
      fileId: r.fileId,
      sourceFileId: r.sourceFileId,
      name: r.name,
      page: r.page,
      pages: r.pages,
      widthPx: r.widthPx,
      heightPx: r.heightPx,
      ...(r.dpi ? { dpi: r.dpi } : {}),
      ...(r.sheetInPerFt ? { sheetInPerFt: r.sheetInPerFt } : {}),
      x: keep ? keep.x : b ? b.min.x : 0,
      y: keep ? keep.y : b ? b.min.y : 0,
      scale: keep && sameDpi ? keep.scale : guess,
      rotDeg: keep ? keep.rotDeg : 0,
      opacity: keep ? keep.opacity : 0.55,
      locked: keep ? keep.locked : false,
      calibrated: keep && sameDpi ? keep.calibrated : false,
    };
    const ok = d.apply({ op: "setUnderlay", levelId: d.levelId, underlay: next }, { label: keep ? "Replace underlay" : "Add underlay" });
    if (!ok) return;
    const layers = new Set(view.layers);
    layers.add("underlay");
    setView({
      layers,
      mode: view.mode === "3d" || view.mode === "elevation" ? "plan" : view.mode,
      underlayTool: next.calibrated ? null : { mode: "calibrate", pts: [] },
    });
  };

  const upload = async (file: File) => {
    setErr(null);
    setBusy(file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf") ? "Rendering the PDF…" : "Uploading…");
    const fd = new FormData();
    fd.append("file", file, file.name);
    const r = await runAction(() => uploadPlanUnderlay(design.id, fd), { toast: false });
    setBusy(null);
    if (!r.ok) {
      setErr(("error" in r && r.error) || "Upload failed.");
      return;
    }
    place(r as Extract<UnderlayUpload, { ok: true }>, u);
  };

  const importFile = async (fileId: string, page: number, keep: Underlay | null) => {
    setErr(null);
    setBusy(page > 1 ? `Rendering page ${page}…` : "Loading the plan…");
    const r = await runAction(() => importPlanUnderlay(design.id, fileId, page), { toast: false });
    setBusy(null);
    if (!r.ok) {
      setErr(("error" in r && r.error) || "Couldn't load that file.");
      return;
    }
    place(r as Extract<UnderlayUpload, { ok: true }>, keep);
  };

  const patch = (p: Partial<Underlay>, label?: string) => {
    if (!u?.id) return;
    d.apply({ op: "updateUnderlay", id: u.id, patch: p }, label ? { label } : undefined);
  };

  const fileField = (
    <input
      ref={fileInput}
      type="file"
      accept="image/*,application/pdf,.pdf"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void upload(f);
      }}
    />
  );

  const status = busy ? <div className="mt-2 rounded-md bg-paper-2 px-2 py-1.5 text-[11.5px] text-ink-2">{busy}</div> : null;
  const error = err ? <div className="mt-2 rounded-md bg-flag-soft px-2 py-1.5 text-[11.5px] text-flag">{err}</div> : null;

  if (!u) {
    return (
      <div>
        {fileField}
        <p className="text-[12px] leading-snug text-ink-2">
          Put a floor plan under <strong>{level?.name ?? "this level"}</strong> — a photo, a scan or a PDF sheet — set its scale, then trace the
          walls over it.
        </p>
        {!ro && (
          <button type="button" className={`${BTN_PRIMARY} mt-3 w-full justify-center`} disabled={!!busy} onClick={() => fileInput.current?.click()}>
            <ImageUp className="size-3.5" strokeWidth={1.75} /> Upload a plan (image or PDF)
          </button>
        )}
        {status}
        {error}
        {!ro && (
          <>
            <SectionHeader>From this job&apos;s files</SectionHeader>
            {candidates == null ? (
              <div className="text-[11.5px] text-ink-3">Loading…</div>
            ) : candidates.length === 0 ? (
              <Empty>No images or PDFs on this job yet.</Empty>
            ) : (
              <div className="flex flex-col gap-1">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={!!busy}
                    onClick={() => void importFile(c.id, 1, null)}
                    className="flex items-center gap-2 rounded-md border border-rule px-2 py-1.5 text-left text-[12px] hover:bg-paper-2"
                  >
                    {c.isPdf ? (
                      <FileText className="size-4 flex-none text-ink-3" strokeWidth={1.5} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${c.url}?w=64`} alt="" className="size-8 flex-none rounded object-cover" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="flex-none font-mono text-[9.5px] text-ink-4">{c.uploaded}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const w = u.widthPx ?? 0;
  const h = u.heightPx ?? 0;
  const drawingScale = u.dpi ? DRAWING_SCALES.find((s) => Math.abs(underlayScaleForDrawing(u.dpi!, s.inPerFt) - u.scale) / u.scale < 0.002) : undefined;
  const shown = view.layers.has("underlay");
  const locked = u.locked;
  const opacityNow = opacity ?? u.opacity;

  return (
    <div>
      {fileField}
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 size-4 flex-none text-ink-3" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-ink">{u.name || "Plan"}</div>
          <div className="font-mono text-[10px] text-ink-3">
            {level?.name}
            {w && h ? ` · covers ${fmtIn(w * u.scale)} × ${fmtIn(h * u.scale)}` : ""}
          </div>
        </div>
      </div>

      {(u.pages ?? 1) > 1 && u.sourceFileId && !ro && (
        <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-ink-2">
          <button type="button" className={BTN_GHOST} disabled={!!busy || (u.page ?? 1) <= 1} onClick={() => void importFile(u.sourceFileId!, (u.page ?? 1) - 1, u)}>
            ‹
          </button>
          Page
          <select
            value={String(u.page ?? 1)}
            disabled={!!busy}
            onChange={(e) => void importFile(u.sourceFileId!, Number(e.target.value), u)}
            className="rounded border border-rule bg-card px-1 py-0.5 text-[11.5px]"
          >
            {Array.from({ length: u.pages ?? 1 }, (_, i) => (
              <option key={i} value={String(i + 1)}>
                {i + 1}
              </option>
            ))}
          </select>
          of {u.pages}
          <button
            type="button"
            className={BTN_GHOST}
            disabled={!!busy || (u.page ?? 1) >= (u.pages ?? 1)}
            onClick={() => void importFile(u.sourceFileId!, (u.page ?? 1) + 1, u)}
          >
            ›
          </button>
        </div>
      )}
      {status}
      {error}

      <SectionHeader>Scale</SectionHeader>
      <div className={`rounded-md px-2 py-1.5 text-[11.5px] ${u.calibrated ? "bg-paper-2 text-ink-2" : "bg-flag-soft text-flag"}`}>
        {u.calibrated
          ? drawingScale
            ? `Set from the sheet: ${drawingScale.label}`
            : "Set by measuring a known length."
          : u.dpi && u.sheetInPerFt
            ? `The sheet says ${DRAWING_SCALES.find((d) => Math.abs(d.inPerFt - u.sheetInPerFt!) < 1e-6)?.label ?? `${u.sheetInPerFt}" = 1'-0"`} — using that. Measure one known length to confirm before tracing.`
            : u.dpi
              ? "Guessed at 1/4\" = 1'-0\" — measure a length or pick the sheet's scale before tracing."
              : "Not set yet — measure a length you know before tracing."}
      </div>
      {!ro && !locked && (
        <div className="mt-2 flex flex-col gap-1.5">
          <button
            type="button"
            className={`${BTN_PRIMARY} justify-center`}
            onClick={() => setView({ underlayTool: { mode: "calibrate", pts: [] }, mode: view.mode === "3d" || view.mode === "elevation" ? "plan" : view.mode })}
          >
            <Ruler className="size-3.5" strokeWidth={1.75} /> Measure a known length
          </button>
          {u.dpi && (
            <label className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
              Sheet scale
              <select
                value={drawingScale && u.calibrated ? String(drawingScale.inPerFt) : ""}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0) patch({ scale: underlayScaleForDrawing(u.dpi!, v), calibrated: true }, "Scale underlay");
                }}
                className="min-w-0 flex-1 rounded border border-rule bg-card px-1 py-0.5 text-[11.5px]"
              >
                <option value="">Pick the sheet&apos;s scale…</option>
                {DRAWING_SCALES.map((s) => (
                  <option key={s.inPerFt} value={String(s.inPerFt)}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <SectionHeader>Position</SectionHeader>
      {!ro && !locked ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={`${BTN_GHOST} ${view.underlayTool?.mode === "move" ? "border-ink bg-ink text-paper" : ""}`}
            onClick={() => setView({ underlayTool: view.underlayTool?.mode === "move" ? null : { mode: "move" }, mode: view.mode === "3d" || view.mode === "elevation" ? "plan" : view.mode })}
          >
            <Move className="size-3.5" strokeWidth={1.75} /> Move
          </button>
          <button type="button" className={BTN_GHOST} title="Rotate 90° left" onClick={() => w && patch(rotateUnderlayAbout(u, w, h, u.rotDeg - 90), "Rotate underlay")}>
            <RotateCcw className="size-3.5" strokeWidth={1.75} />
          </button>
          <button type="button" className={BTN_GHOST} title="Rotate 90° right" onClick={() => w && patch(rotateUnderlayAbout(u, w, h, u.rotDeg + 90), "Rotate underlay")}>
            <RotateCw className="size-3.5" strokeWidth={1.75} />
          </button>
          <button type="button" className={BTN_GHOST} title="Nudge 0.5° left" onClick={() => w && patch(rotateUnderlayAbout(u, w, h, u.rotDeg - 0.5), "Rotate underlay")}>
            −½°
          </button>
          <button type="button" className={BTN_GHOST} title="Nudge 0.5° right" onClick={() => w && patch(rotateUnderlayAbout(u, w, h, u.rotDeg + 0.5), "Rotate underlay")}>
            +½°
          </button>
          <span className="font-mono text-[10.5px] text-ink-3">{Math.round(u.rotDeg * 10) / 10}°</span>
        </div>
      ) : (
        <div className="text-[11.5px] text-ink-3">{locked ? "Locked — unlock to move, rotate or rescale." : "Read only."}</div>
      )}
      {!ro && !locked && (
        <div className="mt-1 text-[11px] text-ink-4">To straighten a crooked scan, tick “straighten” when you measure along a wall.</div>
      )}

      <SectionHeader>Display</SectionHeader>
      <label className="flex items-center gap-2 text-[11.5px] text-ink-2">
        Opacity
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={Math.round(opacityNow * 100)}
          disabled={ro}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setOpacity(v);
            if (u.id) d.preview({ op: "updateUnderlay", id: u.id, patch: { opacity: v } });
          }}
          onPointerUp={() => {
            if (opacity != null) patch({ opacity }, "Underlay opacity");
            setOpacity(null);
          }}
          onKeyUp={() => {
            if (opacity != null) patch({ opacity }, "Underlay opacity");
            setOpacity(null);
          }}
          className="flex-1"
        />
        <span className="w-8 text-right font-mono text-[10.5px]">{Math.round(opacityNow * 100)}%</span>
      </label>
      <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
        <Toggle
          label="Show on plan"
          on={shown}
          onChange={(on) => {
            const next = new Set(view.layers);
            if (on) next.add("underlay");
            else next.delete("underlay");
            setView({ layers: next });
          }}
        />
        {!ro && (
          <button type="button" className="flex items-center gap-1.5 text-left text-[12px] text-ink-2 hover:text-ink" onClick={() => patch({ locked: !locked }, locked ? "Unlock underlay" : "Lock underlay")}>
            {locked ? <Lock className="size-3.5" strokeWidth={1.75} /> : <Unlock className="size-3.5" strokeWidth={1.75} />}
            {locked ? "Locked" : "Lock in place"}
          </button>
        )}
      </div>

      {!ro && (
        <>
          <SectionHeader>Trace</SectionHeader>
          <p className="text-[11.5px] leading-snug text-ink-2">
            Pick Wall, click each corner of the plan; double-click or Enter to finish, or click the first corner to close a room. Rooms detect
            themselves once the walls close.
          </p>
          <button
            type="button"
            className={`${BTN_PRIMARY} mt-2 w-full justify-center`}
            onClick={() => {
              d.setTool("wall");
              setView({ wallKind: view.wallKind ?? "existing", underlayTool: null, mode: view.mode === "3d" || view.mode === "elevation" ? "plan" : view.mode });
            }}
          >
            Trace walls
          </button>

          <div className="mt-4 flex gap-1.5">
            <button type="button" className={BTN_GHOST} disabled={!!busy} onClick={() => fileInput.current?.click()}>
              <ImageUp className="size-3.5" strokeWidth={1.75} /> Replace…
            </button>
            <button
              type="button"
              className={BTN_DANGER}
              onClick={() => {
                if (window.confirm("Remove the plan from under this level? Walls you traced stay.")) {
                  setView({ underlayTool: null });
                  d.apply({ op: "setUnderlay", levelId: d.levelId, underlay: null }, { label: "Remove underlay" });
                }
              }}
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} /> Remove
            </button>
          </div>
        </>
      )}
    </div>
  );
}
