"use client";

// Floor slab + ceiling per room (extruded polygon), and free-floating floor
// finish regions drawn as thin slabs on top.

import * as THREE from "three";
import type { FinishRegion, Level, Room } from "@/lib/plan-doc";
import { COLORS, Pick, Surface, StyleEdges, useFinishTextureInches, usePolygonGeometry, useScene, useSelected, useShadows } from "./shared";

interface RoomsProps {
  rooms: Room[];
  finishes: FinishRegion[];
  level: Level;
  elev: number;
}

export function Rooms({ rooms, finishes, level, elev }: RoomsProps) {
  const regions = finishes.filter((f) => f.target === "floor" && f.polygon && f.polygon.length >= 3);
  return (
    <>
      {rooms.map((r) => (
        <RoomMesh key={r.id} room={r} finishes={finishes} level={level} elev={elev} />
      ))}
      {regions.map((f) => (
        <RegionSlab key={f.id} region={f} elev={elev} />
      ))}
    </>
  );
}

function RoomMesh({ room, finishes, level, elev }: { room: Room; finishes: FinishRegion[]; level: Level; elev: number }) {
  const { dollhouse } = useScene();
  const selected = useSelected(room.id);
  const shadows = useShadows();
  const floorFin =
    finishes.find((f) => f.target === "floor" && f.roomId === room.id && !f.polygon)?.material ?? room.floor;
  const ceilFin = finishes.find((f) => f.target === "ceiling" && f.roomId === room.id)?.material ?? room.ceiling;
  const geo = usePolygonGeometry(room.polygon, 1);
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
      {!dollhouse && (
        <mesh geometry={geo} position={[0, elev + ceilIn + 1, 0]} rotation={[Math.PI / 2, 0, 0]}>
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
