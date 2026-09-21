"use client";

// Properties editors for placed items (cabinets, appliances, fixtures…) and
// counters. Split out of PropertiesPanel to keep each file readable.

import { useMemo } from "react";
import { Copy, Trash2, RefreshCw, ArrowLeftRight } from "lucide-react";
import type { DesignerContext } from "../view-state";
import { fmtIn, type Counter, type PlacedItem } from "@/lib/plan-doc";
import { DOOR_STYLES, EDGE_PROFILES, FINISH_PRESETS, LIBRARY, cabinetTag, finishPreset } from "@/lib/plan-library";
import { runExtent } from "@/lib/plan-runs";
import { BTN_DANGER, BTN_GHOST, Grid, NumberField, PHASE_OPTIONS, SectionHeader, Segmented, SelectField, Stat, TextField, Toggle } from "./fields";

const CABINET_KINDS = new Set(["base", "wall", "tall", "vanity", "island"]);
const CAB_FINISHES = FINISH_PRESETS.filter((p) => p.category === "cabinet").map((p) => ({ key: p.key, label: p.label }));
const COUNTER_MATERIALS = FINISH_PRESETS.filter((p) => p.category === "stone" || p.category === "quartz" || p.key === "wood-butcher-block").map((p) => ({
  key: p.key,
  label: p.label,
}));
const FILLER_KEY = LIBRARY.find((l) => l.key === "acc-filler-3")?.key ?? LIBRARY.find((l) => l.key.includes("filler"))?.key ?? null;
const ROT_OPTIONS = [0, 90, 180, 270].map((r) => ({ key: String(r), label: `${r}°` }));

const KIND_LABEL: Record<string, string> = {
  base: "Base cabinet",
  wall: "Wall cabinet",
  tall: "Tall cabinet",
  vanity: "Vanity",
  island: "Island",
  appliance: "Appliance",
  plumbing: "Fixture",
  hvac: "HVAC",
  furniture: "Furniture",
  structure: "Structure",
  generic: "Item",
  counter: "Counter",
  electrical: "Electrical",
  lighting: "Light",
};

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function ItemProps({ ctx, item }: { ctx: DesignerContext; item: PlacedItem }) {
  const ro = ctx.readOnly;
  const isCab = CABINET_KINDS.has(item.kind);
  const patch = (p: Partial<Omit<PlacedItem, "id" | "levelId">>) => ctx.d.apply({ op: "updateItem", id: item.id, patch: p });
  const setProps = (props: Record<string, unknown>) => ctx.d.apply({ op: "setItemProps", ids: [item.id], props });
  const product = item.catalogId != null ? ctx.catalog.find((c) => c.id === item.catalogId) ?? null : null;

  /** Re-derive the callout when size changes unless the user typed their own. */
  const sizePatch = (p: Partial<Pick<PlacedItem, "w" | "d" | "h">>) => {
    const next = { ...item, ...p };
    const autoNow = cabinetTag(item.kind, item.w, item.h, item.props);
    const tag = isCab && (item.tag === autoNow || !item.tag) ? cabinetTag(next.kind, next.w, next.h, next.props) : item.tag;
    patch({ ...p, tag });
  };

  const run = useMemo(() => ctx.d.doc.runs.find((r) => r.itemIds.includes(item.id)) ?? null, [ctx.d.doc.runs, item.id]);
  const extent = useMemo(() => (run ? runExtent(ctx.d.doc, run) : null), [ctx.d.doc, run]);

  const addFiller = (gap: { afterItemId: string; gapIn: number }) => {
    if (!FILLER_KEY || !extent) return;
    const after = ctx.d.doc.items.find((i) => i.id === gap.afterItemId);
    if (!after) return;
    const off = after.w / 2 + gap.gapIn / 2;
    ctx.d.apply(
      {
        op: "placeItem",
        levelId: item.levelId,
        libraryKey: FILLER_KEY,
        at: { x: after.x + extent.axis.x * off, y: after.y + extent.axis.y * off },
        rotDeg: after.rotDeg,
        snapToWall: true,
        phase: item.phase,
        overrides: { w: Math.max(0.5, Math.round(gap.gapIn * 8) / 8), h: after.h, z: after.z },
      },
      { label: "Add filler" },
    );
  };

  const rotKey = String(((Math.round(item.rotDeg) % 360) + 360) % 360);

  return (
    <div>
      <SectionHeader>{KIND_LABEL[item.kind] ?? "Item"}</SectionHeader>
      <div className="flex flex-col gap-2">
        <Grid>
          <TextField label="Label" value={item.label} maxLength={200} disabled={ro} onCommit={(label) => patch({ label })} />
          <TextField label="Tag" value={item.tag} maxLength={16} disabled={ro} onCommit={(tag) => patch({ tag })} />
        </Grid>
        <Grid cols={3}>
          <NumberField label="W" value={item.w} min={0.5} max={600} inchesOnly disabled={ro} onCommit={(w) => sizePatch({ w })} />
          <NumberField label="D" value={item.d} min={0.5} max={600} inchesOnly disabled={ro} onCommit={(d) => sizePatch({ d })} />
          <NumberField label="H" value={item.h} min={0.5} max={300} inchesOnly disabled={ro} onCommit={(h) => sizePatch({ h })} />
        </Grid>
        <Grid>
          <NumberField label="Bottom (z)" value={item.z} min={0} max={300} inchesOnly disabled={ro} onCommit={(z) => patch({ z })} />
          <NumberField label="Rotation °" value={item.rotDeg} raw disabled={ro} onCommit={(rotDeg) => patch({ rotDeg })} />
        </Grid>
        <Segmented value={ROT_OPTIONS.some((o) => o.key === rotKey) ? rotKey : null} options={ROT_OPTIONS} disabled={ro} onChange={(k) => patch({ rotDeg: Number(k) })} />
        <Segmented label="Phase" value={item.phase} options={PHASE_OPTIONS} disabled={ro} onChange={(phase) => ctx.d.apply({ op: "setItemPhase", ids: [item.id], phase })} />
      </div>

      {isCab && (
        <>
          <SectionHeader>Cabinet</SectionHeader>
          <div className="flex flex-col gap-2">
            <Grid>
              <SelectField label="Door style" value={str(item.props.doorStyle, ctx.d.defaults.doorStyle)} options={DOOR_STYLES} disabled={ro} onChange={(doorStyle) => setProps({ doorStyle })} />
              <SelectField
                label="Finish"
                value={str(item.props.finish, ctx.d.defaults.finish)}
                options={CAB_FINISHES}
                disabled={ro}
                onChange={(finish) => setProps({ finish, finishColor: finishPreset(finish)?.color ?? null })}
              />
            </Grid>
            <Grid>
              <Segmented
                label="Hinge"
                value={str(item.props.hinge, "") as "L" | "R" | ""}
                disabled={ro}
                options={[
                  { key: "L", label: "Left" },
                  { key: "R", label: "Right" },
                ]}
                onChange={(hinge) => setProps({ hinge })}
              />
              <NumberField label="Drawers" value={num(item.props.drawers, 0)} raw min={0} max={10} disabled={ro} onCommit={(drawers) => setProps({ drawers })} />
            </Grid>
            <Toggle label="Glass doors" on={item.props.glass === true} disabled={ro} onChange={(glass) => setProps({ glass })} />
            {item.kind === "island" && (
              <SelectField
                label="Seating side"
                value={str(item.props.seating, "")}
                allowEmpty="None"
                options={[
                  { key: "front", label: "Front" },
                  { key: "back", label: "Back" },
                  { key: "left", label: "Left" },
                  { key: "right", label: "Right" },
                ]}
                disabled={ro}
                onChange={(seating) => setProps({ seating: seating || null })}
              />
            )}
          </div>
        </>
      )}

      {item.kind === "appliance" && (
        <>
          <SectionHeader>Appliance</SectionHeader>
          <div className="flex flex-col gap-2">
            <Grid>
              <SelectField
                label="Power"
                value={str(item.props.power, "")}
                allowEmpty="—"
                options={[
                  { key: "120", label: "120V" },
                  { key: "240", label: "240V" },
                  { key: "gas", label: "Gas" },
                ]}
                disabled={ro}
                onChange={(power) => setProps({ power: power || null })}
              />
              <SelectField
                label="Vent"
                value={str(item.props.vent, "")}
                allowEmpty="None"
                options={[
                  { key: "hood", label: "Hood" },
                  { key: "downdraft", label: "Downdraft" },
                  { key: "recirc", label: "Recirculating" },
                  { key: "direct", label: "Direct vent" },
                ]}
                disabled={ro}
                onChange={(vent) => setProps({ vent: vent || null })}
              />
            </Grid>
          </div>
        </>
      )}

      {(item.kind === "plumbing" || item.kind === "hvac" || item.kind === "appliance") && (
        <div className="mt-2">
          <TextField label="Notes" value={str(item.props.notes)} multiline maxLength={500} disabled={ro} onCommit={(notes) => setProps({ notes })} />
        </div>
      )}

      <SectionHeader
        right={
          <button type="button" className="text-[11px] text-accent-2 hover:underline" onClick={() => ctx.setView({ panel: "catalog" })}>
            <ArrowLeftRight className="mr-0.5 inline size-3" strokeWidth={1.75} />
            {product ? "Change product" : "Pick product"}
          </button>
        }
      >
        Product
      </SectionHeader>
      {product ? (
        <div className="rounded-md border border-rule px-2.5 py-2 text-[12px]">
          <div className="font-medium text-ink">{product.name}</div>
          <div className="mt-0.5 flex justify-between font-mono text-[11px] text-ink-3">
            <span>{product.sku || product.supplier || "—"}</span>
            <span>{product.price || "no price"}</span>
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-ink-3">{item.libraryKey ? `Generic (${item.libraryKey})` : "No product linked — allowance."}</div>
      )}

      {extent && run && extent.items.length > 0 && (
        <>
          <SectionHeader>Run · {run.tier}</SectionHeader>
          <div className="flex flex-col gap-1">
            <Stat label="Length" value={`${fmtIn(extent.lengthIn)} · ${extent.lengthLf.toFixed(1)} lf`} />
            <Stat label="Cabinets" value={extent.items.length} />
            {extent.gaps.length === 0 ? (
              <Stat label="Gaps" value="none" />
            ) : (
              extent.gaps.map((g) => (
                <div key={g.afterItemId} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-ink-3">
                    Gap {fmtIn(g.gapIn, { inchesOnly: true })} at {fmtIn(g.atIn)}
                  </span>
                  {FILLER_KEY && (
                    <button type="button" className={BTN_GHOST} disabled={ro} onClick={() => addFiller(g)}>
                      Add filler
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={BTN_GHOST} disabled={ro} onClick={() => ctx.d.apply({ op: "duplicateItems", ids: [item.id], dx: item.w, dy: 0 })}>
          <Copy className="size-3" strokeWidth={1.75} /> Duplicate
        </button>
        <button type="button" className={BTN_DANGER} disabled={ro} onClick={() => ctx.d.apply({ op: "delete", ids: [item.id] })}>
          <Trash2 className="size-3" strokeWidth={1.75} /> Delete
        </button>
      </div>
    </div>
  );
}

// ─── Counter ─────────────────────────────────────────────────────────────────

export function CounterProps({ ctx, counter }: { ctx: DesignerContext; counter: Counter }) {
  const ro = ctx.readOnly;
  const patch = (p: Partial<Omit<Counter, "id" | "levelId">>) => ctx.d.apply({ op: "updateCounter", id: counter.id, patch: p });
  const setOverhang = (side: keyof Counter["overhang"], v: number) => patch({ overhang: { ...counter.overhang, [side]: v } });
  const toggleWaterfall = (side: "left" | "right", on: boolean) =>
    patch({ waterfall: on ? [...new Set([...counter.waterfall, side])] : counter.waterfall.filter((s) => s !== side) });
  const matOptions = COUNTER_MATERIALS.some((m) => m.key === counter.material.key)
    ? COUNTER_MATERIALS
    : [{ key: counter.material.key, label: counter.material.label }, ...COUNTER_MATERIALS];
  return (
    <div>
      <SectionHeader>Counter</SectionHeader>
      <div className="flex flex-col gap-2">
        <SelectField
          label="Material"
          value={counter.material.key}
          options={matOptions}
          disabled={ro}
          onChange={(k) => {
            const p = finishPreset(k);
            if (p) patch({ material: { key: p.key, label: p.label, color: p.color, textureKey: p.textureKey } });
          }}
        />
        <Grid cols={3}>
          <NumberField label="Thick" value={counter.thickIn} min={0.25} max={6} inchesOnly disabled={ro} onCommit={(thickIn) => patch({ thickIn })} />
          <SelectField label="Edge" value={counter.edge} options={EDGE_PROFILES} disabled={ro} onChange={(edge) => patch({ edge })} />
          <NumberField label="Backsplash" value={counter.backsplashIn} min={0} max={60} inchesOnly disabled={ro} onCommit={(backsplashIn) => patch({ backsplashIn })} />
        </Grid>
        <SectionHeader>Overhang</SectionHeader>
        <Grid cols={4}>
          <NumberField label="Front" value={counter.overhang.front} min={0} max={24} inchesOnly disabled={ro} onCommit={(v) => setOverhang("front", v)} />
          <NumberField label="Back" value={counter.overhang.back} min={0} max={24} inchesOnly disabled={ro} onCommit={(v) => setOverhang("back", v)} />
          <NumberField label="Left" value={counter.overhang.left} min={0} max={24} inchesOnly disabled={ro} onCommit={(v) => setOverhang("left", v)} />
          <NumberField label="Right" value={counter.overhang.right} min={0} max={24} inchesOnly disabled={ro} onCommit={(v) => setOverhang("right", v)} />
        </Grid>
        <Grid>
          <Toggle label="Waterfall left" on={counter.waterfall.includes("left")} disabled={ro} onChange={(on) => toggleWaterfall("left", on)} />
          <Toggle label="Waterfall right" on={counter.waterfall.includes("right")} disabled={ro} onChange={(on) => toggleWaterfall("right", on)} />
        </Grid>
        <Stat label="Seams" value={counter.seams.length} />
        <Stat label="Source" value={counter.runId ? "generated from run" : "drawn"} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={BTN_GHOST}
          disabled={ro}
          onClick={() => ctx.d.apply({ op: "regenerateCounters", levelId: counter.levelId, material: counter.material })}
        >
          <RefreshCw className="size-3" strokeWidth={1.75} /> Regenerate from runs
        </button>
        <button type="button" className={BTN_DANGER} disabled={ro} onClick={() => ctx.d.apply({ op: "delete", ids: [counter.id] })}>
          <Trash2 className="size-3" strokeWidth={1.75} /> Delete
        </button>
      </div>
    </div>
  );
}
