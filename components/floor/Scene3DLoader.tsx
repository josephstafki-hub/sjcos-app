"use client";

// Client-only loader for the 3D view: three/r3f must never render on the
// server, and `dynamic(..., { ssr: false })` is only allowed inside a Client
// Component, so this wrapper is one. Forwards the imperative handle ref.

import dynamic from "next/dynamic";
import { forwardRef } from "react";
import type { Scene3DHandle, Scene3DProps } from "./Scene3D";

export type { Scene3DProps, Scene3DHandle, RenderStyle, CameraMode, PhaseView } from "./Scene3D";

const LazyScene3D = dynamic(() => import("./Scene3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-paper-2 font-mono text-[11px] text-ink-3">
      Loading 3D…
    </div>
  ),
});

export const Scene3DLoader = forwardRef<Scene3DHandle, Scene3DProps>(function Scene3DLoader(props, ref) {
  return <LazyScene3D {...props} ref={ref} />;
});
