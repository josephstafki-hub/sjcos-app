"use client";

// The floor-plan designer shell (docs/floor-plan-designer-plan.md §2): top
// bar, tool rail, canvas (plan / 3D / elevation / split), inspector, status
// bar. State lives in useDesigner (doc + undo + autosave) and ViewState
// (per-session display options); every edit is a PlanOp.

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
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (e.altKey) return `⌥${k}`;
  if (e.shiftKey) return `⇧${k}`;
  return k;
}

export function Designer(props: DesignerProps) {
  const { design, readOnly } = props;
  const router = useRouter();
  const d = useDesigner(design.id, design.doc, design.rev, readOnly);
  const [view, setViewState] = useState<ViewState>(() => ({ ...defaultViewState(), panel: props.initialPanel ?? "properties" }));
  const setView = useCallback((patch: Partial<ViewState> | ((v: ViewState) => Partial<ViewState>)) => {
    setViewState((v) => ({ ...v, ...(typeof patch === "function" ? patch(v) : patch) }));
  }, []);
  const canvas = useRef<Canvas2DHandle>(null);
  const scene = useRef<Scene3DHandle>(null);
  const [narrow, setNarrow] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Narrow layout (tablet portrait / phone): rail becomes a strip, inspector a sheet.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Refresh server-loaded lists (comments, files, versions) when the tab regains focus.
  useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  const activeCamera = useMemo(() => d.doc.cameras.find((c) => c.id === view.activeCameraId) ?? null, [d.doc.cameras, view.activeCameraId]);

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
        if (d.selected.length) d.apply({ op: "duplicateItems", ids: d.selected, dx: 12, dy: 12 });
        return;
      }
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void d.saveNow();
        return;
      }
      if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        d.select([...d.doc.items.filter((i) => i.levelId === d.levelId).map((i) => i.id), ...d.doc.walls.filter((w) => w.levelId === d.levelId).map((w) => w.id)]);
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
        case "Backspace":
          if (d.selected.length && !readOnly) {
            e.preventDefault();
            d.apply({ op: "delete", ids: d.selected });
          }
          return;
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          if (!d.selected.length || readOnly) return;
          e.preventDefault();
          const step = e.shiftKey ? 12 : 1;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          d.apply({ op: "move", ids: d.selected, dx, dy }, { label: "Nudge" });
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
          if (d.selected.length && d.tool === "select") {
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
        d.setTool(tool);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d, readOnly, setView, view.paint]);

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
      className="h-full w-full"
    />
  );

  const threeDBar = (
    <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1 rounded-md border border-rule bg-paper/90 p-1 text-[11px]">
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
        onClick={() => setView({ section: view.section ? null : { axis: "x", at: 0, flip: false } })}
        className={`rounded px-2 py-0.5 ${view.section ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}
      >
        Section
      </button>
      {view.section && (
        <>
          <button onClick={() => setView({ section: { ...view.section!, axis: view.section!.axis === "x" ? "z" : "x" } })} className="rounded px-1.5 py-0.5 text-ink-2 hover:bg-paper-2">
            {view.section.axis === "x" ? "X" : "Z"}
          </button>
          <input
            type="range"
            min={-200}
            max={400}
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
          className="rounded border border-rule bg-paper px-1 py-0.5 text-[11px]"
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

  return (
    <div className="flex h-[calc(100vh-var(--topbar-h,56px))] min-h-[480px] flex-col overflow-hidden">
      {/* A19: owner office time from real interaction only; server resolves the job from the design. */}
      <ActivityEmitter designId={design.id} enabled={props.isOwner && !readOnly} />
      <TopBar ctx={ctx} onFit={() => { canvas.current?.fit(); scene.current?.fit(); }} onPrint={onPrint} />
      {narrow && <ToolPalette tool={d.tool} onSelect={d.setTool} compact />}
      <div className="flex min-h-0 flex-1">
        {!narrow && <ToolPalette tool={d.tool} onSelect={d.setTool} />}
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
            <button
              onClick={() => setSheetOpen((o) => !o)}
              className="absolute bottom-3 right-3 z-20 rounded-full border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper shadow-lg"
            >
              {sheetOpen ? "Hide panel" : "Panel"}
            </button>
          )}
        </div>
        {!narrow && <Inspector ctx={ctx} />}
      </div>
      {narrow && sheetOpen && <InspectorSheet ctx={ctx} onClose={() => setSheetOpen(false)} />}
      <StatusBar ctx={ctx} />
    </div>
  );
}
