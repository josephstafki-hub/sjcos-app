"use client";

// Two-click point-to-point measure: markers, a line, and an inches readout.
// Points are collected by <Pick> (see shared.tsx) while the tool is armed.

import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import { fmtIn } from "@/lib/plan-doc";
import { COLORS } from "./shared";

export function MeasureOverlay({ points }: { points: THREE.Vector3[] }) {
  if (!points.length) return null;
  const two = points.length >= 2;
  const mid = two ? points[0].clone().add(points[1]).multiplyScalar(0.5) : null;
  const d = two ? points[0].distanceTo(points[1]) : 0;
  return (
    <group>
      {points.map((p, i) => (
        <mesh key={i} position={p} renderOrder={999}>
          <sphereGeometry args={[1.25, 12, 8]} />
          <meshBasicMaterial color={COLORS.select} depthTest={false} />
        </mesh>
      ))}
      {two && mid && (
        <>
          <Line points={[points[0], points[1]]} color={COLORS.select} lineWidth={2} />
          <Html position={mid} center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
            <div className="whitespace-nowrap rounded border border-rule bg-paper px-1.5 py-0.5 font-mono text-[11px] text-ink shadow">
              {fmtIn(d, { frac: 8 })}
            </div>
          </Html>
        </>
      )}
    </group>
  );
}
