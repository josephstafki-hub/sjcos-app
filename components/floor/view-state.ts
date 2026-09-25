"use client";

// View state shared by the designer shell, canvas, 3D scene, and inspector
// panels: which view is showing, phase filter, layer visibility, and the
// display toggles. Kept out of the PlanDoc because it is per-session.

import type { DrawLayer } from "@/lib/plan-draw-types";
import type { ElecType, Pt, WallKind } from "@/lib/plan-doc";
import type { DesignerState } from "./useDesigner";
import type { CatalogPlaceable, PlanDesign, PlanDesignComment, PlanDesignFile, PlanDesignVersion } from "@/lib/plan-designs";

export type ViewMode = "plan" | "3d" | "elevation" | "split";
export type PhaseView = "all" | "existing" | "demo" | "new";

export interface ViewState {
  mode: ViewMode;
  phase: PhaseView;
  layers: ReadonlySet<DrawLayer>;
  showTags: boolean;
  showDims: boolean;
  showRoomLabels: boolean;
  showGrid: boolean;
  snapOn: boolean;
  /** Elevation currently shown (wall + side) when mode is elevation/split. */
  elevation: { wallId: string; side: "left" | "right" } | null;
  // 3D
  renderStyle: "materials" | "white" | "wireframe" | "sketch";
  cameraMode: "orbit" | "walk" | "plan";
  dollhouse: boolean;
  night: boolean;
  sunHour: number;
  section: { axis: "x" | "z"; at: number; flip: boolean } | null;
  showLabels3d: boolean;
  activeCameraId: string | null;
  /** Inspector tab. */
  panel: "properties" | "underlay" | "catalog" | "materials" | "layers" | "rooms" | "checks" | "comments" | "versions";
  /** A material being "painted" onto surfaces (materials panel drag/click mode). */
  paint: { key: string } | null;
  /** Library/catalog item (or electrical symbol) armed for placement by the place tools. */
  armed: { libraryKey?: string; catalogId?: number; elecType?: ElecType } | null;
  /** Underlay being scaled (two clicks on a known length) or moved (drag). */
  underlayTool: { mode: "calibrate"; pts: Pt[] } | { mode: "move" } | null;
  /** Kind the Wall / Room tools draw. null = follow the phase view (New in
   *  "new", else Existing). */
  wallKind: Extract<WallKind, "existing" | "new"> | null;
}

/** What the Wall / Room tools draw right now. */
export function drawWallKind(view: Pick<ViewState, "wallKind" | "phase">): "existing" | "new" {
  return view.wallKind ?? (view.phase === "new" ? "new" : "existing");
}

export const ALL_LAYERS: readonly DrawLayer[] = [
  "underlay", "rooms", "finishes", "walls", "openings", "structure", "stairs", "cabinets", "counters",
  "appliances", "plumbing", "hvac", "furniture", "trim", "electrical", "lighting", "selections",
  "dims", "notes", "photos", "comments", "cameras",
];

export function defaultViewState(): ViewState {
  return {
    mode: "plan",
    phase: "all",
    layers: new Set(ALL_LAYERS),
    showTags: true,
    showDims: true,
    showRoomLabels: true,
    showGrid: true,
    snapOn: true,
    elevation: null,
    renderStyle: "materials",
    cameraMode: "orbit",
    dollhouse: true,
    night: false,
    sunHour: 13,
    section: null,
    showLabels3d: true,
    activeCameraId: null,
    panel: "properties",
    paint: null,
    armed: null,
    underlayTool: null,
    wallKind: null,
  };
}

/** Everything the inspector panels and top bar receive. */
export interface DesignerContext {
  d: DesignerState;
  view: ViewState;
  setView: (patch: Partial<ViewState> | ((v: ViewState) => Partial<ViewState>)) => void;
  design: PlanDesign;
  catalog: CatalogPlaceable[];
  costRuleKeys: string[];
  comments: PlanDesignComment[];
  files: PlanDesignFile[];
  versions: PlanDesignVersion[];
  estimateTargets: { id: number; title: string; status: string; total: number }[];
  readOnly: boolean;
  isOwner: boolean;
  /** Ask the 3D view for a PNG blob (null when 3D isn't mounted). */
  capture3d: (scale?: number) => Promise<Blob | null>;
  /** Fly the 3D camera to a saved camera. */
  flyTo: (cameraId: string) => void;
  /** Zoom the 2D canvas to fit an element / point. */
  focus2d: (target: { id?: string; x?: number; y?: number; levelId?: string }) => void;
}
