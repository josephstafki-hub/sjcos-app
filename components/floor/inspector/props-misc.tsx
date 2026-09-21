"use client";

// Properties editors for rooms, devices, notes, dimensions, stairs,
// structure, cameras, section lines, and finish regions.

import { Trash2, Crosshair } from "lucide-react";
import type { DesignerContext } from "../view-state";
import {
  fmtIn,
  type Camera,
  type Device,
  type Dim,
  type ElecType,
  type FinishRegion,
  type Note,
  type Room,
  type SectionLine,
  type Stair,
  type Structural,
  type TrimSet,
} from "@/lib/plan-doc";
import { ELEC_SYMBOLS, FINISH_PRESETS, TRIM_PROFILES, finishPreset } from "@/lib/plan-library";
import { BTN_DANGER, BTN_GHOST, Grid, NumberField, PHASE_OPTIONS, SectionHeader, Segmented, SelectField, Stat, TextField, Toggle } from "./fields";

const FLOOR_FINISHES = FINISH_PRESETS.filter((p) => ["flooring", "tile", "carpet", "concrete"].includes(p.category)).map((p) => ({ key: p.key, label: p.label }));
const PAINT_FINISHES = FINISH_PRESETS.filter((p) => p.category === "paint").map((p) => ({ key: p.key, label: p.label }));
const WALL_FINISHES = FINISH_PRESETS.filter((p) => ["paint", "tile", "wood"].includes(p.category)).map((p) => ({ key: p.key, label: p.label }));
const ELEC_OPTIONS = ELEC_SYMBOLS.map((s) => ({ key: s.type, label: s.label }));
const ELEC_GROUPS = (["power", "switch", "light", "safety", "hvac", "data"] as const).map((g) => ({
  label: g[0].toUpperCase() + g.slice(1),
  keys: ELEC_SYMBOLS.filter((s) => s.group === g).map((s) => s.type),
}));
const LIGHT_TYPES = new Set<ElecType>(ELEC_SYMBOLS.filter((s) => s.group === "light").map((s) => s.type));
const SWITCH_TYPES = new Set<ElecType>(["switch", "switch3", "dimmer"]);

function DeleteBtn({ ctx, id }: { ctx: DesignerContext; id: string }) {
  return (
    <button type="button" className={BTN_DANGER} disabled={ctx.readOnly} onClick={() => ctx.d.apply({ op: "delete", ids: [id] })}>
      <Trash2 className="size-3" strokeWidth={1.75} /> Delete
    </button>
  );
}

// ─── Room ────────────────────────────────────────────────────────────────────

export function RoomProps({ ctx, room }: { ctx: DesignerContext; room: Room }) {
  const ro = ctx.readOnly;
  const level = ctx.d.doc.levels.find((l) => l.id === room.levelId);
  const setTrim = (k: keyof TrimSet, v: string) => {
    const trim: TrimSet = { ...(room.trim ?? {}) };
    if (v) trim[k] = v;
    else delete trim[k];
    ctx.d.apply({ op: "setRoom", id: room.id, patch: { trim: Object.keys(trim).length ? trim : null } });
  };
  return (
    <div>
      <SectionHeader>Room</SectionHeader>
      <div className="flex flex-col gap-2">
        <TextField label="Name" value={room.name} maxLength={200} disabled={ro} onCommit={(name) => ctx.d.apply({ op: "setRoom", id: room.id, patch: { name, pinned: true } })} />
        <NumberField
          label={`Ceiling (level ${level ? fmtIn(level.ceilingIn) : "—"})`}
          value={room.ceilingIn ?? level?.ceilingIn ?? ctx.d.defaults.ceilingIn}
          min={12}
          max={300}
          disabled={ro}
          onCommit={(ceilingIn) => ctx.d.apply({ op: "setRoom", id: room.id, patch: { ceilingIn } })}
        />
        <Grid>
          <SelectField label="Floor" value={room.floor?.key ?? ""} allowEmpty="None" options={FLOOR_FINISHES} disabled={ro} onChange={(k) => ctx.d.apply({ op: "setFloorFinish", roomId: room.id, material: k || null })} />
          <SelectField label="Ceiling finish" value={room.ceiling?.key ?? ""} allowEmpty="None" options={PAINT_FINISHES} disabled={ro} onChange={(k) => ctx.d.apply({ op: "setCeilingFinish", roomId: room.id, material: k || null })} />
        </Grid>
        <SectionHeader>Trim set</SectionHeader>
        <Grid>
          {(["base", "crown", "casing", "chair"] as const).map((k) => (
            <SelectField key={k} label={k} value={room.trim?.[k] ?? ""} allowEmpty="None" options={TRIM_PROFILES[k]} disabled={ro} onChange={(v) => setTrim(k, v)} />
          ))}
        </Grid>
        <SectionHeader>Readout</SectionHeader>
        <Stat label="Area" value={`${Math.round(room.areaSf)} sf`} />
        <Stat label="Perimeter" value={`${room.perimLf.toFixed(1)} lf`} />
        <Stat label="Walls" value={room.wallIds.length} />
      </div>
    </div>
  );
}

// ─── Device ──────────────────────────────────────────────────────────────────

export function DeviceProps({ ctx, device }: { ctx: DesignerContext; device: Device }) {
  const ro = ctx.readOnly;
  const patch = (p: Partial<Omit<Device, "id" | "levelId">>) => ctx.d.apply({ op: "updateDevice", id: device.id, patch: p });
  const lights = SWITCH_TYPES.has(device.type) ? ctx.d.doc.electrical.filter((e) => e.levelId === device.levelId && LIGHT_TYPES.has(e.type)) : [];
  return (
    <div>
      <SectionHeader>Device</SectionHeader>
      <div className="flex flex-col gap-2">
        <SelectField label="Type" value={device.type} options={ELEC_OPTIONS} groups={ELEC_GROUPS} disabled={ro} onChange={(t) => patch({ type: t as ElecType })} />
        <Grid>
          <NumberField label="Height AFF" value={device.heightAff} min={0} max={200} inchesOnly disabled={ro} onCommit={(heightAff) => patch({ heightAff })} />
          <TextField label="Circuit" value={device.circuit} maxLength={16} disabled={ro} onCommit={(circuit) => patch({ circuit })} />
        </Grid>
        <Segmented label="Phase" value={device.phase} options={PHASE_OPTIONS} disabled={ro} onChange={(phase) => patch({ phase })} />
        {SWITCH_TYPES.has(device.type) && (
          <>
            <SectionHeader>Controls</SectionHeader>
            {lights.length === 0 ? (
              <div className="text-[12px] text-ink-3">No lights on this level yet.</div>
            ) : (
              <div className="flex flex-col gap-1">
                {lights.map((l) => (
                  <Toggle
                    key={l.id}
                    label={`${ELEC_SYMBOLS.find((s) => s.type === l.type)?.label ?? l.type}${l.circuit ? ` · ${l.circuit}` : ""}`}
                    on={device.switchLegTo.includes(l.id)}
                    disabled={ro}
                    onChange={(on) => ctx.d.apply({ op: "linkSwitch", switchId: device.id, lightId: l.id, on })}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div className="mt-4">
        <DeleteBtn ctx={ctx} id={device.id} />
      </div>
    </div>
  );
}

// ─── Note / Dim ──────────────────────────────────────────────────────────────

export function NoteProps({ ctx, note }: { ctx: DesignerContext; note: Note }) {
  const ro = ctx.readOnly;
  const patch = (p: Partial<Omit<Note, "id" | "levelId">>) => ctx.d.apply({ op: "updateNote", id: note.id, patch: p });
  return (
    <div>
      <SectionHeader>Note</SectionHeader>
      <div className="flex flex-col gap-2">
        <TextField label="Text" value={note.text} multiline maxLength={2000} disabled={ro} onCommit={(text) => patch({ text })} />
        <Segmented
          label="Kind"
          value={note.kind}
          disabled={ro}
          options={[
            { key: "note", label: "Note" },
            { key: "label", label: "Label" },
            { key: "cloud", label: "Cloud" },
            { key: "north", label: "North" },
          ]}
          onChange={(kind) => patch({ kind })}
        />
        <Toggle label="Leader line" on={!!note.leaderTo} disabled={ro} onChange={(on) => patch({ leaderTo: on ? { x: note.x + 24, y: note.y + 24 } : null })} />
      </div>
      <div className="mt-4">
        <DeleteBtn ctx={ctx} id={note.id} />
      </div>
    </div>
  );
}

export function DimProps({ ctx, dim }: { ctx: DesignerContext; dim: Dim }) {
  const ro = ctx.readOnly;
  const len = Math.hypot(dim.b.x - dim.a.x, dim.b.y - dim.a.y);
  return (
    <div>
      <SectionHeader>Dimension</SectionHeader>
      <div className="flex flex-col gap-2">
        <Stat label="Reads" value={fmtIn(len)} />
        <Stat label="Kind" value={dim.kind} />
        <NumberField label="Offset" value={dim.offsetIn} disabled={ro} onCommit={(offsetIn) => ctx.d.apply({ op: "updateDim", id: dim.id, patch: { offsetIn } })} />
      </div>
      <div className="mt-4">
        <DeleteBtn ctx={ctx} id={dim.id} />
      </div>
    </div>
  );
}

// ─── Stairs ──────────────────────────────────────────────────────────────────

export function StairProps({ ctx, stair }: { ctx: DesignerContext; stair: Stair }) {
  const ro = ctx.readOnly;
  const patch = (p: Partial<Omit<Stair, "id">>) => ctx.d.apply({ op: "updateStair", id: stair.id, patch: p });
  const rise = stair.riserCount * stair.riserIn;
  const run = (stair.riserCount - 1) * stair.treadIn;
  const codeHint = stair.riserIn > 7.75 ? "Riser over 7¾\" (IRC max)." : stair.treadIn < 10 ? "Tread under 10\" (IRC min)." : null;
  const levels = ctx.d.doc.levels.map((l) => ({ key: l.id, label: l.name }));
  return (
    <div>
      <SectionHeader>Stairs</SectionHeader>
      <div className="flex flex-col gap-2">
        <Segmented
          label="Shape"
          value={stair.shape}
          disabled={ro}
          options={[
            { key: "straight", label: "Straight" },
            { key: "L", label: "L" },
            { key: "U", label: "U" },
          ]}
          onChange={(shape) => patch({ shape })}
        />
        <Grid>
          <NumberField label="Width" value={stair.widthIn} min={24} max={120} inchesOnly disabled={ro} onCommit={(widthIn) => patch({ widthIn })} />
          <NumberField label="Risers" value={stair.riserCount} raw min={1} max={40} disabled={ro} onCommit={(riserCount) => patch({ riserCount: Math.round(riserCount) })} />
          <NumberField label="Riser" value={stair.riserIn} min={4} max={10} inchesOnly disabled={ro} onCommit={(riserIn) => patch({ riserIn })} />
          <NumberField label="Tread" value={stair.treadIn} min={8} max={16} inchesOnly disabled={ro} onCommit={(treadIn) => patch({ treadIn })} />
        </Grid>
        <SelectField label="To level" value={stair.toLevelId} options={levels} disabled={ro} onChange={(toLevelId) => patch({ toLevelId })} />
        <Segmented label="Phase" value={stair.phase} options={PHASE_OPTIONS} disabled={ro} onChange={(phase) => patch({ phase })} />
        <Stat label="Total rise" value={fmtIn(rise)} />
        <Stat label="Total run" value={fmtIn(run)} />
        <div className={`text-[11.5px] ${codeHint ? "text-flag" : "text-money"}`}>{codeHint ?? "Riser/tread within IRC guidance (7¾\" / 10\")."}</div>
      </div>
      <div className="mt-4">
        <DeleteBtn ctx={ctx} id={stair.id} />
      </div>
    </div>
  );
}

// ─── Structure ───────────────────────────────────────────────────────────────

export function StructureProps({ ctx, el }: { ctx: DesignerContext; el: Structural }) {
  const ro = ctx.readOnly;
  const patch = (p: Partial<Omit<Structural, "id">>) => ctx.d.apply({ op: "updateStructure", id: el.id, patch: p });
  const len = Math.hypot(el.b.x - el.a.x, el.b.y - el.a.y);
  return (
    <div>
      <SectionHeader>Structure</SectionHeader>
      <div className="flex flex-col gap-2">
        <Segmented
          label="Kind"
          value={el.kind}
          disabled={ro}
          options={[
            { key: "column", label: "Column" },
            { key: "beam", label: "Beam" },
            { key: "soffit", label: "Soffit" },
          ]}
          onChange={(kind) => patch({ kind })}
        />
        <TextField label="Label" value={el.label} maxLength={200} disabled={ro} onCommit={(label) => patch({ label })} />
        <Grid cols={3}>
          <NumberField label="Width" value={el.wIn} min={1} max={120} inchesOnly disabled={ro} onCommit={(wIn) => patch({ wIn })} />
          <NumberField label="Height" value={el.hIn} min={1} max={300} inchesOnly disabled={ro} onCommit={(hIn) => patch({ hIn })} />
          <NumberField label="Bottom (z)" value={el.zIn} min={0} max={300} inchesOnly disabled={ro} onCommit={(zIn) => patch({ zIn })} />
        </Grid>
        {el.kind !== "column" && <Stat label="Span" value={fmtIn(len)} />}
        <Segmented label="Phase" value={el.phase} options={PHASE_OPTIONS} disabled={ro} onChange={(phase) => patch({ phase })} />
      </div>
      <div className="mt-4">
        <DeleteBtn ctx={ctx} id={el.id} />
      </div>
    </div>
  );
}

// ─── Camera / Section ────────────────────────────────────────────────────────

export function CameraProps({ ctx, camera }: { ctx: DesignerContext; camera: Camera }) {
  const ro = ctx.readOnly;
  const patch = (p: Partial<Omit<Camera, "id">>) => ctx.d.apply({ op: "updateCamera", id: camera.id, patch: p });
  return (
    <div>
      <SectionHeader>Camera</SectionHeader>
      <div className="flex flex-col gap-2">
        <TextField label="Name" value={camera.name} maxLength={200} disabled={ro} onCommit={(name) => patch({ name })} />
        <Segmented
          label="Mode"
          value={camera.mode}
          disabled={ro}
          options={[
            { key: "orbit", label: "Orbit" },
            { key: "walk", label: "Walk" },
            { key: "plan", label: "Plan" },
          ]}
          onChange={(mode) => patch({ mode })}
        />
        <NumberField label="Field of view °" value={camera.fov} raw min={10} max={120} disabled={ro} onCommit={(fov) => patch({ fov })} />
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className={BTN_GHOST}
          onClick={() => {
            ctx.setView({ mode: ctx.view.mode === "plan" ? "3d" : ctx.view.mode, activeCameraId: camera.id });
            ctx.flyTo(camera.id);
          }}
        >
          <Crosshair className="size-3" strokeWidth={1.75} /> Go to
        </button>
        <DeleteBtn ctx={ctx} id={camera.id} />
      </div>
    </div>
  );
}

export function SectionProps({ ctx, section }: { ctx: DesignerContext; section: SectionLine }) {
  const ro = ctx.readOnly;
  // No updateSection op exists; delete + re-add is the canvas's job. Only the
  // label/depth/flip live here, applied through a replace of the one record.
  const patch = (p: Partial<SectionLine>) => {
    const doc = ctx.d.doc;
    ctx.d.apply({ op: "replace", doc: { ...doc, sections: doc.sections.map((s) => (s.id === section.id ? { ...s, ...p } : s)) } }, { label: "Edit section" });
  };
  return (
    <div>
      <SectionHeader>Section line</SectionHeader>
      <div className="flex flex-col gap-2">
        <TextField label="Label" value={section.label} maxLength={200} disabled={ro} onCommit={(label) => patch({ label })} />
        <NumberField label="Depth" value={section.depthIn} min={0} max={2000} disabled={ro} onCommit={(depthIn) => patch({ depthIn })} />
        <Toggle label="Flip direction" on={section.flip} disabled={ro} onChange={(flip) => patch({ flip })} />
      </div>
      <div className="mt-4">
        <DeleteBtn ctx={ctx} id={section.id} />
      </div>
    </div>
  );
}

// ─── Finish region ───────────────────────────────────────────────────────────

export function FinishRegionProps({ ctx, region }: { ctx: DesignerContext; region: FinishRegion }) {
  const ro = ctx.readOnly;
  const patch = (p: Partial<Omit<FinishRegion, "id">>) => ctx.d.apply({ op: "updateFinishRegion", id: region.id, patch: p });
  const options = region.target === "floor" ? FLOOR_FINISHES : region.target === "ceiling" ? PAINT_FINISHES : WALL_FINISHES;
  const known = options.some((o) => o.key === region.material.key);
  return (
    <div>
      <SectionHeader>{region.target} finish</SectionHeader>
      <div className="flex flex-col gap-2">
        <SelectField
          label="Material"
          value={region.material.key}
          options={known ? options : [{ key: region.material.key, label: region.material.label }, ...options]}
          disabled={ro}
          onChange={(k) => {
            const p = finishPreset(k);
            if (p) patch({ material: { key: p.key, label: p.label, color: p.color, textureKey: p.textureKey, pattern: p.defaultPattern } });
          }}
        />
        {region.target === "wall" && (
          <NumberField label="Height from floor" value={region.heightIn ?? 0} min={0} max={300} disabled={ro} onCommit={(heightIn) => patch({ heightIn })} />
        )}
        {region.material.pattern && <Stat label="Pattern" value={`${region.material.pattern.layout} ${region.material.pattern.tileWIn}×${region.material.pattern.tileHIn}`} />}
      </div>
      <div className="mt-4">
        <DeleteBtn ctx={ctx} id={region.id} />
      </div>
    </div>
  );
}
