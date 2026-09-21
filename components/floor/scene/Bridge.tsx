"use client";

// Lives inside the Canvas: exposes the r3f store getter to the root (for
// capture), applies the section clipping plane, and reports context loss.

import { useEffect, type RefObject } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { SceneApi } from "./api";

export interface Section {
  axis: "x" | "z";
  at: number;
  flip: boolean;
}

export function Bridge({
  apiRef,
  section,
  onLost,
}: {
  apiRef: RefObject<SceneApi>;
  section: Section | null | undefined;
  onLost: () => void;
}) {
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const a = apiRef.current;
    a.get = get;
    return () => {
      a.get = null;
    };
  }, [apiRef, get]);

  const axis = section?.axis;
  const at = section?.at;
  const flip = section?.flip;
  useEffect(() => {
    const gl = get().gl;
    gl.localClippingEnabled = true;
    if (axis && typeof at === "number") {
      // Keep the half-space on the "near" side of `at`; flip keeps the other.
      const sign = flip ? 1 : -1;
      const n = axis === "x" ? new THREE.Vector3(sign, 0, 0) : new THREE.Vector3(0, 0, sign);
      gl.clippingPlanes = [new THREE.Plane(n, -sign * at)];
    } else {
      gl.clippingPlanes = [];
    }
    invalidate();
    return () => {
      gl.clippingPlanes = [];
    };
  }, [get, axis, at, flip, invalidate]);

  useEffect(() => {
    const el = get().gl.domElement;
    const handler = (e: Event) => {
      e.preventDefault();
      onLost();
    };
    el.addEventListener("webglcontextlost", handler);
    return () => el.removeEventListener("webglcontextlost", handler);
  }, [get, onLost]);

  // Any re-render of the root should produce a frame under frameloop="demand".
  useEffect(() => {
    invalidate();
  });

  return null;
}
