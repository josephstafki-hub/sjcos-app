"use client";

// Properties tab: context-sensitive editor for whatever is selected. Resolves
// the first selected id to its element type and renders the matching form.
// Every edit is a PlanOp through ctx.d.apply(); nothing here mutates the doc.

import { useMemo } from "react";
import { Trash2, Scissors, FlipHorizontal2 } from "lucide-react";
import type { DesignerContext } from "../view-state";
import { fmtIn, levelSlice, wallLength, type Opening, type PlanDoc, type Wall } from "@/lib/plan-doc";
import { DOOR_SUBTYPES, FINISH_PRESETS, OPENING_SUBTYPES, WINDOW_SUBTYPES } from "@/lib/plan-library";
import { BTN_DANGER, BTN_GHOST, Empty, Grid, NumberField, PHASE_OPTIONS, SectionHeader, Segmented, SelectField, Stat, TextField } from "./fields";
import { CounterProps, ItemProps } from "./props-items";
import { CabinetStyleEditor } from "./CabinetStyle";
import { CABINET_STYLE_KINDS } from "@/lib/plan-cabinet";
import { CameraProps, DeviceProps, DimProps, FinishRegionProps, NoteProps, RoomProps, SectionProps, StairProps, StructureProps } from "./props-misc";

export type Resolved =
  | { type: "wall"; el: Wall }
  | { type: "opening"; el: Opening }
  | { type: "item"; el: PlanDoc["items"][number] }
  | { type: "counter"; el: PlanDoc["counters"][number] }
  | { type: "room"; el: PlanDoc["rooms"][number] }
  | { type: "device"; el: PlanDoc["electrical"][number] }
  | { type: "note"; el: PlanDoc["notes"][number] }
  | { type: "dim"; el: PlanDoc["dims"][number] }
  | { type: "stairs"; el: PlanDoc["stairs"][number] }
  | { type: "structure"; el: PlanDoc["structure"][number] }
  | { type: "camera"; el: PlanDoc["cameras"][number] }
  | { type: "section"; el: PlanDoc["sections"][number] }
  | { type: "finish"; el: PlanDoc["finishes"][number] }
  | null;

export function resolveId(doc: PlanDoc, id: string): Resolved {
  const find = <T extends { id: string }>(arr: T[]) => arr.find((x) => x.id === id);
  let el: { id: string } | undefined;
  if ((el = find(doc.walls))) return { type: "wall", el: el as Wall };
  if ((el = find(doc.openings))) return { type: "opening", el: el as Opening };
  if ((el = find(doc.items))) return { type: "item", el: el as PlanDoc["items"][number] };
  if ((el = find(doc.counters))) return { type: "counter", el: el as PlanDoc["counters"][number] };
  if ((el = find(doc.rooms))) return { type: "room", el: el as PlanDoc["rooms"][number] };
  if ((el = find(doc.electrical))) return { type: "device", el: el as PlanDoc["electrical"][number] };
  if ((el = find(doc.notes))) return { type: "note", el: el as PlanDoc["notes"][number] };
  if ((el = find(doc.dims))) return { type: "dim", el: el as PlanDoc["dims"][number] };
  if ((el = find(doc.stairs))) return { type: "stairs", el: el as PlanDoc["stairs"][number] };
  if ((el = find(doc.structure))) return { type: "structure", el: el as PlanDoc["structure"][number] };
  if ((el = find(doc.cameras))) return { type: "camera", el: el as PlanDoc["cameras"][number] };
  if ((el = find(doc.sections))) return { type: "section", el: el as PlanDoc["sections"][number] };
  if ((el = find(doc.finishes))) return { type: "finish", el: el as PlanDoc["finishes"][number] };
  return null;
}

export function PropertiesPanel({ ctx }: { ctx: DesignerContext }) {
  const { doc, selected } = ctx.d;
  const first = selected[0];
  const resolved = useMemo(() => (first ? resolveId(doc, first) : null), [doc, first]);

  if (!first) return <LevelSummary ctx={ctx} />;
  if (selected.length > 1) return <MultiSelect ctx={ctx} />;
  if (!resolved) return <Empty>That element is gone. Select something on the plan.</Empty>;

  switch (resolved.type) {
    case "wall":
      return <WallProps ctx={ctx} wall={resolved.el} />;
    case "opening":
      return <OpeningProps ctx={ctx} opening={resolved.el} />;
    case "item":
      return <ItemProps ctx={ctx} item={resolved.el} />;
    case "counter":
      return <CounterProps ctx={ctx} counter={resolved.el} />;
    case "room":
      return <RoomProps ctx={ctx} room={resolved.el} />;
    case "device":
      return <DeviceProps ctx={ctx} device={resolved.el} />;
    case "note":
      return <NoteProps ctx={ctx} note={resolved.el} />;
    case "dim":
      return <DimProps ctx={ctx} dim={resolved.el} />;
    case "stairs":
      return <StairProps ctx={ctx} stair={resolved.el} />;
    case "structure":
      return <StructureProps ctx={ctx} el={resolved.el} />;
    case "camera":
      return <CameraProps ctx={ctx} camera={resolved.el} />;
    case "section":
      return <SectionProps ctx={ctx} section={resolved.el} />;
    case "finish":
      return <FinishRegionProps ctx={ctx} region={resolved.el} />;
  }
}

// ─── Nothing selected ────────────────────────────────────────────────────────

function LevelSummary({ ctx }: { ctx: DesignerContext }) {
  const { doc, levelId } = ctx.d;
  const s = useMemo(() => levelSlice(doc, levelId), [doc, levelId]);
  const level = doc.levels.find((l) => l.id === levelId);
  const cabinets = s.items.filter((i) => ["base", "wall", "tall", "vanity", "island"].includes(i.kind)).length;
  const sf = Math.round(s.rooms.reduce((a, r) => a + r.areaSf, 0));
  return (
    <div>
      <SectionHeader>{level?.name ?? "Level"}</SectionHeader>
      <div className="flex flex-col gap-1">
        <Stat label="Rooms" value={s.rooms.length} />
        <Stat label="Floor area" value={`${sf} sf`} />
        <Stat label="Walls" value={s.walls.length} />
        <Stat label="Openings" value={s.openings.length} />
        <Stat label="Cabinets" value={cabinets} />
        <Stat label="Appliances" value={s.items.filter((i) => i.kind === "appliance").length} />
        <Stat label="Fixtures" value={s.items.filter((i) => i.kind === "plumbing").length} />
        <Stat label="Devices" value={s.electrical.length} />
      </div>
      <div className="mt-4">
        <Empty>Select something on the plan to edit it.</Empty>
      </div>
    </div>
  );
}

// ─── Multi-select ────────────────────────────────────────────────────────────

function MultiSelect({ ctx }: { ctx: DesignerContext }) {
  const { doc, selected } = ctx.d;
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const id of selected) {
      const r = resolveId(doc, id);
      const k = r ? r.type : "other";
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    return [...c.entries()];
  }, [doc, selected]);
  const itemIds = selected.filter((id) => doc.items.some((i) => i.id === id));
  const cabinets = useMemo(() => doc.items.filter((i) => selected.includes(i.id) && CABINET_STYLE_KINDS.has(i.kind)), [doc.items, selected]);
  const ro = ctx.readOnly;
  return (
    <div>
      <SectionHeader>{selected.length} selected</SectionHeader>
      <div className="flex flex-col gap-1">
        {counts.map(([k, n]) => (
          <Stat key={k} label={k} value={n} />
        ))}
      </div>
      {cabinets.length > 0 && <CabinetStyleEditor ctx={ctx} items={cabinets} />}
      {itemIds.length > 0 && (
        <>
          <SectionHeader>Phase ({itemIds.length} items)</SectionHeader>
          <Segmented
            value={null}
            options={PHASE_OPTIONS}
            disabled={ro}
            onChange={(phase) => ctx.d.apply({ op: "setItemPhase", ids: itemIds, phase })}
          />
        </>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" className={BTN_GHOST} onClick={() => ctx.d.select([])}>
          Clear selection
        </button>
        <button type="button" className={BTN_DANGER} disabled={ro} onClick={() => ctx.d.apply({ op: "delete", ids: selected })}>
          <Trash2 className="size-3" strokeWidth={1.75} /> Delete all
        </button>
      </div>
    </div>
  );
}

// ─── Wall ────────────────────────────────────────────────────────────────────

const WALL_FINISHES = FINISH_PRESETS.filter((p) => p.category === "paint" || p.category === "tile").map((p) => ({ key: p.key, label: p.label }));

function WallProps({ ctx, wall }: { ctx: DesignerContext; wall: Wall }) {
  const ro = ctx.readOnly;
  const len = wallLength(wall);
  const openings = ctx.d.doc.openings.filter((o) => o.wallId === wall.id);
  const patch = (p: Partial<Omit<Wall, "id" | "levelId">>) => ctx.d.apply({ op: "updateWall", id: wall.id, patch: p });
  const setLength = (n: number) => {
    if (len < 0.01) return;
    const ux = (wall.b.x - wall.a.x) / len;
    const uy = (wall.b.y - wall.a.y) / len;
    patch({ b: { x: wall.a.x + ux * n, y: wall.a.y + uy * n } });
  };
  return (
    <div>
      <SectionHeader>Wall</SectionHeader>
      <Segmented
        value={wall.kind}
        disabled={ro}
        options={[
          { key: "existing", label: "Existing" },
          { key: "remove", label: "Remove" },
          { key: "new", label: "New" },
        ]}
        onChange={(kind) => patch({ kind })}
      />
      <div className="mt-2">
        <Grid cols={3}>
          <NumberField label="Length" value={len} min={1} disabled={ro} onCommit={setLength} />
          <NumberField label="Thick" value={wall.thickIn} min={0.5} max={36} inchesOnly disabled={ro} onCommit={(thickIn) => patch({ thickIn })} />
          <NumberField label="Height" value={wall.heightIn} min={12} max={300} disabled={ro} onCommit={(heightIn) => patch({ heightIn })} />
        </Grid>
      </div>
      <SectionHeader>Finish</SectionHeader>
      <Grid>
        <SelectField
          label="Left face"
          value={wall.faces?.left?.key ?? ""}
          options={WALL_FINISHES}
          allowEmpty="None"
          disabled={ro}
          onChange={(k) => ctx.d.apply({ op: "setWallFinish", wallId: wall.id, side: "left", material: k || null })}
        />
        <SelectField
          label="Right face"
          value={wall.faces?.right?.key ?? ""}
          options={WALL_FINISHES}
          allowEmpty="None"
          disabled={ro}
          onChange={(k) => ctx.d.apply({ op: "setWallFinish", wallId: wall.id, side: "right", material: k || null })}
        />
      </Grid>
      <SectionHeader>Openings ({openings.length})</SectionHeader>
      {openings.length === 0 ? (
        <div className="text-[12px] text-ink-3">None on this wall.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {openings.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => ctx.d.select([o.id])}
              className="flex items-center gap-2 rounded-md border border-rule px-2 py-1 text-left text-[12px] hover:border-ink-4"
            >
              <span className="font-mono text-ink">{o.tag || o.kind}</span>
              <span className="flex-1 truncate text-ink-3">{o.subtype}</span>
              <span className="font-mono text-ink-3">{fmtIn(o.widthIn, { inchesOnly: true })}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={BTN_GHOST} disabled={ro} onClick={() => ctx.d.apply({ op: "splitWall", id: wall.id, atIn: len / 2 })}>
          <Scissors className="size-3" strokeWidth={1.75} /> Split at midpoint
        </button>
        <button type="button" className={BTN_DANGER} disabled={ro} onClick={() => ctx.d.apply({ op: "delete", ids: [wall.id] })}>
          <Trash2 className="size-3" strokeWidth={1.75} /> Delete
        </button>
      </div>
    </div>
  );
}

// ─── Opening ─────────────────────────────────────────────────────────────────

function OpeningProps({ ctx, opening }: { ctx: DesignerContext; opening: Opening }) {
  const ro = ctx.readOnly;
  const wall = ctx.d.doc.walls.find((w) => w.id === opening.wallId);
  const wallLen = wall ? wallLength(wall) : 0;
  const patch = (p: Partial<Omit<Opening, "id">>) => ctx.d.apply({ op: "updateOpening", id: opening.id, patch: p });
  const subtypes = opening.kind === "door" ? DOOR_SUBTYPES : opening.kind === "window" ? WINDOW_SUBTYPES : OPENING_SUBTYPES;
  return (
    <div>
      <SectionHeader>{opening.kind === "door" ? "Door" : opening.kind === "window" ? "Window" : "Opening"}</SectionHeader>
      <Segmented
        value={opening.kind}
        disabled={ro}
        options={[
          { key: "door", label: "Door" },
          { key: "window", label: "Window" },
          { key: "opening", label: "Opening" },
        ]}
        onChange={(kind) => patch({ kind, sillIn: kind === "window" ? ctx.d.defaults.windowSillIn : 0 })}
      />
      <div className="mt-2 flex flex-col gap-2">
        <SelectField label="Type" value={opening.subtype} options={subtypes} disabled={ro} onChange={(subtype) => patch({ subtype })} />
        <Grid cols={3}>
          <NumberField label="Width" value={opening.widthIn} min={6} max={300} inchesOnly disabled={ro} onCommit={(widthIn) => patch({ widthIn })} />
          <NumberField label="Height" value={opening.heightIn} min={6} max={200} inchesOnly disabled={ro} onCommit={(heightIn) => patch({ heightIn })} />
          <NumberField label="Sill" value={opening.sillIn} min={0} max={200} inchesOnly disabled={ro} onCommit={(sillIn) => patch({ sillIn })} />
        </Grid>
        <Grid>
          <TextField label="Tag" value={opening.tag} maxLength={16} disabled={ro} onCommit={(tag) => patch({ tag })} />
          <NumberField
            label={`Along wall${wall ? ` (of ${fmtIn(wallLen)})` : ""}`}
            value={opening.atIn}
            min={0}
            max={Math.max(0, wallLen - opening.widthIn)}
            disabled={ro}
            onCommit={(atIn) => patch({ atIn })}
          />
        </Grid>
        {opening.kind === "door" && (
          <Grid>
            <Segmented
              label="Hand"
              value={opening.hand}
              disabled={ro}
              options={[
                { key: "L", label: "Left" },
                { key: "R", label: "Right" },
              ]}
              onChange={(hand) => patch({ hand })}
            />
            <Segmented
              label="Swing"
              value={opening.swing}
              disabled={ro}
              options={[
                { key: "left", label: "Left face" },
                { key: "right", label: "Right face" },
              ]}
              onChange={(swing) => patch({ swing })}
            />
          </Grid>
        )}
        <Segmented label="Phase" value={opening.phase} options={PHASE_OPTIONS} disabled={ro} onChange={(phase) => patch({ phase })} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {opening.kind === "door" && (
          <button type="button" className={BTN_GHOST} disabled={ro} onClick={() => patch({ hand: opening.hand === "L" ? "R" : "L" })}>
            <FlipHorizontal2 className="size-3" strokeWidth={1.75} /> Flip hand
          </button>
        )}
        {wall && (
          <button type="button" className={BTN_GHOST} onClick={() => ctx.d.select([wall.id])}>
            Select wall
          </button>
        )}
        <button type="button" className={BTN_DANGER} disabled={ro} onClick={() => ctx.d.apply({ op: "delete", ids: [opening.id] })}>
          <Trash2 className="size-3" strokeWidth={1.75} /> Delete
        </button>
      </div>
    </div>
  );
}
