"use client";

// Placed items. Each item is a group at its footprint centre (x, z, y) rotated
// by -rotDeg about world y; at rotDeg 0 the front (+local z) faces +world z.
// Kind-specific styling lives in the small components below; add a new look
// by extending `flavor()` and the switch in <ItemMesh>.

import { useMemo } from "react";
import * as THREE from "three";
import type { FinishRef, PlacedItem } from "@/lib/plan-doc";
import { Box, COLORS, Label, Pick, isGhost, useFinishTexture, useScene, useSelected, useShadows, yawFromPlanDeg } from "./shared";
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
  if (/range|stove/.test(s)) return "range";
  if (/cooktop/.test(s)) return "cooktop";
  if (/fridge|refrig|freezer/.test(s)) return "fridge";
  if (/dishwasher|\bdw\b/.test(s)) return "dishwasher";
  if (/hood/.test(s)) return "hood";
  if (/oven/.test(s)) return "oven";
  if (/micro/.test(s)) return "micro";
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
    body = <Cabinet item={item} bits={bits} color={override ?? (isHex(item.props.finishColor) ? item.props.finishColor : COLORS.cabinet)} />;
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

function Cabinet({ item, bits, color }: { item: PlacedItem; bits: StyleBits; color: string }) {
  const { doorStyle } = useScene();
  const { w, d, h, kind } = item;
  const toe = kind === "wall" ? 0 : Math.min(4.5, h * 0.2);
  const bodyH = h - toe;
  const style = String(item.props.doorStyle ?? doorStyle);
  const shaker = style === "shaker";
  const dark = shade(color, -0.08);
  const pull = "#5a5a58";
  const gap = 0.25;
  const frontZ = d / 2 + 0.375;
  const isDrawerBase = /drawer|\bdb\d/i.test(`${item.tag} ${item.label} ${item.libraryKey ?? ""}`) || item.props.drawers === true;

  const fronts: React.ReactNode[] = [];
  if (isDrawerBase) {
    const n = typeof item.props.drawerCount === "number" ? Math.max(1, Math.min(5, item.props.drawerCount)) : 3;
    const frontH = (bodyH - 0.5 - (n - 1) * gap) / n;
    for (let i = 0; i < n; i++) {
      const y = toe + 0.25 + frontH / 2 + i * (frontH + gap);
      fronts.push(
        <group key={i}>
          <Box size={[w - 0.5, frontH, 0.75]} position={[0, y, frontZ]} color={color} {...bits} />
          {shaker && w - 0.5 - 4.5 > 1 && frontH - 3 > 1 && (
            <Box size={[w - 5, frontH - 3, 0.06]} position={[0, y, frontZ + 0.41]} color={dark} edges={false} {...bits} />
          )}
          <Box size={[Math.min(5, w * 0.3), 0.4, 0.5]} position={[0, y, frontZ + 0.65]} color={pull} edges={false} {...bits} />
        </group>,
      );
    }
  } else {
    const n = Math.max(1, Math.min(4, Math.ceil((w - 0.5) / 24)));
    const doorW = (w - 0.5 - (n - 1) * gap) / n;
    const doorH = bodyH - 0.5;
    const y = toe + bodyH / 2;
    for (let i = 0; i < n; i++) {
      const x = -((w - 0.5) / 2) + doorW / 2 + i * (doorW + gap);
      // Pull near the opening edge: outer doors hinge on the outside.
      const hingeLeft = n === 1 ? item.props.hinge !== "R" : i < n / 2;
      const px = x + (hingeLeft ? 1 : -1) * (doorW / 2 - 2);
      const py = kind === "wall" ? toe + bodyH * 0.15 : toe + bodyH * 0.85;
      fronts.push(
        <group key={i}>
          <Box size={[doorW, doorH, 0.75]} position={[x, y, frontZ]} color={color} {...bits} />
          {shaker && doorW - 4.5 > 1 && doorH - 4.5 > 1 && (
            <Box size={[doorW - 4.5, doorH - 4.5, 0.06]} position={[x, y, frontZ + 0.41]} color={dark} edges={false} {...bits} />
          )}
          <Box size={[0.4, Math.min(4, doorH * 0.3), 0.5]} position={[px, py, frontZ + 0.65]} color={pull} edges={false} {...bits} />
        </group>,
      );
    }
  }

  return (
    <>
      <Box size={[w, bodyH, d]} position={[0, toe + bodyH / 2, 0]} color={color} {...bits} />
      {toe > 0 && <Box size={[w, toe, Math.max(1, d - 3)]} position={[0, toe / 2, -1.5]} color={COLORS.toe} edges={false} {...bits} />}
      {fronts}
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
