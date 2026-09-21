// Mutable bridge between the Scene3D root (outside the Canvas) and the
// components inside it. The root holds this in a ref; inner components fill
// the slots on mount and clear them on unmount.

import type { RootState } from "@react-three/fiber";
import type { Camera as PlanCamera } from "@/lib/plan-doc";

export interface SceneApi {
  get: (() => RootState) | null;
  flyTo: ((cam: PlanCamera, ms?: number) => void) | null;
  fit: ((ms?: number) => void) | null;
  setWalkEye: ((heightIn: number) => void) | null;
}

export function emptyApi(): SceneApi {
  return { get: null, flyTo: null, fit: null, setWalkEye: null };
}

/** World-space bounds of what is rendered (inches). */
export interface WorldBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function boundsCentre(b: WorldBounds): [number, number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

export function boundsExtent(b: WorldBounds): [number, number, number] {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}
