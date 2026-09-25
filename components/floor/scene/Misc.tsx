"use client";

// Stairs (risers as stacked boxes) and structure (columns, beams, soffits).

import { useMemo } from "react";
import { dist, type Stair, type Structural } from "@/lib/plan-doc";
import { stairLayout } from "@/lib/plan-stairs";
import { midPt, sub } from "@/lib/plan-geometry";
import { Box, COLORS, Label, Pick, isGhost, useScene, useSelected, useShadows, yawFromDir, yawFromPlanDeg } from "./shared";

export function Stairs({ stairs, elev }: { stairs: Stair[]; elev: number }) {
  return (
    <>
      {stairs.map((s) => (
        <StairMesh key={s.id} s={s} elev={elev} />
      ))}
    </>
  );
}

/** Treads + landing from the shared layout (lib/plan-stairs — the plan draws
 *  the same pieces): straight, L or U, bottom step at the front (local +z,
 *  the item "front" at rotDeg 0). Each piece is a solid block from the floor
 *  up to its tread. */
function StairMesh({ s, elev }: { s: Stair; elev: number }) {
  const { phase } = useScene();
  const selected = useSelected(s.id);
  const shadows = useShadows();
  const ghost = isGhost(s.phase, phase);
  const layout = useMemo(() => stairLayout(s), [s]);
  const top = Math.max(...layout.pieces.map((p) => p.level));
  return (
    <Pick id={s.id} position={[s.x, elev, s.y]} rotation={[0, yawFromPlanDeg(s.rotDeg), 0]}>
      {layout.pieces.map((p, i) => {
        const h = p.level * s.riserIn;
        return (
          <Box
            key={i}
            size={[p.x1 - p.x0, h, p.y1 - p.y0]}
            position={[(p.x0 + p.x1) / 2, h / 2, (p.y0 + p.y1) / 2]}
            color={p.kind === "landing" ? "#c2ad86" : "#cbb894"}
            roughness={0.7}
            ghost={ghost}
            selected={selected}
            shadows={shadows}
            edges={p.kind === "landing" || p.level === 1 || p.level === top}
          />
        );
      })}
    </Pick>
  );
}

export function Structure({ structure, elev }: { structure: Structural[]; elev: number }) {
  return (
    <>
      {structure.map((s) => (
        <StructuralMesh key={s.id} s={s} elev={elev} />
      ))}
    </>
  );
}

function StructuralMesh({ s, elev }: { s: Structural; elev: number }) {
  const { phase } = useScene();
  const selected = useSelected(s.id);
  const shadows = useShadows();
  const ghost = isGhost(s.phase, phase);
  const bits = { ghost, selected, shadows };
  if (s.kind === "column") {
    return (
      <Pick id={s.id} position={[s.a.x, elev + s.zIn, s.a.y]}>
        <Box size={[s.wIn, s.hIn, s.wIn]} position={[0, s.hIn / 2, 0]} color={COLORS.grey} {...bits} />
        <Label text={s.label} position={[0, s.hIn + 3, 0]} />
      </Pick>
    );
  }
  const len = dist(s.a, s.b);
  if (len < 0.5) return null;
  const mid = midPt(s.a, s.b);
  const d = sub(s.b, s.a);
  const color = s.kind === "beam" ? "#b9a58a" : COLORS.wall;
  return (
    <Pick id={s.id} position={[mid.x, elev + s.zIn, mid.y]} rotation={[0, yawFromDir(d.x, d.y), 0]}>
      <Box size={[len, s.hIn, s.wIn]} position={[0, s.hIn / 2, 0]} color={color} {...bits} />
      <Label text={s.label} position={[0, s.hIn + 3, 0]} />
    </Pick>
  );
}
