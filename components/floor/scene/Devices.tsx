"use client";

// Electrical devices: small boxes/discs at (x, heightAff, y). Lights glow in
// night mode; the first 24 also become point lights (the rest stay meshes).

import { pointInPolygon, type Device, type ElecType, type Level, type Room, type Wall } from "@/lib/plan-doc";
import { wallFrame } from "@/lib/plan-geometry";
import { Box, Pick, Surface, isGhost, useScene, useSelected, yawFromDir } from "./shared";

export const LIGHT_TYPES = new Set<ElecType>(["recessed", "pendant", "sconce", "underCab", "surface"]);
export const MAX_POINT_LIGHTS = 24;

interface DevicesProps {
  devices: Device[];
  walls: Wall[];
  level: Level;
  /** For each device's own ceiling height (a room can differ from its level). */
  rooms?: Room[];
  elev: number;
}

/** Always on the ceiling, whatever height is stored. */
const CEILING_MOUNT = new Set<ElecType>(["recessed", "surface", "smoke", "exhaust"]);
/** Library default height for ceiling items (the old flat 8' ceiling). */
const LIBRARY_CEILING_AFF = 96;

export function Devices({ devices, walls, level, rooms = [], elev }: DevicesProps) {
  const { night } = useScene();
  let budget = 0;
  return (
    <>
      {devices.map((dev) => {
        const isLight = LIGHT_TYPES.has(dev.type);
        const emit = night && isLight && budget < MAX_POINT_LIGHTS;
        if (emit) budget++;
        const wall = dev.wallId ? walls.find((w) => w.id === dev.wallId) ?? null : null;
        const room = rooms.find((r) => pointInPolygon({ x: dev.x, y: dev.y }, r.polygon));
        const ceilingIn = room?.ceilingIn ?? level.ceilingIn;
        return <DeviceMesh key={dev.id} dev={dev} wall={wall} ceilingIn={ceilingIn} elev={elev} emit={emit} />;
      })}
    </>
  );
}

function defaultHeight(type: ElecType, ceiling: number): number {
  switch (type) {
    case "outlet":
    case "gfci":
    case "outlet240":
    case "data":
      return 15;
    case "switch":
    case "switch3":
    case "dimmer":
      return 44;
    case "recessed":
    case "surface":
    case "smoke":
    case "exhaust":
      return ceiling;
    case "pendant":
      return Math.max(30, ceiling - 30);
    case "sconce":
      return 66;
    case "underCab":
      return 52;
    case "fan":
      return ceiling - 10;
    case "panel":
      return 60;
    case "miniSplit":
      return ceiling - 14;
    case "register":
    case "return":
      return 0;
  }
}

function DeviceMesh({ dev, wall, ceilingIn, elev, emit }: { dev: Device; wall: Wall | null; ceilingIn: number; elev: number; emit: boolean }) {
  const { night, phase } = useScene();
  const selected = useSelected(dev.id);
  const ghost = isGhost(dev.phase, phase);
  const isLight = LIGHT_TYPES.has(dev.type);
  const glow = night && isLight;
  // Ceiling fixtures follow the real ceiling; a pendant / fan keeps a custom
  // hang height but not the library's flat 96".
  const aff = CEILING_MOUNT.has(dev.type)
    ? ceilingIn
    : (dev.type === "pendant" || dev.type === "fan") && (dev.heightAff === LIBRARY_CEILING_AFF || dev.heightAff <= 0)
      ? defaultHeight(dev.type, ceilingIn)
      : dev.type === "pendant" || dev.type === "fan"
        ? Math.min(dev.heightAff, ceilingIn - 6)
        : dev.heightAff > 0
          ? dev.heightAff
          : defaultHeight(dev.type, ceilingIn);
  const y = elev + aff;
  const yaw = wall ? yawFromDir(wallFrame(wall).dir.x, wallFrame(wall).dir.y) : 0;
  const bits = { ghost, selected, edges: false as const };
  const lamp = { color: "#f3f1ea", emissive: glow ? "#ffe2a8" : undefined, emissiveIntensity: glow ? 1.4 : undefined };
  const ivory = "#f2f1ec";

  let body: React.ReactNode;
  switch (dev.type) {
    case "recessed":
      body = (
        <mesh position={[0, Math.min(aff, ceilingIn) - 0.25 - aff, 0]}>
          <cylinderGeometry args={[3, 3, 0.5, 24]} />
          <Surface {...lamp} {...bits} />
        </mesh>
      );
      break;
    case "surface":
      body = (
        <mesh position={[0, -1.5, 0]}>
          <cylinderGeometry args={[6, 6, 3, 24]} />
          <Surface {...lamp} {...bits} />
        </mesh>
      );
      break;
    case "pendant": {
      const rod = Math.max(1, ceilingIn - aff - 4);
      body = (
        <>
          <mesh>
            <sphereGeometry args={[4, 20, 14]} />
            <Surface {...lamp} {...bits} />
          </mesh>
          <mesh position={[0, 4 + rod / 2, 0]}>
            <cylinderGeometry args={[0.25, 0.25, rod, 8]} />
            <Surface color="#55575a" metalness={0.5} roughness={0.4} {...bits} />
          </mesh>
        </>
      );
      break;
    }
    case "sconce":
      body = <Box size={[5, 8, 3]} position={[0, 0, 0]} rotation={[0, yaw, 0]} {...lamp} {...bits} />;
      break;
    case "underCab":
      body = <Box size={[12, 1, 3]} rotation={[0, yaw, 0]} {...lamp} {...bits} />;
      break;
    case "fan":
      body = (
        <>
          <mesh position={[0, 5, 0]}>
            <cylinderGeometry args={[3, 3, 10, 16]} />
            <Surface color="#8b8f92" metalness={0.4} roughness={0.5} {...bits} />
          </mesh>
          <Box size={[48, 0.4, 5]} color="#8b6b4a" {...bits} />
          <Box size={[5, 0.4, 48]} color="#8b6b4a" {...bits} />
        </>
      );
      break;
    case "smoke":
      body = (
        <mesh position={[0, -0.5, 0]}>
          <cylinderGeometry args={[3, 3, 1, 20]} />
          <Surface color={ivory} {...bits} />
        </mesh>
      );
      break;
    case "panel":
      body = <Box size={[14, 30, 4]} rotation={[0, yaw, 0]} color="#c9cbcd" metalness={0.4} roughness={0.5} {...bits} />;
      break;
    case "register":
    case "return":
      body = <Box size={[dev.type === "return" ? 20 : 4, 0.5, dev.type === "return" ? 14 : 10]} position={[0, 0.3, 0]} rotation={[0, yaw, 0]} color="#e2e2dc" {...bits} />;
      break;
    case "exhaust":
      body = <Box size={[10, 0.6, 10]} position={[0, -0.3, 0]} color="#e2e2dc" {...bits} />;
      break;
    case "miniSplit":
      body = <Box size={[32, 12, 8]} rotation={[0, yaw, 0]} color="#f0f0ec" {...bits} />;
      break;
    default:
      // outlet, gfci, outlet240, switch, switch3, dimmer, data
      body = <Box size={[2.75, 4.5, 0.5]} rotation={[0, yaw, 0]} color={ivory} {...bits} />;
  }

  return (
    <Pick id={dev.id} position={[dev.x, y, dev.y]}>
      {body}
      {emit && <pointLight position={[0, -2, 0]} color="#ffdfae" intensity={3000} distance={240} decay={2} />}
    </Pick>
  );
}
