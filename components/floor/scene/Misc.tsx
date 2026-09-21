"use client";

// Stairs (risers as stacked boxes) and structure (columns, beams, soffits).

import { dist, type Stair, type Structural } from "@/lib/plan-doc";
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

/** Straight run from the stair origin, climbing along local +z (the item
 *  "front" direction at rotDeg 0). L and U shapes render as a straight run. */
function StairMesh({ s, elev }: { s: Stair; elev: number }) {
  const { phase } = useScene();
  const selected = useSelected(s.id);
  const shadows = useShadows();
  const ghost = isGhost(s.phase, phase);
  const steps: React.ReactNode[] = [];
  for (let i = 0; i < s.riserCount; i++) {
    const h = (i + 1) * s.riserIn;
    steps.push(
      <Box
        key={i}
        size={[s.widthIn, h, s.treadIn]}
        position={[0, h / 2, i * s.treadIn + s.treadIn / 2]}
        color="#cbb894"
        roughness={0.7}
        ghost={ghost}
        selected={selected}
        shadows={shadows}
        edges={i === 0 || i === s.riserCount - 1}
      />,
    );
  }
  return (
    <Pick id={s.id} position={[s.x, elev, s.y]} rotation={[0, yawFromPlanDeg(s.rotDeg), 0]}>
      {steps}
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
