"use client";

// 3D view of a PlanDoc (docs/floor-plan-designer-plan.md §4). Everything is
// derived from the doc; only the camera is stateful here. Coordinates: plan
// (x, y) inches → world (x, 0, y), heights on world y. See scene/README.md.
//
// Load through Scene3DLoader (dynamic, ssr: false). The root div fills its
// parent, so the parent must have a height.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
} from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { levelSlice, type Camera as PlanCamera, type Level, type PlanDoc, type Wall } from "@/lib/plan-doc";
import { itemCorners } from "@/lib/plan-geometry";
import { emptyApi, type SceneApi, type WorldBounds } from "./scene/api";
import { Bridge, type Section } from "./scene/Bridge";
import { CameraRig, type CameraMode } from "./scene/Cameras";
import { Counters } from "./scene/Counters";
import { Devices } from "./scene/Devices";
import { Items } from "./scene/Items";
import { SceneLights } from "./scene/Lights";
import { MeasureOverlay } from "./scene/Measure";
import { Stairs, Structure } from "./scene/Misc";
import { Rooms } from "./scene/Rooms";
import { SceneCtx, phaseShown, type PhaseView, type RenderStyle, type SceneCtxValue } from "./scene/shared";
import { Walls } from "./scene/Walls";

export type { RenderStyle, PhaseView, CameraMode };

export interface Scene3DProps {
  doc: PlanDoc;
  levelId: string | "all";
  /** "existing": hide new; "demo": existing + remove (remove ghosted red);
   *  "new": hide remove; "all": everything. */
  phase: PhaseView;
  selectedIds: string[];
  onSelect?: (id: string | null, additive: boolean) => void;
  mode: CameraMode;
  renderStyle: RenderStyle;
  /** Hide ceilings and clip walls to 48". */
  dollhouse: boolean;
  /** Dim ambient; placed lights emit. */
  night: boolean;
  /** 0–24, drives the sun's angle and colour. */
  sunHour: number;
  /** Clipping plane in world units. */
  section?: { axis: "x" | "z"; at: number; flip: boolean } | null;
  /** Html tags on cabinets / appliances / fixtures. */
  showLabels: boolean;
  /** When it changes (by id), fly there. */
  camera?: PlanCamera | null;
  /** Throttled to ≤ 4/s. */
  onCameraChange?: (pos: [number, number, number], target: [number, number, number]) => void;
  className?: string;
}

export interface Scene3DHandle {
  /** PNG of the current view at `scale`× (1–4). Html labels are DOM and are
   *  not part of the capture. */
  capture(scale?: number, opts?: { transparent?: boolean }): Promise<Blob>;
  flyTo(cam: PlanCamera): void;
  /** Frame the level bounds. */
  fit(): void;
  setWalkEye(heightIn: number): void;
  measure: { start(): void; cancel(): void };
}

interface LevelSlice {
  level: Level;
  walls: Wall[];
  allWalls: Wall[];
  openings: ReturnType<typeof levelSlice>["openings"];
  rooms: ReturnType<typeof levelSlice>["rooms"];
  items: ReturnType<typeof levelSlice>["items"];
  counters: ReturnType<typeof levelSlice>["counters"];
  finishes: ReturnType<typeof levelSlice>["finishes"];
  electrical: ReturnType<typeof levelSlice>["electrical"];
  stairs: ReturnType<typeof levelSlice>["stairs"];
  structure: ReturnType<typeof levelSlice>["structure"];
}

function sliceLevels(doc: PlanDoc, levelId: string | "all", phase: PhaseView): LevelSlice[] {
  const levels = levelId === "all" ? doc.levels : doc.levels.filter((l) => l.id === levelId);
  return levels.map((level) => {
    const s = levelSlice(doc, level.id);
    return {
      level,
      walls: s.walls.filter((w) => phaseShown(w.kind, phase)),
      allWalls: s.walls,
      openings: s.openings,
      rooms: s.rooms,
      items: s.items.filter((i) => phaseShown(i.phase, phase)),
      counters: s.counters,
      finishes: s.finishes,
      electrical: s.electrical.filter((d) => phaseShown(d.phase, phase)),
      stairs: s.stairs.filter((st) => phaseShown(st.phase, phase)),
      structure: s.structure.filter((st) => phaseShown(st.phase, phase)),
    };
  });
}

function computeBounds(slices: LevelSlice[]): WorldBounds {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const px = (x: number, z: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  for (const s of slices) {
    const e = s.level.elevationIn;
    let top = e + s.level.ceilingIn;
    for (const w of s.allWalls) {
      px(w.a.x, w.a.y);
      px(w.b.x, w.b.y);
      top = Math.max(top, e + w.heightIn);
    }
    for (const i of s.items) {
      for (const c of itemCorners(i)) px(c.x, c.y);
      top = Math.max(top, e + i.z + i.h);
    }
    for (const r of s.rooms) for (const p of r.polygon) px(p.x, p.y);
    for (const c of s.counters) for (const p of c.polygon) px(p.x, p.y);
    if (minX !== Infinity) {
      minY = Math.min(minY, e);
      maxY = Math.max(maxY, top);
    }
  }
  if (minX === Infinity) return { min: [0, 0, 0], max: [240, 96, 240] };
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function background(style: RenderStyle, night: boolean): string {
  if (style === "materials") return night ? "#1c1e22" : "#e9e5db";
  return "#ffffff";
}

function Scene3DInner(props: Scene3DProps, ref: ForwardedRef<Scene3DHandle>) {
  const {
    doc,
    levelId,
    phase,
    selectedIds,
    onSelect,
    mode,
    renderStyle,
    dollhouse,
    night,
    sunHour,
    section,
    showLabels,
    camera,
    onCameraChange,
    className,
  } = props;

  const api = useRef<SceneApi>(emptyApi());
  const [lost, setLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [measuring, setMeasuring] = useState(false);
  const [measurePts, setMeasurePts] = useState<THREE.Vector3[]>([]);

  const slices = useMemo(() => sliceLevels(doc, levelId, phase), [doc, levelId, phase]);
  const bounds = useMemo(() => computeBounds(slices), [slices]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const walkWalls = useMemo(() => slices.flatMap((s) => s.walls.filter((w) => w.kind !== "remove" || phase === "existing")), [slices, phase]);
  const floorY = slices[0]?.level.elevationIn ?? 0;

  const select = useCallback((id: string | null, additive: boolean) => onSelect?.(id, additive), [onSelect]);
  const addMeasurePt = useCallback((p: THREE.Vector3) => {
    setMeasurePts((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
  }, []);

  const ctx = useMemo<SceneCtxValue>(
    () => ({
      style: renderStyle,
      phase,
      night,
      dollhouse,
      showLabels,
      selected,
      select,
      measure: { active: measuring, add: addMeasurePt },
      doorStyle: doc.settings.defaults.doorStyle,
    }),
    [renderStyle, phase, night, dollhouse, showLabels, selected, select, measuring, addMeasurePt, doc.settings.defaults.doorStyle],
  );

  // Fly to a named camera when it changes by id.
  const camId = camera?.id ?? null;
  useEffect(() => {
    if (camera && camId) api.current.flyTo?.(camera, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camId]);

  const onLost = useCallback(() => setLost(true), []);
  const resume = useCallback(() => {
    setLost(false);
    setCanvasKey((k) => k + 1);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      async capture(scale = 1, opts) {
        const get = api.current.get;
        if (!get) throw new Error("3D view is not ready");
        const st = get();
        const { gl, scene, camera: cam, size } = st;
        const s = Math.max(1, Math.min(4, scale));
        const prevRatio = gl.getPixelRatio();
        const prevBg = scene.background;
        const prevClear = gl.getClearColor(new THREE.Color());
        const prevAlpha = gl.getClearAlpha();
        try {
          gl.setPixelRatio(s);
          gl.setSize(size.width, size.height, false);
          if (opts?.transparent) {
            scene.background = null;
            gl.setClearColor(0x000000, 0);
          }
          gl.render(scene, cam);
          return await new Promise<Blob>((resolve, reject) =>
            gl.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error("Capture failed"))), "image/png"),
          );
        } finally {
          gl.setPixelRatio(prevRatio);
          gl.setSize(size.width, size.height, false);
          scene.background = prevBg;
          gl.setClearColor(prevClear, prevAlpha);
          st.invalidate();
        }
      },
      flyTo(cam) {
        api.current.flyTo?.(cam, 600);
      },
      fit() {
        api.current.fit?.(600);
      },
      setWalkEye(h) {
        api.current.setWalkEye?.(h);
      },
      measure: {
        start() {
          setMeasurePts([]);
          setMeasuring(true);
        },
        cancel() {
          setMeasuring(false);
          setMeasurePts([]);
        },
      },
    }),
    [],
  );

  const sectionProp: Section | null = section ? { axis: section.axis, at: section.at, flip: section.flip } : null;
  const shadows = renderStyle === "materials";

  return (
    <div className={["relative h-full w-full", className ?? ""].join(" ")}>
      {!lost && (
        <Canvas
          key={canvasKey}
          frameloop="demand"
          dpr={[1, 2]}
          shadows={shadows ? "soft" : false}
          gl={{ preserveDrawingBuffer: true, antialias: true, powerPreference: "high-performance" }}
          onPointerMissed={() => {
            if (!measuring) select(null, false);
          }}
          style={{ touchAction: "none" }}
        >
          <color attach="background" args={[background(renderStyle, night)]} />
          <SceneCtx.Provider value={ctx}>
            <Bridge apiRef={api} section={sectionProp} onLost={onLost} />
            <SceneLights sunHour={sunHour} night={night} bounds={bounds} />
            <CameraRig mode={mode} apiRef={api} bounds={bounds} walls={walkWalls} floorY={floorY} onCameraChange={onCameraChange} />
            {slices.map((s) => (
              <group key={s.level.id}>
                <Walls walls={s.walls} allWalls={s.allWalls} openings={s.openings} finishes={s.finishes} elev={s.level.elevationIn} />
                <Rooms rooms={s.rooms} finishes={s.finishes} level={s.level} elev={s.level.elevationIn} />
                <Items items={s.items} elev={s.level.elevationIn} />
                <Counters counters={s.counters} items={s.items} elev={s.level.elevationIn} />
                <Devices devices={s.electrical} walls={s.allWalls} level={s.level} elev={s.level.elevationIn} />
                <Stairs stairs={s.stairs} elev={s.level.elevationIn} />
                <Structure structure={s.structure} elev={s.level.elevationIn} />
              </group>
            ))}
            <MeasureOverlay points={measurePts} />
          </SceneCtx.Provider>
        </Canvas>
      )}
      {lost && (
        <button
          type="button"
          onClick={resume}
          className="absolute inset-0 flex items-center justify-center bg-paper-2 text-[12px] text-ink-2"
        >
          3D paused — tap to resume
        </button>
      )}
      {!lost && mode === "walk" && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded border border-rule bg-paper/85 px-2 py-1 font-mono text-[10px] text-ink-3">
          W A S D / arrows move · drag to look · scroll forward · shift runs
        </div>
      )}
      {!lost && measuring && (
        <div className="pointer-events-none absolute top-2 left-2 rounded border border-rule bg-paper/85 px-2 py-1 font-mono text-[10px] text-ink-3">
          {measurePts.length < 2 ? `Measure: click point ${measurePts.length + 1} of 2` : "Measure: click to start again"}
        </div>
      )}
    </div>
  );
}

const Scene3D = forwardRef<Scene3DHandle, Scene3DProps>(Scene3DInner);
Scene3D.displayName = "Scene3D";
export default Scene3D;
