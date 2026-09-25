"use client";

// Cabinet look editor: construction (face frame / frameless / inset), door
// and drawer profile, finish (presets or any colour), hardware type / finish
// / size, toe, crown, light rail, glass. Works on one cabinet or a
// multi-selection; "apply to run / all" and "use for new cabinets" copy the
// style keys (lib/plan-cabinet CAB_STYLE_KEYS). Everything is a PlanOp.

import { useMemo } from "react";
import type { PlacedItem } from "@/lib/plan-doc";
import {
  CAB_CONSTRUCTIONS,
  CAB_DOOR_STYLES,
  CAB_FINISH_PRESETS,
  CAB_HARDWARE,
  CAB_TOES,
  CABINET_STYLE_KINDS,
  HARDWARE_FINISHES,
  PULL_SIZES,
  cabinetStyle,
  pickCabinetStyle,
  type CabDoorStyle,
  type CabinetStyle,
} from "@/lib/plan-cabinet";
import type { DesignerContext } from "../view-state";
import { BTN_GHOST, LABEL_CLS, SectionHeader, Segmented, SwatchGrid, Toggle } from "./fields";

type Key = keyof CabinetStyle;

/** The value all `styles` share for `k`, or null when they differ. */
function common<K extends Key>(styles: CabinetStyle[], k: K): CabinetStyle[K] | null {
  const v = styles[0]?.[k];
  return styles.every((s) => s[k] === v) ? v : null;
}

export function CabinetStyleEditor({ ctx, items }: { ctx: DesignerContext; items: PlacedItem[] }) {
  const ro = ctx.readOnly;
  const { doc } = ctx.d;
  const styles = useMemo(() => items.map((i) => cabinetStyle(i, doc)), [items, doc]);
  const ids = items.map((i) => i.id);
  const set = (props: Record<string, unknown>, label = "Cabinet style") => ctx.d.apply({ op: "setItemProps", ids, props }, { label });
  const kinds = new Set(items.map((i) => i.kind));
  const hasFloor = [...kinds].some((k) => k !== "wall");
  const hasUpper = kinds.has("wall") || kinds.has("tall");

  const allCabinets = doc.items.filter((i) => CABINET_STYLE_KINDS.has(i.kind));
  const run = items.length === 1 ? doc.runs.find((r) => r.itemIds.includes(items[0].id)) : null;
  const styleOf = () => pickCabinetStyle(items[0].props);
  const designStyle = doc.settings.cabinetStyle ?? {};
  const matchesDesign = Object.entries(styleOf()).every(([k, v]) => designStyle[k] === v) && Object.keys(designStyle).length > 0;

  const hardware = common(styles, "hardware");
  const finish = common(styles, "finish");
  const color = common(styles, "color");

  return (
    <div>
      <SectionHeader>Cabinet style{items.length > 1 ? ` · ${items.length} cabinets` : ""}</SectionHeader>
      <div className="flex flex-col gap-2.5">
        <Segmented
          label="Construction"
          value={common(styles, "construction")}
          disabled={ro}
          options={CAB_CONSTRUCTIONS.map((c) => ({ key: c.key, label: c.label, title: c.hint }))}
          onChange={(construction) => set({ construction })}
        />

        <div>
          <div className={`mb-1 ${LABEL_CLS}`}>Door style</div>
          <div className="grid grid-cols-3 gap-1.5">
            {CAB_DOOR_STYLES.map((d) => {
              const active = common(styles, "doorStyle") === d.key;
              return (
                <button
                  key={d.key}
                  type="button"
                  disabled={ro}
                  onClick={() => set({ doorStyle: d.key, ...(d.key === "glass" ? { glass: true } : common(styles, "doorStyle") === "glass" ? { glass: false } : {}) })}
                  className={`flex flex-col items-center gap-1 rounded-md border p-1.5 text-[10.5px] disabled:opacity-50 ${
                    active ? "border-ink bg-paper-2 text-ink" : "border-rule text-ink-2 hover:bg-paper-2"
                  }`}
                >
                  <DoorThumb style={d.key} color={color ?? "#f2f1ec"} />
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <Segmented
          label="Drawer fronts"
          value={common(styles, "drawerStyle")}
          disabled={ro}
          options={[
            { key: "match", label: "Match doors" },
            { key: "slab", label: "Slab" },
          ]}
          onChange={(drawerStyle) => set({ drawerStyle })}
        />

        <div>
          <div className={`mb-1 flex items-center justify-between ${LABEL_CLS}`}>
            <span>Finish</span>
            <label className="flex cursor-pointer items-center gap-1 normal-case tracking-normal text-ink-3 hover:text-ink">
              <span
                className={`inline-block size-4 rounded border ${finish === "custom" ? "border-ink ring-1 ring-ink" : "border-rule"}`}
                style={{ backgroundColor: finish === "custom" && color ? color : "#ffffff" }}
              />
              <span className="font-sans text-[11px]">Custom colour</span>
              <input
                type="color"
                disabled={ro}
                className="sr-only"
                value={color ?? "#f2f1ec"}
                onChange={(e) => set({ finish: "custom", finishColor: e.target.value }, "Cabinet colour")}
              />
            </label>
          </div>
          <SwatchGrid
            size="sm"
            swatches={CAB_FINISH_PRESETS.map((p) => ({ key: p.key, label: p.label.replace(/^Painted (.+) cabinet$/, (_, c: string) => `${c[0].toUpperCase()}${c.slice(1)} paint`), color: p.color }))}
            value={finish}
            disabled={ro}
            onPick={(s) => set({ finish: s.key, finishColor: s.color }, "Cabinet finish")}
          />
        </div>

        <div>
          <div className={`mb-1 ${LABEL_CLS}`}>Hardware</div>
          <select
            value={hardware ?? ""}
            disabled={ro}
            onChange={(e) => set({ hardware: e.target.value }, "Cabinet hardware")}
            className="w-full rounded-md border border-rule bg-paper px-2 py-1 text-[12.5px] text-ink"
          >
            {hardware == null && <option value="">Mixed</option>}
            {CAB_HARDWARE.map((h) => (
              <option key={h.key} value={h.key}>
                {h.label}
              </option>
            ))}
          </select>
          {hardware !== "none" && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {HARDWARE_FINISHES.map((f) => {
                const active = common(styles, "hardwareFinish") === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    title={f.label}
                    disabled={ro}
                    onClick={() => set({ hardwareFinish: f.key }, "Hardware finish")}
                    className={`size-6 rounded-full border disabled:opacity-50 ${active ? "border-ink ring-2 ring-ink ring-offset-1" : "border-rule"}`}
                    style={{ background: `radial-gradient(circle at 35% 30%, #ffffff99, ${f.color} 55%)` }}
                  />
                );
              })}
              <span className="text-[11px] text-ink-3">{HARDWARE_FINISHES.find((f) => f.key === common(styles, "hardwareFinish"))?.label ?? "Mixed"}</span>
            </div>
          )}
          {hardware === "bar" && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-2">
              Pull size
              <select
                value={String(common(styles, "pullIn") ?? "")}
                disabled={ro}
                onChange={(e) => set({ pullIn: Number(e.target.value) }, "Pull size")}
                className="rounded border border-rule bg-paper px-1 py-0.5 text-[11.5px]"
              >
                {common(styles, "pullIn") == null && <option value="">Mixed</option>}
                {PULL_SIZES.map((n) => (
                  <option key={n} value={String(n)}>
                    {n}&quot;
                  </option>
                ))}
              </select>
              <span className="text-ink-4">centre to centre</span>
            </div>
          )}
        </div>

        {hasFloor && (
          <Segmented label="Base" value={common(styles, "toe")} disabled={ro} options={CAB_TOES.map((t) => ({ key: t.key, label: t.label }))} onChange={(toe) => set({ toe })} />
        )}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          <Toggle label="Glass doors" on={common(styles, "glass") === true} disabled={ro} onChange={(glass) => set({ glass })} />
          {hasUpper && <Toggle label="Crown moulding" on={common(styles, "crown") === true} disabled={ro} onChange={(crown) => set({ crown })} />}
          {kinds.has("wall") && <Toggle label="Light rail" on={common(styles, "lightRail") === true} disabled={ro} onChange={(lightRail) => set({ lightRail })} />}
        </div>

        {!ro && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {run && run.itemIds.length > 1 && (
              <button type="button" className={BTN_GHOST} onClick={() => ctx.d.apply({ op: "setItemProps", ids: run.itemIds, props: styleOf() }, { label: "Style run" })}>
                Apply to this run
              </button>
            )}
            {allCabinets.length > items.length && (
              <button
                type="button"
                className={BTN_GHOST}
                title="Every cabinet in the design, and new ones you place"
                onClick={() =>
                  ctx.d.apply(
                    [
                      { op: "setItemProps", ids: allCabinets.map((i) => i.id), props: styleOf() },
                      { op: "setSettings", patch: { cabinetStyle: styleOf() as Record<string, string | number | boolean | null> } },
                    ],
                    { label: "Style all cabinets" },
                  )
                }
              >
                Apply to all {allCabinets.length} cabinets
              </button>
            )}
            <button
              type="button"
              className={BTN_GHOST}
              disabled={matchesDesign}
              title="New cabinets you place start with this style"
              onClick={() => ctx.d.apply({ op: "setSettings", patch: { cabinetStyle: styleOf() as Record<string, string | number | boolean | null> } }, { label: "Default cabinet style" })}
            >
              {matchesDesign ? "Default for new cabinets ✓" : "Use for new cabinets"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Tiny front-elevation sketch of a door profile for the picker. */
function DoorThumb({ style, color }: { style: CabDoorStyle; color: string }) {
  const W = 26;
  const H = 34;
  const f = style === "slab" ? 0 : style === "slimShaker" ? 2.5 : 4.5;
  const stroke = "var(--ink-3)";
  return (
    <svg width={W + 2} height={H + 2} viewBox={`-1 -1 ${W + 2} ${H + 2}`} aria-hidden>
      <rect x={0} y={0} width={W} height={H} fill={color} stroke={stroke} strokeWidth={0.8} />
      {f > 0 && <rect x={f} y={f} width={W - 2 * f} height={H - 2 * f} fill={style === "glass" ? "#cfe3ee" : "none"} stroke={stroke} strokeWidth={0.6} />}
      {style === "raised" && <rect x={f + 3} y={f + 3} width={W - 2 * f - 6} height={H - 2 * f - 6} fill="none" stroke={stroke} strokeWidth={0.6} />}
      {style === "beaded" &&
        [0, 1, 2, 3].map((k) => <line key={k} x1={f + 3 + k * 3.5} y1={f} x2={f + 3 + k * 3.5} y2={H - f} stroke={stroke} strokeWidth={0.4} />)}
      {style === "glass" && <line x1={f + 3} y1={f + 10} x2={f + 9} y2={f + 4} stroke="#ffffff" strokeWidth={1} />}
      <line x1={W - 3.5} y1={H * 0.2} x2={W - 3.5} y2={H * 0.2 + 7} stroke="var(--ink)" strokeWidth={1.2} strokeLinecap="round" />
    </svg>
  );
}
