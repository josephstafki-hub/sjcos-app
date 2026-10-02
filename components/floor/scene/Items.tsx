"use client";

// Placed items. Each item is a group at its footprint centre (x, z, y) rotated
// by -rotDeg about world y; at rotDeg 0 the front (+local z) faces +world z.
// Kind-specific styling lives in the small components below; add a new look
// by extending `flavor()` and the switch in <ItemMesh>.

import { useMemo } from "react";
import * as THREE from "three";
import type { FinishRef, PlacedItem } from "@/lib/plan-doc";
import { cabinetLayout, cabinetStyle, HARDWARE_FINISHES, profileFrame, type CabFront, type CabPull } from "@/lib/plan-cabinet";
import { Box, COLORS, Label, Pick, Surface, isGhost, useFinishTexture, useScene, useSelected, useShadows, yawFromPlanDeg } from "./shared";
import { isHex, shade } from "./textures";

const CABINET_KINDS = new Set<PlacedItem["kind"]>(["base", "wall", "tall", "vanity", "island"]);
const LABELLED = new Set<PlacedItem["kind"]>(["base", "wall", "tall", "vanity", "island", "appliance", "plumbing"]);

type Flavor =
  | "range"
  | "cooktop"
  | "fridge"
  | "dishwasher"
  | "hood"
  | "oven"
  | "micro"
  | "washer"
  | "toilet"
  | "tub"
  | "sink"
  | "shower"
  | null;

/** Best-effort sub-type from props.type / libraryKey / label keywords. */
export function flavor(i: PlacedItem): Flavor {
  const s = `${String(i.props.type ?? "")} ${i.libraryKey ?? ""} ${i.label}`.toLowerCase();
  if (/toilet|\bwc\b/.test(s)) return "toilet";
  if (/shower/.test(s)) return "shower";
  if (/sink|\blav/.test(s)) return "sink";
  if (/tub/.test(s)) return "tub";
  // Hood / over-range microwave first: their names say "range" too.
  if (/hood/.test(s)) return "hood";
  if (/micro/.test(s)) return "micro";
  if (/range|stove/.test(s)) return "range";
  if (/cooktop/.test(s)) return "cooktop";
  if (/fridge|refrig|freezer/.test(s)) return "fridge";
  if (/dishwasher|\bdw\b/.test(s)) return "dishwasher";
  if (/oven/.test(s)) return "oven";
  if (/washer|dryer/.test(s)) return "washer";
  return null;
}

export function Items({ items, elev }: { items: PlacedItem[]; elev: number }) {
  return (
    <>
      {items.map((i) => (
        <ItemMesh key={i.id} item={i} elev={elev} />
      ))}
    </>
  );
}

interface StyleBits {
  ghost: boolean;
  selected: boolean;
  shadows: boolean;
}

function ItemMesh({ item, elev }: { item: PlacedItem; elev: number }) {
  const { phase } = useScene();
  const selected = useSelected(item.id);
  const shadows = useShadows();
  const ghost = isGhost(item.phase, phase);
  const bits: StyleBits = { ghost, selected, shadows };
  const override = isHex(item.props.color) ? item.props.color : null;
  const { w, d, h } = item;

  let body: React.ReactNode;
  if (CABINET_KINDS.has(item.kind)) {
    body = <Cabinet item={item} bits={bits} override={override} />;
  } else if (item.kind === "appliance") {
    body = <Appliance item={item} bits={bits} color={override ?? COLORS.stainless} />;
  } else if (item.kind === "plumbing") {
    body = <Fixture item={item} bits={bits} color={override ?? COLORS.fixture} />;
  } else if (item.kind === "furniture") {
    body = <Furniture item={item} bits={bits} color={override ?? COLORS.wood} />;
  } else if (item.kind === "structure") {
    body = <Box size={[w, h, d]} position={[0, h / 2, 0]} color={override ?? COLORS.grey} {...bits} />;
  } else if (item.kind === "counter") {
    body = <Box size={[w, h, d]} position={[0, h / 2, 0]} color={override ?? "#c8c2b4"} roughness={0.4} {...bits} />;
  } else if (item.kind === "electrical" || item.kind === "lighting" || item.kind === "hvac") {
    body = <Box size={[w, h, d]} position={[0, h / 2, 0]} color={override ?? "#d9d9d3"} {...bits} />;
  } else {
    body = <Box size={[w, h, d]} position={[0, h / 2, 0]} color={override ?? COLORS.generic} {...bits} />;
  }

  return (
    <Pick id={item.id} position={[item.x, elev + item.z, item.y]} rotation={[0, yawFromPlanDeg(item.rotDeg), 0]}>
      {body}
      {LABELLED.has(item.kind) && <Label text={item.tag || item.label} position={[0, h + 4, 0]} />}
    </Pick>
  );
}

// ─── Cabinets ────────────────────────────────────────────────────────────────
//
// Built from the shared layout (lib/plan-cabinet — the elevations draw the
// same fronts): carcass, toe kick / legs, face frame, doors & drawers in the
// chosen profile, hardware in the chosen metal, crown and light rail.

const FRONT_T = 0.75;

function Cabinet({ item, bits, override }: { item: PlacedItem; bits: StyleBits; override: string | null }) {
  const { settings } = useScene();
  const style = useMemo(() => cabinetStyle(item, { settings }), [item, settings]);
  const layout = useMemo(() => cabinetLayout(item, style, settings.defaults.toeIn), [item, style, settings.defaults.toeIn]);
  const { w, d, h } = item;
  const color = override ?? style.color;
  const fin = useMemo<FinishRef | null>(
    () => (style.textureKey && !override ? { key: style.finish, label: style.finish, color, textureKey: style.textureKey } : null),
    [style.textureKey, style.finish, color, override],
  );
  const tex = useFinishTexture(fin, w, h);
  const hw = HARDWARE_FINISHES.find((f) => f.key === style.hardwareFinish) ?? HARDWARE_FINISHES[0];
  const toe = layout.toe;
  const bodyH = h - toe;
  const face = d / 2;
  const frontZ = face + layout.frontOffset + FRONT_T / 2;
  const detail = { ...bits, edges: false as const, shadows: false };
  const surf = { color, map: tex, roughness: 0.55 };

  return (
    <>
      {/* Carcass */}
      <Box size={[w, bodyH, d]} position={[0, toe + bodyH / 2, 0]} {...surf} {...bits} />
      {toe > 0 && layout.toeStyle === "recessed" && (
        <Box size={[w, toe, Math.max(1, d - 3)]} position={[0, toe / 2, -1.5]} color={COLORS.toe} edges={false} {...bits} />
      )}
      {toe > 0 && layout.toeStyle === "legs" &&
        [-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`${sx}${sz}`} position={[sx * (w / 2 - 1.5), toe / 2, sz * (d / 2 - 1.5)]}>
              <cylinderGeometry args={[0.9, 0.7, toe, 12]} />
              <Surface color={color} map={tex} roughness={0.55} ghost={bits.ghost} selected={bits.selected} />
            </mesh>
          )),
        )}
      {/* Face frame */}
      {layout.frame.map((r, i) => (
        <Box key={`f${i}`} size={[r.x1 - r.x0, r.z1 - r.z0, FRONT_T]} position={[(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, face + FRONT_T / 2]} {...surf} {...detail} />
      ))}
      {/* Doors, drawers, false fronts, oven opening */}
      {layout.fronts.map((f, i) => (
        <group key={`d${i}`}>
          <FrontMesh f={f} z={frontZ} color={color} tex={tex} bits={bits} />
          {f.pulls.map((p, j) => (
            <PullMesh key={j} p={p} z={frontZ + FRONT_T / 2} color={hw.color} metalness={hw.metalness} roughness={hw.roughness} bits={detail} />
          ))}
        </group>
      ))}
      {layout.crown && (
        <>
          <Box size={[w + 1.5, 1.75, d + 0.75]} position={[0, h + 0.875, 0.375]} {...surf} {...detail} />
          <Box size={[w + 3, 1.25, d + 1.5]} position={[0, h + 2.375, 0.75]} {...surf} {...detail} />
        </>
      )}
      {layout.lightRail && <Box size={[w, 1.5, 0.75]} position={[0, -0.75, face + 0.375]} {...surf} {...detail} />}
    </>
  );
}

/** One door / drawer front in its profile: slab, or stiles + rails around a
 *  recessed (shaker), raised, beadboard or glass panel. */
function FrontMesh({ f, z, color, tex, bits }: { f: CabFront; z: number; color: string; tex: THREE.Texture | null; bits: StyleBits }) {
  const fw = f.x1 - f.x0;
  const fh = f.z1 - f.z0;
  const cx = (f.x0 + f.x1) / 2;
  const cz = (f.z0 + f.z1) / 2;
  const surf = { color, map: tex, roughness: 0.55 };
  const detail = { ...bits, edges: false as const, shadows: false };
  if (f.kind === "appliance") {
    return <Box size={[fw, fh, 0.5]} position={[cx, cz, z - FRONT_T / 2 + 0.25]} color={COLORS.black} roughness={0.3} metalness={0.4} {...bits} />;
  }
  const fr = profileFrame(f.profile, fw, fh);
  if (fr < 0.4) return <Box size={[fw, fh, FRONT_T]} position={[cx, cz, z]} {...surf} {...bits} />;
  const iw = fw - 2 * fr;
  const ih = fh - 2 * fr;
  const panelT = 0.375;
  const panelZ = z - FRONT_T / 2 + panelT / 2;
  const grooves: number[] = [];
  if (f.profile === "beaded" && !f.glass) for (let x = -iw / 2 + 2; x < iw / 2 - 1; x += 2) grooves.push(x);
  return (
    <>
      <Box size={[fr, fh, FRONT_T]} position={[f.x0 + fr / 2, cz, z]} {...surf} {...bits} />
      <Box size={[fr, fh, FRONT_T]} position={[f.x1 - fr / 2, cz, z]} {...surf} {...bits} />
      <Box size={[iw, fr, FRONT_T]} position={[cx, f.z1 - fr / 2, z]} {...surf} {...detail} />
      <Box size={[iw, fr, FRONT_T]} position={[cx, f.z0 + fr / 2, z]} {...surf} {...detail} />
      {f.glass ? (
        <Box size={[iw, ih, 0.2]} position={[cx, cz, panelZ]} color={COLORS.glass} opacity={0.35} roughness={0.08} metalness={0.2} side={THREE.DoubleSide} {...detail} />
      ) : (
        <Box size={[iw, ih, panelT]} position={[cx, cz, panelZ]} color={shade(color, -0.03)} map={tex} roughness={0.55} {...detail} />
      )}
      {f.profile === "raised" && !f.glass && iw > 4 && ih > 4 && (
        <Box size={[iw - 3, ih - 3, FRONT_T - 0.05]} position={[cx, cz, z - 0.025]} {...surf} {...bits} />
      )}
      {grooves.map((x) => (
        <Box key={x} size={[0.12, ih, 0.04]} position={[cx + x, cz, panelZ + panelT / 2 + 0.01]} color={shade(color, -0.18)} {...detail} />
      ))}
    </>
  );
}

function PullMesh({ p, z, color, metalness: metal, roughness: rough, bits }: { p: CabPull; z: number; color: string; metalness: number; roughness: number; bits: StyleBits & { edges: false } }) {
  // The scene has no reflection map, so a fully metallic surface renders
  // near-black; hold metalness down so brass reads as brass.
  const metalness = Math.min(metal, 0.55);
  const roughness = Math.max(rough, 0.3);
  const m = { color, metalness, roughness, ...bits };
  const horiz = p.orient === "h";
  if (p.kind === "knob") {
    return (
      <mesh position={[p.x, p.z, z + 0.6]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[p.len / 2, p.len / 2.6, 1.1, 16]} />
        <Surface color={color} metalness={metalness} roughness={roughness} ghost={bits.ghost} selected={bits.selected} />
      </mesh>
    );
  }
  if (p.kind === "cup") {
    return <Box size={[p.len, 1.1, 0.7]} position={[p.x, p.z, z + 0.35]} {...m} />;
  }
  if (p.kind === "edge") {
    return <Box size={horiz ? [p.len, 0.35, 0.9] : [0.35, p.len, 0.9]} position={[p.x, p.z, z + 0.2]} {...m} />;
  }
  // Bar on two standoffs.
  const off = 1;
  const posts = horiz ? [-p.len / 2, p.len / 2].map((dx) => [p.x + dx, p.z] as const) : [-p.len / 2, p.len / 2].map((dz) => [p.x, p.z + dz] as const);
  return (
    <>
      <Box size={horiz ? [p.len + 1, 0.45, 0.45] : [0.45, p.len + 1, 0.45]} position={[p.x, p.z, z + off]} {...m} />
      {posts.map(([x, y], i) => (
        <Box key={i} size={[0.3, 0.3, off]} position={[x, y, z + off / 2]} {...m} />
      ))}
    </>
  );
}

// ─── Appliances ──────────────────────────────────────────────────────────────

function Appliance({ item, bits, color }: { item: PlacedItem; bits: StyleBits; color: string }) {
  const { w, d, h } = item;
  const fl = flavor(item);
  const metal = { metalness: 0.6, roughness: 0.35 };
  return (
    <>
      <Box size={[w, h, d]} position={[0, h / 2, 0]} color={color} {...metal} {...bits} />
      {(fl === "range" || fl === "cooktop") && (
        <Box size={[w - 1, 1, d - 1]} position={[0, h + 0.5, 0]} color={COLORS.black} roughness={0.5} edges={false} {...bits} />
      )}
      {fl === "range" && (
        <Box size={[w, 6, 2]} position={[0, h + 3, -d / 2 + 1]} color={color} {...metal} {...bits} />
      )}
      {fl === "fridge" && (
        <>
          <Box size={[0.3, h - 4, 0.2]} position={[0, h / 2, d / 2 + 0.1]} color="#6a6d70" edges={false} {...bits} />
          <Box size={[0.8, Math.min(18, h * 0.3), 1]} position={[-3, h * 0.55, d / 2 + 0.6]} color="#8a8d90" edges={false} {...bits} />
          <Box size={[0.8, Math.min(18, h * 0.3), 1]} position={[3, h * 0.55, d / 2 + 0.6]} color="#8a8d90" edges={false} {...bits} />
        </>
      )}
      {fl === "dishwasher" && (
        <Box size={[w - 1, 2, 0.4]} position={[0, h - 2, d / 2 + 0.2]} color="#7d8083" edges={false} {...bits} />
      )}
      {(fl === "oven" || fl === "micro") && (
        <Box size={[w - 4, Math.max(2, h * 0.5), 0.3]} position={[0, h * 0.5, d / 2 + 0.15]} color={COLORS.black} edges={false} {...bits} />
      )}
    </>
  );
}

// ─── Plumbing fixtures ───────────────────────────────────────────────────────

function Fixture({ item, bits, color }: { item: PlacedItem; bits: StyleBits; color: string }) {
  const { w, d, h } = item;
  const fl = flavor(item);
  const porcelain = { roughness: 0.3, metalness: 0.05 };
  if (fl === "toilet") {
    const tankD = Math.min(8, d * 0.4);
    const bowlH = Math.min(15, h * 0.55);
    return (
      <>
        <Box size={[w, h, tankD]} position={[0, h / 2, -d / 2 + tankD / 2]} color={color} {...porcelain} {...bits} />
        <Box size={[w * 0.8, bowlH, d - tankD]} position={[0, bowlH / 2, tankD / 2]} color={color} {...porcelain} {...bits} />
      </>
    );
  }
  if (fl === "tub") {
    return (
      <>
        <Box size={[w, h, d]} position={[0, h / 2, 0]} color={color} {...porcelain} {...bits} />
        <Box size={[Math.max(1, w - 6), 0.6, Math.max(1, d - 6)]} position={[0, h - 0.2, 0]} color="#dfe2e3" edges={false} {...bits} />
      </>
    );
  }
  if (fl === "sink") {
    return (
      <>
        <Box size={[w, h, d]} position={[0, h / 2, 0]} color={color} {...porcelain} {...bits} />
        <Box size={[Math.max(1, w - 3), 0.5, Math.max(1, d - 3)]} position={[0, h - 0.2, 0]} color="#c9ccd0" edges={false} {...bits} />
      </>
    );
  }
  if (fl === "shower") {
    return (
      <>
        <Box size={[w, 4, d]} position={[0, 2, 0]} color={color} {...porcelain} {...bits} />
        <Box
          size={[w, Math.max(1, h - 4), d]}
          position={[0, 4 + (h - 4) / 2, 0]}
          color={COLORS.glass}
          opacity={0.25}
          roughness={0.1}
          side={THREE.DoubleSide}
          {...bits}
        />
      </>
    );
  }
  return <Box size={[w, h, d]} position={[0, h / 2, 0]} color={color} {...porcelain} {...bits} />;
}

// ─── Furniture ───────────────────────────────────────────────────────────────

function Furniture({ item, bits, color }: { item: PlacedItem; bits: StyleBits; color: string }) {
  const { w, d, h } = item;
  const fin = useMemo<FinishRef>(() => ({ key: "wood-furniture", label: "Wood", color }), [color]);
  const tex = useFinishTexture(fin, w, h);
  return <Box size={[w, h, d]} position={[0, h / 2, 0]} color={color} map={tex} roughness={0.6} {...bits} />;
}
