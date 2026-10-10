"use client";

// Countertops: extruded polygon sitting on the tallest base cabinet under it
// (34.5" when none), backsplash along the back edge (edge 0 of a run's
// counter — the wall side, as takeoffs count it; the longest edge of a
// hand-drawn one), waterfall ends on the counter's own left / right.

import { useMemo } from "react";
import { dist, pointInPolygon, type Counter, type PlacedItem, type Pt } from "@/lib/plan-doc";
import { centroid, midPt, sub } from "@/lib/plan-geometry";
import { Box, Pick, Surface, StyleEdges, useFinishTexture, useFinishTextureInches, usePolygonGeometry, useSelected, useShadows, yawFromDir } from "./shared";

const BASE_TIER = new Set<PlacedItem["kind"]>(["base", "vanity", "island"]);

export function Counters({ counters, items, elev }: { counters: Counter[]; items: PlacedItem[]; elev: number }) {
  return (
    <>
      {counters.map((c) => (
        <CounterMesh key={c.id} c={c} items={items} elev={elev} />
      ))}
    </>
  );
}

interface EdgeInfo {
  a: Pt;
  b: Pt;
  len: number;
  mid: Pt;
  yaw: number;
  /** Unit vector from the edge midpoint toward the polygon interior. */
  inward: Pt;
}

function edgeInfo(a: Pt, b: Pt, c: Pt): EdgeInfo {
  const len = dist(a, b);
  const mid = midPt(a, b);
  const d = sub(b, a);
  const toC = sub(c, mid);
  const n1 = { x: -d.y / (len || 1), y: d.x / (len || 1) };
  const inward = n1.x * toC.x + n1.y * toC.y >= 0 ? n1 : { x: -n1.x, y: -n1.y };
  return { a, b, len, mid, yaw: yawFromDir(d.x, d.y), inward };
}

function CounterMesh({ c, items, elev }: { c: Counter; items: PlacedItem[]; elev: number }) {
  const selected = useSelected(c.id);
  const shadows = useShadows();
  const bottom = useMemo(() => {
    let best = -1;
    for (const i of items) {
      if (!BASE_TIER.has(i.kind)) continue;
      if (pointInPolygon({ x: i.x, y: i.y }, c.polygon)) best = Math.max(best, i.z + i.h);
    }
    return best > 0 ? best : 34.5;
  }, [items, c.polygon]);
  const top = bottom + c.thickIn;
  const geo = usePolygonGeometry(c.polygon, c.thickIn);
  const tex = useFinishTextureInches(c.material);

  const edges = useMemo(() => {
    if (c.polygon.length < 3) return null;
    const ctr = centroid(c.polygon);
    const all = c.polygon.map((p, i) => edgeInfo(p, c.polygon[(i + 1) % c.polygon.length], ctr));
    const longest = all.reduce((m, e) => (e.len > m.len ? e : m), all[0]);
    const back = c.runId ? all[0] : longest;
    // Facing the back edge from the front: left is the viewer's left.
    const view = { x: -back.inward.x, y: -back.inward.y };
    const leftVec = { x: view.y, y: -view.x };
    const side = (e: EdgeInfo) => (e.mid.x - ctr.x) * leftVec.x + (e.mid.y - ctr.y) * leftVec.y;
    const ends = all.filter((e) => e !== back);
    const left = ends.reduce((m, e) => (side(e) > side(m) ? e : m), ends[0]);
    const right = ends.reduce((m, e) => (side(e) < side(m) ? e : m), ends[0]);
    return { longest: back, left, right };
  }, [c.polygon, c.runId]);

  const splashLen = edges?.longest.len ?? 1;
  const splashTex = useFinishTexture(c.material, splashLen, c.backsplashIn || 1);
  const mat = { roughness: 0.35, metalness: 0.05 };

  if (!geo || !edges) return null;
  return (
    <Pick id={c.id}>
      <mesh geometry={geo} position={[0, elev + top, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow={shadows} receiveShadow={shadows}>
        <Surface color={c.material.color} map={tex} selected={selected} {...mat} />
        <StyleEdges />
      </mesh>
      {c.backsplashIn > 0 && edges.longest.len > 1 && (
        <Box
          size={[edges.longest.len, c.backsplashIn, 0.5]}
          position={[
            edges.longest.mid.x + edges.longest.inward.x * 0.25,
            elev + top + c.backsplashIn / 2,
            edges.longest.mid.y + edges.longest.inward.y * 0.25,
          ]}
          rotation={[0, edges.longest.yaw, 0]}
          color={c.material.color}
          map={splashTex}
          selected={selected}
          shadows={shadows}
          {...mat}
        />
      )}
      {c.waterfall.map((side) => {
        const e = side === "left" ? edges.left : edges.right;
        if (e.len < 1) return null;
        return (
          <Box
            key={side}
            size={[e.len, top, c.thickIn]}
            position={[e.mid.x + e.inward.x * (c.thickIn / 2), elev + top / 2, e.mid.y + e.inward.y * (c.thickIn / 2)]}
            rotation={[0, e.yaw, 0]}
            color={c.material.color}
            selected={selected}
            shadows={shadows}
            {...mat}
          />
        );
      })}
    </Pick>
  );
}
