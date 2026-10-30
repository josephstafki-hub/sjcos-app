"use client";

// The floor-plan designer shell (docs/floor-plan-designer-plan.md §2): top
// bar, tool rail, canvas (plan / 3D / elevation / split), inspector, status
// bar. State lives in useDesigner (doc + undo + autosave) and ViewState
// (per-session display options); every edit is a PlanOp.

import { MousePointer2, Minus, Undo2, ZoomOut, ZoomIn, Maximize, AlertTriangle, Menu, X } from "lucide-react";
import { useChecks } from "./inspector/ChecksPanel";
import { Button } from "@/components/ui/Button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogPlaceable, PlanDesign, PlanDesignComment, PlanDesignFile, PlanDesignVersion } from "@/lib/plan-designs";
import { Canvas2D, type Canvas2DHandle } from "./Canvas2D";
import { ElevationView } from "./ElevationView";
import { Scene3DLoader, type Scene3DHandle } from "./Scene3DLoader";
import { ToolPalette, TOOL_GROUPS } from "./ToolPalette";
import { TopBar } from "./TopBar";
import { ActivityEmitter } from "./ActivityEmitter";
import { StatusBar } from "./StatusBar";
import { Inspector, InspectorSheet } from "./inspector/Inspector";
import { useDesigner, type ToolId } from "./useDesigner";
import { levelSlice, newId } from "@/lib/plan-doc";
import { levelBounds } from "@/lib/plan-geometry";
import { defaultViewState, type DesignerContext, type ViewState } from "./view-state";

export interface DesignerProps {
  design: PlanDesign;
  catalog: CatalogPlaceable[];
  costRuleKeys: string[];
  comments: PlanDesignComment[];
  files: PlanDesignFile[];
  versions: PlanDesignVersion[];
  estimateTargets: { id: number; title: string; status: string; total: number }[];
  readOnly: boolean;
  isOwner: boolean;
  initialPanel?: ViewState["panel"];
}

const HOTKEYS: Record<string, ToolId> = {};
for (const g of TOOL_GROUPS) for (const t of g.tools) HOTKEYS[t.key] = t.id;

function hotkeyFor(e: KeyboardEvent): string {
  // Letters from the physical key: on a Mac / iPad ⌥C types "ç", not "C".
  const fromCode = /^Key([A-Z])$/.exec(e.code)?.[1];
  const k = fromCode ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (e.altKey) return `⌥${k}`;
  if (e.shiftKey) return `⇧${k}`;
  return k;
}

export function Designer(props: DesignerProps) {
  const { design, readOnly } = props;
  const router = useRouter();
  const d = useDesigner(design.id, design.doc, design.rev, readOnly);
  const [narrow, setNarrow] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [view, setViewState] = useState<ViewState>(() => ({ ...defaultViewState(), panel: props.initialPanel ?? "properties" }));
  const setView = useCallback((patch: Partial<ViewState> | ((v: ViewState) => Partial<ViewState>)) => {
    setViewState((v) => ({ ...v, ...(typeof patch === "function" ? patch(v) : patch) }));
    if (typeof patch !== "function" && patch.panel && narrow) {
      setControlsOpen(false);
      setSheetOpen(true);
    }
  }, [narrow]);
  // Picking any tool ends an underlay scale / move in progress.
  const pickTool = useCallback(
    (t: ToolId) => {
      d.setTool(t);
      setViewState((v) => (v.underlayTool ? { ...v, underlayTool: null } : v));
    },
    [d],
  );
  const canvas = useRef<Canvas2DHandle>(null);
  const scene = useRef<Scene3DHandle>(null);
  const container = useRef<HTMLDivElement>(null);

  // Narrow layout (tablet portrait / phone): rail becomes a strip, inspector a sheet.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 960));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Refresh server-loaded lists (comments, files, versions) when the tab regains focus.
  useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  const activeCamera = useMemo(() => d.doc.cameras.find((c) => c.id === view.activeCameraId) ?? null, [d.doc.cameras, view.activeCameraId]);
  // Section-cut slider spans the model (plus 2'), not a fixed -200..400".
  const modelBounds = useMemo(() => {
    const bs = d.doc.levels.map((l) => levelBounds(d.doc, l.id)).filter((b): b is NonNullable<typeof b> => !!b);
    if (!bs.length) return { min: { x: 0, y: 0 }, max: { x: 240, y: 240 } };
    return {
      min: { x: Math.min(...bs.map((b) => b.min.x)), y: Math.min(...bs.map((b) => b.min.y)) },
      max: { x: Math.max(...bs.map((b) => b.max.x)), y: Math.max(...bs.map((b) => b.max.y)) },
    };
  }, [d.doc]);
  const sectionRange = (axis: "x" | "z") =>
    axis === "x" ? { min: modelBounds.min.x - 24, max: modelBounds.max.x + 24 } : { min: modelBounds.min.y - 24, max: modelBounds.max.y + 24 };
  const sectionMid = (axis: "x" | "z") => {
    const r = sectionRange(axis);
    return Math.round((r.min + r.max) / 2);
  };

  const ctx: DesignerContext = useMemo(
    () => ({
      d,
      view,
      setView,
      design,
      catalog: props.catalog,
      costRuleKeys: props.costRuleKeys,
      comments: props.comments,
      files: props.files,
      versions: props.versions,
      estimateTargets: props.estimateTargets,
      readOnly,
      isOwner: props.isOwner,
      capture3d: async (scale = 2) => (scene.current ? scene.current.capture(scale) : null),
      flyTo: (cameraId) => {
        setView({ activeCameraId: cameraId, mode: view.mode === "plan" || view.mode === "elevation" ? "3d" : view.mode });
        const cam = d.doc.cameras.find((c) => c.id === cameraId);
        if (cam && scene.current) scene.current.flyTo(cam);
      },
      focus2d: (target) => {
        if (target.levelId && target.levelId !== d.levelId) d.setLevelId(target.levelId);
        if (view.mode === "3d") setView({ mode: "split" });
        canvas.current?.focus(target);
      },
    }),
    [d, view, setView, design, props.catalog, props.costRuleKeys, props.comments, props.files, props.versions, props.estimateTargets, readOnly, props.isOwner],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (controlsOpen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) d.redo();
        else d.undo();
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        d.redo();
        return;
      }
      if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const items = d.doc.items.filter((i) => d.selected.includes(i.id));
        if (items.length) {
          const newIds = items.map(() => newId("i"));
          if (d.apply({ op: "duplicateItems", ids: items.map((i) => i.id), dx: 12, dy: 12, newIds })) d.select(newIds);
        }
        return;
      }
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void d.saveNow();
        return;
      }
      if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const s = levelSlice(d.doc, d.levelId);
        d.select([
          ...s.walls, ...s.openings, ...s.items, ...s.electrical, ...s.notes, ...s.dims, ...s.stairs, ...s.structure,
          ...s.counters.filter((c) => !c.runId), ...s.photos, ...s.sections, ...s.cameras,
        ].map((x) => x.id));
        return;
      }
      if (meta) return;
      switch (e.key) {
        case "Escape":
          canvas.current?.cancel();
          if (view.paint) setView({ paint: null });
          else if (d.selected.length) d.select([]);
          else d.setTool("select");
          return;
        case "Enter":
          canvas.current?.finish();
          return;
        case "Delete":
        case "Backspace": {
          // Rooms are found from the walls — deleting one would only strip
          // its finishes, so they're left out.
          const ids = d.selected.filter((id) => !d.doc.rooms.some((r) => r.id === id));
          if (ids.length && !readOnly) {
            e.preventDefault();
            d.apply({ op: "delete", ids });
          }
          return;
        }
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          if (!d.selected.length || readOnly) return;
          e.preventDefault();
          const step = e.shiftKey ? 12 : 1;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          d.apply({ op: "move", ids: d.selected, dx, dy }, { label: "Nudge", coalesce: `nudge:${d.selected.join(",")}` });
          return;
        }
        case "1":
          setView({ mode: "plan" });
          return;
        case "2":
          setView({ mode: "3d" });
          return;
        case "3":
          setView({ mode: "elevation" });
          return;
        case "4":
          setView({ mode: "split" });
          return;
        case "f":
        case "F":
          if (!e.shiftKey && !e.altKey) {
            canvas.current?.fit();
            scene.current?.fit();
            return;
          }
          break;
        case "r":
          // Rotate needs an item; with a wall / room selected R still means Room.
          if (d.tool === "select" && d.doc.items.some((i) => d.selected.includes(i.id))) {
            d.apply({ op: "rotateItems", ids: d.selected, deltaDeg: 90 });
            return;
          }
          break;
        case "+":
        case "=":
          canvas.current?.zoom(1.25);
          return;
        case "-":
          canvas.current?.zoom(0.8);
          return;
      }
      const hk = hotkeyFor(e);
      const tool = HOTKEYS[hk];
      if (tool) {
        e.preventDefault();
        pickTool(tool);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d, pickTool, readOnly, setView, view.paint, controlsOpen]);

  const showPlan = view.mode === "plan" || view.mode === "split";
  const show3d = view.mode === "3d" || view.mode === "split";
  const showElev = view.mode === "elevation";

  const scene3d = (
    <Scene3DLoader
      ref={scene}
      doc={d.doc}
      levelId={d.doc.levels.length > 1 && view.dollhouse ? d.levelId : "all"}
      phase={view.phase}
      selectedIds={d.selected}
      onSelect={(id, additive) => d.select((prev) => (id == null ? [] : additive ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id]))}
      mode={view.cameraMode}
      renderStyle={view.renderStyle}
      dollhouse={view.dollhouse}
      night={view.night}
      sunHour={view.sunHour}
      section={view.section}
      showLabels={view.showLabels3d}
      camera={activeCamera}
      walkLevelId={d.levelId}
      className="h-full w-full"
    />
  );

  const threeDBar = (
    <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1 rounded-md border border-rule bg-paper/90 p-1 text-meta">
      {(["orbit", "walk", "plan"] as const).map((m) => (
        <button key={m} onClick={() => setView({ cameraMode: m })} className={`rounded px-2 py-0.5 capitalize ${view.cameraMode === m ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>
          {m}
        </button>
      ))}
      <span className="mx-1 border-l border-rule" />
      {(["materials", "white", "sketch", "wireframe"] as const).map((s) => (
        <button key={s} onClick={() => setView({ renderStyle: s })} className={`rounded px-2 py-0.5 capitalize ${view.renderStyle === s ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>
          {s}
        </button>
      ))}
      <span className="mx-1 border-l border-rule" />
      <button onClick={() => setView({ dollhouse: !view.dollhouse })} className={`rounded px-2 py-0.5 ${view.dollhouse ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>
        Dollhouse
      </button>
      <button onClick={() => setView({ night: !view.night })} className={`rounded px-2 py-0.5 ${view.night ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>
        Night
      </button>
      <button onClick={() => setView({ showLabels3d: !view.showLabels3d })} className={`rounded px-2 py-0.5 ${view.showLabels3d ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>
        Labels
      </button>
      <label className="flex items-center gap-1 px-1 text-ink-3">
        ☀ <input type="range" min={5} max={21} step={0.5} value={view.sunHour} onChange={(e) => setView({ sunHour: Number(e.target.value) })} className="w-16" />
      </label>
      <button
        onClick={() => setView({ section: view.section ? null : { axis: "x", at: sectionMid("x"), flip: false } })}
        className={`rounded px-2 py-0.5 ${view.section ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}
      >
        Section
      </button>
      {view.section && (
        <>
          <button
            onClick={() => {
              const axis = view.section!.axis === "x" ? "z" : "x";
              setView({ section: { ...view.section!, axis, at: sectionMid(axis) } });
            }}
            className="rounded px-1.5 py-0.5 text-ink-2 hover:bg-paper-2"
          >
            {view.section.axis === "x" ? "X" : "Z"}
          </button>
          <input
            type="range"
            min={sectionRange(view.section.axis).min}
            max={sectionRange(view.section.axis).max}
            value={view.section.at}
            onChange={(e) => setView({ section: { ...view.section!, at: Number(e.target.value) } })}
            className="w-24"
          />
          <button onClick={() => setView({ section: { ...view.section!, flip: !view.section!.flip } })} className="rounded px-1.5 py-0.5 text-ink-2 hover:bg-paper-2">
            flip
          </button>
        </>
      )}
      <span className="mx-1 border-l border-rule" />
      <button onClick={() => scene.current?.fit()} className="rounded px-2 py-0.5 text-ink-2 hover:bg-paper-2">
        Fit
      </button>
      {d.doc.cameras.length > 0 && (
        <select
          value={view.activeCameraId ?? ""}
          onChange={(e) => e.target.value && ctx.flyTo(e.target.value)}
          className="rounded border border-rule bg-paper px-1 py-0.5 text-meta"
        >
          <option value="">Cameras…</option>
          {d.doc.cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={() => setView({ panel: "versions" })}
        className="rounded border border-ink bg-ink px-2 py-0.5 text-paper"
        title="Capture this view (Versions panel)"
      >
        Capture
      </button>
    </div>
  );

  const onPrint = () => setView({ panel: "versions" });
  const checks = useChecks(ctx);
  const warnings = checks.filter(c => !d.doc.ignoredChecks.includes(c.id) && c.severity === "warn").length;
  const fit = () => { canvas.current?.fit(); scene.current?.fit(); };
  const essential = "flex min-h-11 min-w-0 flex-col items-center justify-center rounded-md text-label text-ink-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40 aria-pressed:bg-selected aria-pressed:text-ink";

  useEffect(() => {
    if (!controlsOpen) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setControlsOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [controlsOpen]);

  return (
    <div ref={container} className="flex h-[calc(100dvh-var(--topbar-h,48px))] min-h-[480px] flex-col overflow-hidden max-sm:pb-14">
      {/* A19: owner office time from real interaction only; server resolves the job from the design. */}
      <ActivityEmitter designId={design.id} enabled={props.isOwner && !readOnly} />
      {narrow ? (
        <div role="toolbar" aria-label="Essential drawing tools" className="grid flex-none grid-cols-8 gap-0.5 border-b border-rule bg-paper px-2 py-1">
          <button className={essential} aria-label="Select" title="Select" aria-pressed={d.tool === "select"} onClick={() => pickTool("select")}><MousePointer2 className="size-4" /><span>Select</span></button>
          <button className={essential} aria-label="Draw wall" title="Draw wall" aria-pressed={d.tool === "wall"} disabled={readOnly} onClick={() => pickTool("wall")}><Minus className="size-4" /><span>Wall</span></button>
          <button className={essential} aria-label="Undo" title="Undo" disabled={!d.canUndo} onClick={d.undo}><Undo2 className="size-4" /></button>
          <button className={essential} aria-label="Zoom out" title="Zoom out" disabled={!showPlan} onClick={() => canvas.current?.zoom(0.8)}><ZoomOut className="size-4" /></button>
          <button className={essential} aria-label="Zoom in" title="Zoom in" disabled={!showPlan} onClick={() => canvas.current?.zoom(1.25)}><ZoomIn className="size-4" /></button>
          <button className={essential} aria-label="Fit drawing" title="Fit drawing" onClick={fit}><Maximize className="size-4" /><span>Fit</span></button>
          <button className={`${essential} text-warn`} aria-label={`${warnings} warnings — open explanations`} title="Warnings" onClick={() => setView({ panel: "checks" })}><AlertTriangle className="size-4" /><span>{warnings}</span></button>
          <button className={essential} aria-label="More drawing tools and settings" aria-expanded={controlsOpen} onClick={() => setControlsOpen(true)}><Menu className="size-4" /><span>More</span></button>
        </div>
      ) : <TopBar ctx={ctx} onFit={fit} onPrint={onPrint} />}
      {narrow && controlsOpen && (
        <div className="fixed inset-0 z-40 bg-ink/30" onClick={() => setControlsOpen(false)}>
          <section role="dialog" aria-modal="true" aria-label="Drawing tools and settings" className="absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-xl bg-paper pb-16 shadow-modal" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2"><h2 className="font-serif text-heading">Drawing tools and settings</h2><Button variant="ghost" icon={X} iconOnly aria-label="Close tools" title="Close tools" onClick={() => setControlsOpen(false)} /></div>
            <TopBar ctx={ctx} onFit={fit} onPrint={onPrint} />
            <ToolPalette tool={d.tool} onSelect={t => { pickTool(t); setControlsOpen(false); }} compact />
            <Button variant="secondary" className="m-3 min-h-11" onClick={() => setView({ panel: "properties" })}>Properties and panels</Button>
          </section>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {!narrow && <ToolPalette tool={d.tool} onSelect={pickTool} />}
        <div className="relative flex min-w-0 flex-1">
          {showPlan && (
            <div className={`relative min-w-0 ${view.mode === "split" ? "w-1/2 border-r border-rule" : "flex-1"}`}>
              <Canvas2D ref={canvas} ctx={ctx} />
            </div>
          )}
          {show3d && (
            <div className={`relative min-w-0 ${view.mode === "split" ? "w-1/2" : "flex-1"}`}>
              {scene3d}
              {threeDBar}
            </div>
          )}
          {showElev && (
            <div className="relative min-w-0 flex-1">
              <ElevationView ctx={ctx} />
            </div>
          )}
          {narrow && (
            <Button
              onClick={() => setSheetOpen((o) => !o)}
              className="absolute top-3 right-3 z-20 rounded-full border border-ink bg-ink px-3 py-1.5 text-label font-semibold text-paper shadow-pop"
            >
              {sheetOpen ? "Hide details" : "Details"}
            </Button>
          )}
        </div>
        {!narrow && <Inspector ctx={ctx} />}
      </div>
      {narrow && sheetOpen && <InspectorSheet ctx={ctx} onClose={() => setSheetOpen(false)} />}
      <StatusBar ctx={ctx} />
    </div>
  );
}
