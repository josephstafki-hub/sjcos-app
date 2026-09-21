"use client";

// Walls as boxes per solid segment (split at openings) plus headers/sills,
// and the openings themselves: door leaf + frame, window glass + frame + sill.

import { useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import type { FinishRef, FinishRegion, Opening, Wall } from "@/lib/plan-doc";
import { add, alongWall, mul, solidSegments, wallFrame, wallPolygon } from "@/lib/plan-geometry";
import {
  COLORS,
  Label,
  Pick,
  StyleEdges,
  Surface,
  isGhost,
  phaseShown,
  useFinishTexture,
  useScene,
  useSelected,
  useShadows,
  yawFromDir,
} from "./shared";

interface WallsProps {
  walls: Wall[];
  /** Every wall on the level (for corner mitres in sketch outlines). */
  allWalls: Wall[];
  openings: Opening[];
  finishes: FinishRegion[];
  elev: number;
}

export function Walls({ walls, allWalls, openings, finishes, elev }: WallsProps) {
  const { phase } = useScene();
  return (
    <>
      {walls.map((w) => (
        <WallMesh
          key={w.id}
          wall={w}
          all={allWalls}
          openings={openings.filter((o) => o.wallId === w.id && phaseShown(o.phase, phase))}
          finishes={finishes}
          elev={elev}
        />
      ))}
    </>
  );
}

interface Piece {
  key: string;
  t0: number;
  t1: number;
  y0: number;
  y1: number;
}

function WallMesh({
  wall,
  all,
  openings,
  finishes,
  elev,
}: {
  wall: Wall;
  all: Wall[];
  openings: Opening[];
  finishes: FinishRegion[];
  elev: number;
}) {
  const { phase, dollhouse, style } = useScene();
  const selected = useSelected(wall.id);
  const ghost = isGhost(wall.kind, phase);
  const H = dollhouse ? Math.min(wall.heightIn, 48) : wall.heightIn;
  const f = wallFrame(wall);
  const yaw = yawFromDir(f.dir.x, f.dir.y);
  const leftFin =
    finishes.find((r) => r.target === "wall" && r.wallId === wall.id && r.side === "left")?.material ??
    wall.faces?.left ??
    null;
  const rightFin =
    finishes.find((r) => r.target === "wall" && r.wallId === wall.id && r.side === "right")?.material ??
    wall.faces?.right ??
    null;

  const pieces = useMemo<Piece[]>(() => {
    const out: Piece[] = [];
    for (const [t0, t1] of solidSegments(wall, openings)) out.push({ key: `s${t0.toFixed(2)}`, t0, t1, y0: 0, y1: H });
    for (const o of openings) {
      const t0 = Math.max(0, o.atIn);
      const t1 = Math.min(f.length, o.atIn + o.widthIn);
      if (t1 - t0 < 0.5) continue;
      const top = o.sillIn + o.heightIn;
      if (top < H - 0.1) out.push({ key: `h${o.id}`, t0, t1, y0: top, y1: H });
      if (o.sillIn > 0.1) out.push({ key: `b${o.id}`, t0, t1, y0: 0, y1: Math.min(o.sillIn, H) });
    }
    return out;
  }, [wall, openings, H, f.length]);

  const outline = useMemo(() => (style === "sketch" ? wallPolygon(wall, all) : null), [style, wall, all]);

  return (
    <Pick id={wall.id}>
      {pieces.map((p) => (
        <WallPiece
          key={p.key}
          wall={wall}
          yaw={yaw}
          p={p}
          elev={elev}
          leftFin={leftFin}
          rightFin={rightFin}
          ghost={ghost}
          selected={selected}
        />
      ))}
      {outline && outline.length >= 3 && (
        <Line
          points={[...outline, outline[0]].map((q) => [q.x, elev + 0.15, q.y] as [number, number, number])}
          color={COLORS.edge}
          lineWidth={1.5}
        />
      )}
      {openings.map((o) => (
        <OpeningMesh key={o.id} o={o} wall={wall} elev={elev} H={H} wallGhost={ghost} />
      ))}
    </Pick>
  );
}

function WallPiece({
  wall,
  yaw,
  p,
  elev,
  leftFin,
  rightFin,
  ghost,
  selected,
}: {
  wall: Wall;
  yaw: number;
  p: Piece;
  elev: number;
  leftFin: FinishRef | null;
  rightFin: FinishRef | null;
  ghost: boolean;
  selected: boolean;
}) {
  const shadows = useShadows();
  const len = p.t1 - p.t0;
  const h = p.y1 - p.y0;
  const mid = alongWall(wall, (p.t0 + p.t1) / 2);
  const leftTex = useFinishTexture(leftFin, len, h);
  const rightTex = useFinishTexture(rightFin, len, h);
  const lc = leftFin?.color ?? COLORS.wall;
  const rc = rightFin?.color ?? COLORS.wall;
  const tint = wall.kind === "new" ? "new" : null;
  const common = { ghost, selected };
  const split = lc !== rc || !!leftTex || !!rightTex;
  return (
    <mesh
      position={[mid.x, elev + p.y0 + h / 2, mid.y]}
      rotation={[0, yaw, 0]}
      castShadow={shadows && !ghost}
      receiveShadow={shadows}
    >
      <boxGeometry args={[len, h, wall.thickIn]} />
      {split ? (
        <>
          {/* Box groups: +x, -x, +y, -y, +z (right face), -z (left face). */}
          <Surface attach="material-0" color={lc} {...common} />
          <Surface attach="material-1" color={lc} {...common} />
          <Surface attach="material-2" color={lc} {...common} />
          <Surface attach="material-3" color={lc} {...common} />
          <Surface attach="material-4" color={rc} map={rightTex} {...common} />
          <Surface attach="material-5" color={lc} map={leftTex} {...common} />
        </>
      ) : (
        <Surface color={lc} {...common} />
      )}
      <StyleEdges tint={tint} />
    </mesh>
  );
}

function OpeningMesh({
  o,
  wall,
  elev,
  H,
  wallGhost,
}: {
  o: Opening;
  wall: Wall;
  elev: number;
  H: number;
  wallGhost: boolean;
}) {
  const { phase } = useScene();
  const selected = useSelected(o.id);
  const shadows = useShadows();
  const ghost = wallGhost || isGhost(o.phase, phase);
  const f = wallFrame(wall);
  const yaw = yawFromDir(f.dir.x, f.dir.y);
  const t0 = Math.max(0, o.atIn);
  const t1 = Math.min(f.length, o.atIn + o.widthIn);
  const wIn = t1 - t0;
  const bottom = o.sillIn;
  const top = Math.min(o.sillIn + o.heightIn, H);
  const hIn = top - bottom;
  if (wIn < 0.5 || hIn < 0.5) return null;
  const centre = alongWall(wall, (t0 + t1) / 2);
  const start = alongWall(wall, t0);
  const end = alongWall(wall, t1);
  const fd = wall.thickIn + 1;
  const jamb = 1.5;
  const common = { ghost, selected };
  const isDoor = o.kind === "door";
  const isWin = o.kind === "window";
  const sub = o.subtype.toLowerCase();
  const inPlane = /pocket|slid|bifold|barn/.test(sub);
  const leafColor = "#e9e2d2";

  let leaf: React.ReactNode = null;
  if (isDoor && !inPlane) {
    // Hinge at the start (hand L) or end (hand R); leaf swung 90° open toward
    // the swing face.
    const hinge = o.hand === "L" ? start : end;
    const dir = mul(f.left, o.swing === "left" ? 1 : -1);
    const leafCount = /french|double/.test(sub) ? 2 : 1;
    const leafW = wIn / leafCount;
    const leaves: React.ReactNode[] = [];
    for (let i = 0; i < leafCount; i++) {
      const hp = i === 0 ? hinge : o.hand === "L" ? end : start;
      const c = add(hp, mul(dir, leafW / 2));
      leaves.push(
        <mesh
          key={i}
          position={[c.x, elev + bottom + hIn / 2, c.y]}
          rotation={[0, yawFromDir(dir.x, dir.y), 0]}
          castShadow={shadows && !ghost}
        >
          <boxGeometry args={[leafW - 0.5, hIn - 0.5, 1.75]} />
          <Surface color={leafColor} {...common} />
          <StyleEdges />
        </mesh>,
      );
    }
    leaf = <>{leaves}</>;
  } else if (isDoor) {
    leaf = (
      <mesh position={[centre.x, elev + bottom + hIn / 2, centre.y]} rotation={[0, yaw, 0]}>
        <boxGeometry args={[wIn - 0.5, hIn - 0.5, 1.5]} />
        <Surface color={leafColor} {...common} />
        <StyleEdges />
      </mesh>
    );
  }

  return (
    <Pick id={o.id}>
      <group position={[centre.x, elev, centre.y]} rotation={[0, yaw, 0]}>
        {/* Jambs + head */}
        <mesh position={[-(wIn / 2 - jamb / 2), bottom + hIn / 2, 0]}>
          <boxGeometry args={[jamb, hIn, fd]} />
          <Surface color={COLORS.trim} {...common} />
        </mesh>
        <mesh position={[wIn / 2 - jamb / 2, bottom + hIn / 2, 0]}>
          <boxGeometry args={[jamb, hIn, fd]} />
          <Surface color={COLORS.trim} {...common} />
        </mesh>
        <mesh position={[0, top - jamb / 2, 0]}>
          <boxGeometry args={[wIn, jamb, fd]} />
          <Surface color={COLORS.trim} {...common} />
        </mesh>
        {isWin && (
          <>
            <mesh position={[0, bottom + hIn / 2, 0]}>
              <boxGeometry args={[wIn - 2 * jamb, hIn - 2 * jamb, 0.25]} />
              <Surface
                color={COLORS.glass}
                opacity={0.35}
                roughness={0.1}
                metalness={0.2}
                side={THREE.DoubleSide}
                {...common}
              />
            </mesh>
            {/* Centre mullion on double/casement/slider units */}
            {/double|casement|slid/.test(sub) && wIn > 24 && (
              <mesh position={[0, bottom + hIn / 2, 0]}>
                <boxGeometry args={[1.25, hIn - 2 * jamb, fd - 0.5]} />
                <Surface color={COLORS.trim} {...common} />
              </mesh>
            )}
            {/* Sill / stool */}
            <mesh position={[0, bottom + jamb / 2, 0]}>
              <boxGeometry args={[wIn + 3, jamb, fd + 2]} />
              <Surface color={COLORS.trim} {...common} />
            </mesh>
          </>
        )}
      </group>
      {leaf}
      <Label text={o.tag} position={[centre.x, elev + top + 3, centre.y]} />
    </Pick>
  );
}
