"use client";

// Shared bits for the 3D scene: the style/selection context, phase filtering,
// the style-aware <Surface> material, the <Pick> selection wrapper, labels,
// and the texture hook. Coordinates: plan (x, y) → world (x, 0, y); heights on
// world y. See README.md in this folder.

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { Edges, Html } from "@react-three/drei";
import type { ThreeEvent, ThreeElements } from "@react-three/fiber";
import type { FinishRef, Phase, PlanDoc, Pt, WallKind } from "@/lib/plan-doc";
import { degToRad } from "@/lib/plan-geometry";
import { finishTexture, isHex, repeatFor } from "./textures";

export type RenderStyle = "materials" | "white" | "wireframe" | "sketch";
export type PhaseView = "all" | "existing" | "demo" | "new";

export interface MeasureBridge {
  active: boolean;
  add: (p: THREE.Vector3) => void;
}

export interface SceneCtxValue {
  style: RenderStyle;
  phase: PhaseView;
  night: boolean;
  dollhouse: boolean;
  showLabels: boolean;
  selected: ReadonlySet<string>;
  select: (id: string | null, additive: boolean) => void;
  measure: MeasureBridge;
  doorStyle: string;
  /** The design's settings (cabinet style, defaults) for cabinet looks. */
  settings: PlanDoc["settings"];
}

export const SceneCtx = createContext<SceneCtxValue | null>(null);

export function useScene(): SceneCtxValue {
  const v = useContext(SceneCtx);
  if (!v) throw new Error("useScene outside SceneCtx");
  return v;
}

// ─── Colours ─────────────────────────────────────────────────────────────────

export const COLORS = {
  wall: "#efeae0",
  ghost: "#a33a2a",
  select: "#c46a3b",
  floor: "#d9cdb8",
  ceiling: "#ffffff",
  cabinet: "#e8e4dc",
  stainless: "#b9bcc0",
  fixture: "#f4f4f2",
  wood: "#c9a36a",
  grey: "#9a9a96",
  generic: "#cfcac0",
  trim: "#f7f5ef",
  glass: "#8fb6d6",
  white: "#f4f2ec",
  edge: "#1f2418",
  edgeSoft: "#7c8072",
  edgeNew: "#4c8a4c",
  toe: "#3a3630",
  black: "#1a1a1a",
} as const;

// ─── Phase ───────────────────────────────────────────────────────────────────

/** Is an element with this phase rendered in the given phase view? */
export function phaseShown(p: Phase | WallKind, view: PhaseView): boolean {
  switch (view) {
    case "all":
      return true;
    case "existing":
      return p !== "new";
    case "demo":
      return p !== "new";
    case "new":
      return p !== "remove";
  }
}

/** Should a "remove" element be drawn as a translucent red ghost? */
export function isGhost(p: Phase | WallKind, view: PhaseView): boolean {
  return p === "remove" && view !== "existing";
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

/** Rotation about world y that maps a plan direction (dx, dy) onto local +x. */
export function yawFromPlanDeg(deg: number): number {
  return -degToRad(deg);
}

export function yawFromDir(dx: number, dy: number): number {
  return -Math.atan2(dy, dx);
}

// ─── Textures ────────────────────────────────────────────────────────────────

/** Texture for a finish covering uIn × vIn, or null. Cloned per surface so
 *  the repeat fits; the clone is disposed on unmount. */
export function useFinishTexture(f: FinishRef | null | undefined, uIn: number, vIn: number): THREE.Texture | null {
  const { style } = useScene();
  const enabled = style === "materials";
  const tex = useMemo(() => {
    if (!enabled) return null;
    const base = finishTexture(f);
    return base ? repeatFor(base, uIn, vIn) : null;
    // f identity is what matters; key/pattern/color drive the cache key.
  }, [enabled, f, uIn, vIn]);
  useEffect(() => () => tex?.dispose(), [tex]);
  return tex;
}

/** Texture whose UVs are already in inches (ExtrudeGeometry caps). */
export function useFinishTextureInches(f: FinishRef | null | undefined): THREE.Texture | null {
  return useFinishTexture(f, 1, 1);
}

// ─── Materials ───────────────────────────────────────────────────────────────

export interface SurfaceProps {
  color: string;
  roughness?: number;
  metalness?: number;
  map?: THREE.Texture | null;
  /** Translucent red "to be removed" rendering. */
  ghost?: boolean;
  selected?: boolean;
  opacity?: number;
  side?: THREE.Side;
  emissive?: string;
  emissiveIntensity?: number;
  attach?: string;
}

/** The one material component every mesh uses; swaps implementation by render
 *  style so the geometry components stay style-agnostic. */
export function Surface({
  color,
  roughness = 0.85,
  metalness = 0,
  map = null,
  ghost = false,
  selected = false,
  opacity,
  side,
  emissive,
  emissiveIntensity,
  attach,
}: SurfaceProps) {
  const { style } = useScene();
  const safe = isHex(color) ? color : COLORS.generic;
  if (style === "wireframe") {
    return (
      <meshBasicMaterial
        attach={attach}
        color={ghost ? COLORS.ghost : selected ? COLORS.select : safe}
        wireframe
        transparent={ghost}
        opacity={ghost ? 0.35 : 1}
      />
    );
  }
  const white = style === "white" || style === "sketch";
  const alpha = ghost ? 0.35 : opacity ?? 1;
  const useMap = white || ghost ? null : map;
  // Finish textures are painted in the finish's own colour (textures.ts), so
  // a mapped surface stays white here — tinting it again would square the
  // colour (walnut came out black, oak floors a shade too dark).
  const c = ghost ? COLORS.ghost : white ? COLORS.white : useMap ? "#ffffff" : safe;
  return (
    <meshStandardMaterial
      key={useMap ? "map" : "flat"}
      attach={attach}
      color={c}
      roughness={white ? 0.9 : roughness}
      metalness={white ? 0 : metalness}
      map={useMap}
      transparent={alpha < 1}
      opacity={alpha}
      depthWrite={!ghost && alpha >= 0.5}
      side={side ?? THREE.FrontSide}
      emissive={selected ? COLORS.select : emissive ?? "#000000"}
      emissiveIntensity={selected ? 0.35 : emissiveIntensity ?? 1}
      polygonOffset={ghost}
      polygonOffsetFactor={ghost ? -1 : 0}
    />
  );
}

/** Edge lines for the white / sketch styles. Mount inside a <mesh>. */
export function StyleEdges({ tint }: { tint?: "new" | "soft" | null }) {
  const { style } = useScene();
  if (style === "materials" || style === "wireframe") return null;
  const color = tint === "new" ? COLORS.edgeNew : style === "sketch" ? COLORS.edge : tint === "soft" ? COLORS.edgeSoft : COLORS.edgeSoft;
  return <Edges color={color} lineWidth={style === "sketch" ? 1.5 : 1} threshold={20} />;
}

export function useShadows(): boolean {
  const { style } = useScene();
  return style === "materials";
}

// ─── Selection ───────────────────────────────────────────────────────────────

export function useSelected(id: string): boolean {
  return useScene().selected.has(id);
}

type GroupProps = ThreeElements["group"];

/** Wraps an element's meshes: a click selects it (shift adds); while the
 *  measure tool is armed a click records the hit point instead. Drags that
 *  moved more than a few pixels are ignored so orbiting does not select. */
export function Pick({ id, children, ...rest }: { id: string; children: ReactNode } & Omit<GroupProps, "onClick" | "children" | "id">) {
  const ctx = useScene();
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    if (ctx.measure.active) {
      ctx.measure.add(e.point.clone());
      return;
    }
    ctx.select(id, e.nativeEvent.shiftKey);
  };
  return (
    <group {...rest} onClick={onClick}>
      {children}
    </group>
  );
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export function Label({ text, position }: { text: string; position: [number, number, number] }) {
  const { showLabels } = useScene();
  if (!showLabels || !text) return null;
  return (
    <Html position={position} center occlude={false} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div className="whitespace-nowrap rounded border border-rule bg-paper/90 px-1 py-px font-mono text-[10px] leading-tight text-ink-2 shadow-sm">
        {text}
      </div>
    </Html>
  );
}

// ─── Primitives ──────────────────────────────────────────────────────────────

export interface BoxProps {
  size: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  map?: THREE.Texture | null;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  side?: THREE.Side;
  ghost?: boolean;
  selected?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  /** Draw style edges in white/sketch (default true). */
  edges?: boolean;
  tint?: "new" | "soft" | null;
  shadows?: boolean;
}

/** A styled box: mesh + boxGeometry + Surface (+ edges). Sizes in inches. */
export function Box({
  size,
  position,
  rotation,
  color,
  map,
  roughness,
  metalness,
  opacity,
  side,
  ghost,
  selected,
  emissive,
  emissiveIntensity,
  edges = true,
  tint,
  shadows,
}: BoxProps) {
  const cast = !!shadows && !ghost && (opacity ?? 1) >= 0.5;
  return (
    <mesh position={position} rotation={rotation} castShadow={cast} receiveShadow={!!shadows}>
      <boxGeometry args={size} />
      <Surface
        color={color}
        map={map}
        roughness={roughness}
        metalness={metalness}
        opacity={opacity}
        side={side}
        ghost={ghost}
        selected={selected}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
      />
      {edges && <StyleEdges tint={tint} />}
    </mesh>
  );
}

/** Extruded polygon (plan space → shape x/y) `depth` thick. Mount the mesh
 *  with rotation [π/2, 0, 0] and position.y at the TOP surface: the extrusion
 *  then runs downward. Cap UVs are in inches. Disposed on unmount. */
export function usePolygonGeometry(poly: Pt[], depth: number, holes: Pt[][] = []): THREE.ExtrudeGeometry | null {
  const ring = (pts: Pt[]) => pts.map((p) => `${p.x},${p.y}`).join(";");
  const key = `${ring(poly)}|${depth}|${holes.map(ring).join("|")}`;
  const geo = useMemo(() => {
    if (poly.length < 3) return null;
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
    // Holes (a stairwell) must sit wholly inside the outline.
    for (const h of holes) if (h.length >= 3) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
    return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    // The key captures every input; poly identity alone would rebuild per doc clone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => geo?.dispose(), [geo]);
  return geo;
}
