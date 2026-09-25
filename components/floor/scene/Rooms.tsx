"use client";

// Floor slab + ceiling per room (extruded polygon), and free-floating floor
// finish regions drawn as thin slabs on top.

import * as THREE from "three";
import { useMemo } from "react";
import { pointInPolygon, type FinishRegion, type Level, type Pt, type Room, type Stair } from "@/lib/plan-doc";
import { stairFootprint } from "@/lib/plan-stairs";
import { COLORS, Pick, Surface, StyleEdges, useFinishTextureInches, usePolygonGeometry, useScene, useSelected, useShadows } from "./shared";

interface RoomsProps {
  rooms: Room[];
  finishes: FinishRegion[];
  level: Level;
  elev: number;
  /** Every stair in the design: stairs arriving here cut this floor, stairs
   *  leaving here cut this level's ceiling. */
  stairs?: Stair[];
}

export function Rooms({ rooms, finishes, level, elev, stairs = [] }: RoomsProps) {
  const regions = finishes.filter((f) => f.target === "floor" && f.polygon && f.polygon.length >= 3);
  const wells = useMemo(() => {
    const floor: Pt[][] = [];
    const ceiling: Pt[][] = [];
    for (const s of stairs) {
      if (s.fromLevelId === s.toLevelId) continue;
      if (s.toLevelId === level.id) floor.push(stairFootprint(s));
      if (s.fromLevelId === level.id) ceiling.push(stairFootprint(s));
    }
    return { floor, ceiling };
  }, [stairs, level.id]);
  return (
    <>
      {rooms.map((r) => (
        <RoomMesh key={r.id} room={r} finishes={finishes} level={level} elev={elev} floorWells={wells.floor} ceilingWells={wells.ceiling} />
      ))}
      {regions.map((f) => (
        <RegionSlab key={f.id} region={f} elev={elev} />
      ))}
    </>
  );
}

/** Wells that fall wholly inside the room (a partial overlap can't be a hole). */
function wellsIn(room: Room, wells: Pt[][]): Pt[][] {
  return wells.filter((w) => w.every((p) => pointInPolygon(p, room.polygon)));
}

function RoomMesh({
  room,
  finishes,
  level,
  elev,
  floorWells,
  ceilingWells,
}: {
  room: Room;
  finishes: FinishRegion[];
  level: Level;
  elev: number;
  floorWells: Pt[][];
  ceilingWells: Pt[][];
}) {
  const { dollhouse } = useScene();
  const selected = useSelected(room.id);
  const shadows = useShadows();
  const floorFin =
    finishes.find((f) => f.target === "floor" && f.roomId === room.id && !f.polygon)?.material ?? room.floor;
  const ceilFin = finishes.find((f) => f.target === "ceiling" && f.roomId === room.id)?.material ?? room.ceiling;
  const geo = usePolygonGeometry(room.polygon, 1, wellsIn(room, floorWells));
  const ceilGeo = usePolygonGeometry(room.polygon, 1, wellsIn(room, ceilingWells));
  const floorTex = useFinishTextureInches(floorFin);
  const ceilIn = room.ceilingIn ?? level.ceilingIn;
  if (!geo) return null;
  return (
    <Pick id={room.id}>
      <mesh geometry={geo} position={[0, elev, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow={shadows}>
        <Surface
          color={floorFin?.color ?? COLORS.floor}
          map={floorTex}
          selected={selected}
          roughness={0.7}
          side={THREE.DoubleSide}
        />
        <StyleEdges tint="soft" />
      </mesh>
      {!dollhouse && ceilGeo && (
        <mesh geometry={ceilGeo} position={[0, elev + ceilIn + 1, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <Surface color={ceilFin?.color ?? COLORS.ceiling} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      )}
    </Pick>
  );
}

function RegionSlab({ region, elev }: { region: FinishRegion; elev: number }) {
  const selected = useSelected(region.id);
  const shadows = useShadows();
  const geo = usePolygonGeometry(region.polygon ?? [], 0.5);
  const tex = useFinishTextureInches(region.material);
  if (!geo) return null;
  return (
    <Pick id={region.id}>
      <mesh geometry={geo} position={[0, elev + 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow={shadows}>
        <Surface color={region.material.color} map={tex} selected={selected} roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
    </Pick>
  );
}
