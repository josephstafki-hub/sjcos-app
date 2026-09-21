"use client";

// Ambient + hemisphere + a shadow-casting sun that follows `sunHour`
// (rises east at 6, overhead at noon, sets west at 18; warmer at the ends).

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useShadows } from "./shared";
import { boundsCentre, boundsExtent, type WorldBounds } from "./api";

export function SceneLights({ sunHour, night, bounds }: { sunHour: number; night: boolean; bounds: WorldBounds }) {
  const shadows = useShadows();
  const ref = useRef<THREE.DirectionalLight>(null);
  const [cx, cy, cz] = boundsCentre(bounds);
  const [ex, ey, ez] = boundsExtent(bounds);
  const radius = Math.max(60, 0.5 * Math.hypot(ex, ey, ez));

  const t = ((sunHour % 24) + 24) % 24;
  const up = t >= 6 && t <= 18;
  const az = ((t - 6) / 12) * Math.PI; // 0 = east, π/2 = south, π = west
  const maxEl = (75 * Math.PI) / 180;
  const el = up ? Math.max(0.06, Math.sin(az) * maxEl) : 0.06;
  const R = radius * 3;
  const pos: [number, number, number] = [
    cx + R * Math.cos(el) * Math.cos(az),
    cy + R * Math.sin(el),
    cz + R * Math.cos(el) * Math.sin(az),
  ];
  const warmth = Math.max(0, Math.min(1, Math.sin(el) / Math.sin(maxEl)));
  const color = new THREE.Color("#ffb36b").lerp(new THREE.Color("#fff6e8"), warmth);
  const intensity = night ? 0 : up ? 0.6 + 1.6 * Math.sin(el) : 0.15;

  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    l.target.position.set(cx, cy, cz);
    l.target.updateMatrixWorld();
  }, [cx, cy, cz]);

  const s = radius * 1.4;
  return (
    <>
      <ambientLight intensity={night ? 0.15 : 0.55} />
      <hemisphereLight args={[night ? "#3b4250" : "#dfe8f0", night ? "#1a1a1c" : "#b8ad98", night ? 0.1 : 0.7]} />
      <directionalLight
        ref={ref}
        position={pos}
        color={color}
        intensity={intensity}
        castShadow={shadows && !night}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={1}
        shadow-camera-left={-s}
        shadow-camera-right={s}
        shadow-camera-top={s}
        shadow-camera-bottom={-s}
        shadow-camera-near={1}
        shadow-camera-far={R * 2.5}
      />
    </>
  );
}
