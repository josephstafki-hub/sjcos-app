"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, Chip } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import { MEASURE_DEFS } from "@/lib/plan-measures";
import type { PlanCostRule } from "@/lib/plan-designs";
import { setPlanCostRule, setPlanCostRuleEnabled } from "@/lib/actions/plan-estimate";

interface CostItemLite {
  id: number;
  name: string;
  unit: string;
  category: string;
}

/** Cost book → "Plan rules": which cost-book item each floor-plan measure
 *  turns into when an estimate is generated from a design. One row per
 *  measure (blank material tag = default); extra rows can pin a material
 *  tag (e.g. floor_sf for "floor-white-oak") to a different item. */
export function PlanRulesPanel({ rules, costItems }: { rules: PlanCostRule[]; costItems: CostItemLite[] }) {
  const [pending, start] = useTransition();
  const [tagDraft, setTagDraft] = useState<{ measure: string; tag: string } | null>(null);
  const [group, setGroup] = useState("All");

  const groups = useMemo(() => ["All", ...new Set(MEASURE_DEFS.map((m) => m.group))], []);
  const byMeasure = useMemo(() => {
    const m = new Map<string, PlanCostRule[]>();
    for (const r of rules) m.set(r.measure, [...(m.get(r.measure) ?? []), r]);
    return m;
  }, [rules]);
  const mapped = MEASURE_DEFS.filter((m) => (byMeasure.get(m.key) ?? []).some((r) => r.enabled)).length;

  const set = (measure: string, tag: string, costItemId: number | null) =>
    start(async () => {
      await runAction(() => setPlanCostRule(measure, tag, costItemId));
    });

  const itemsFor = (unit: string) => costItems.filter((c) => c.unit === unit).concat(costItems.filter((c) => c.unit !== unit));

  return (
    <div className="mt-10">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <div className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">Floor-plan designer</div>
          <h2 className="mt-1 font-serif text-[22px] font-medium leading-none text-accent-2">Plan rules</h2>
          <p className="mt-1.5 max-w-[640px] text-[12px] leading-relaxed text-ink-3">
            When an estimate is generated from a design, each measured quantity (demo wall LF, floor SF, base cabinet LF…)
            becomes a line priced by the cost-book item chosen here. Unmapped measures come back as a checklist instead of
            silently dropping.
          </p>
        </div>
        <Chip kind={mapped === MEASURE_DEFS.length ? "money" : "ghost"} dot>
          {mapped} / {MEASURE_DEFS.length} mapped
        </Chip>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {groups.map((g) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            className={[
              "rounded-full border px-2.5 py-0.5 text-[11px] capitalize",
              g === group ? "border-ink bg-ink text-paper" : "border-rule bg-card text-ink-2 hover:bg-paper-2",
            ].join(" ")}
          >
            {g}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-[12px]">
          <thead className="bg-paper-2 text-left font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
            <tr>
              <th className="px-3 py-2">Measure</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Material tag</th>
              <th className="px-3 py-2">Cost-book item</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {MEASURE_DEFS.filter((m) => group === "All" || m.group === group).map((m) => {
              const rows = byMeasure.get(m.key) ?? [];
              const base = rows.find((r) => r.materialTag === "");
              const extras = rows.filter((r) => r.materialTag !== "");
              const drafting = tagDraft?.measure === m.key;
              return (
                <RuleRows
                  key={m.key}
                  measure={m}
                  base={base ?? null}
                  extras={extras}
                  items={itemsFor(m.unit)}
                  drafting={drafting}
                  draftTag={drafting ? tagDraft!.tag : ""}
                  onDraftTag={(tag) => setTagDraft({ measure: m.key, tag })}
                  onCancelDraft={() => setTagDraft(null)}
                  pending={pending}
                  onSet={(tag, id) => {
                    set(m.key, tag, id);
                    if (tag) setTagDraft(null);
                  }}
                  onToggle={(id, on) =>
                    start(async () => {
                      await runAction(() => setPlanCostRuleEnabled(id, on));
                    })
                  }
                />
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function RuleRows({
  measure,
  base,
  extras,
  items,
  drafting,
  draftTag,
  onDraftTag,
  onCancelDraft,
  pending,
  onSet,
  onToggle,
}: {
  measure: (typeof MEASURE_DEFS)[number];
  base: PlanCostRule | null;
  extras: PlanCostRule[];
  items: CostItemLite[];
  drafting: boolean;
  draftTag: string;
  onDraftTag: (tag: string) => void;
  onCancelDraft: () => void;
  pending: boolean;
  onSet: (tag: string, costItemId: number | null) => void;
  onToggle: (id: number, on: boolean) => void;
}) {
  const select = (value: number | null, tag: string) => (
    <select
      value={value ?? ""}
      disabled={pending}
      onChange={(e) => onSet(tag, e.target.value ? Number(e.target.value) : null)}
      className="w-full max-w-[320px] rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
    >
      <option value="">— not mapped —</option>
      {items.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} ({c.unit})
        </option>
      ))}
    </select>
  );
  return (
    <>
      <tr className="border-t border-rule-soft">
        <td className="px-3 py-1.5">
          <div className="font-medium text-ink">{measure.label}</div>
          <div className="font-mono text-[10px] text-ink-4">{measure.key}</div>
        </td>
        <td className="px-3 py-1.5 font-mono text-[11px] uppercase text-ink-3">{measure.unit}</td>
        <td className="px-3 py-1.5 text-ink-4">default</td>
        <td className="px-3 py-1.5">{select(base?.costItemId ?? null, "")}</td>
        <td className="px-3 py-1.5 text-right">
          {!drafting && (
            <button onClick={() => onDraftTag("")} className="text-[11px] text-ink-3 hover:text-ink">
              + by material
            </button>
          )}
        </td>
      </tr>
      {extras.map((r) => (
        <tr key={r.id} className="border-t border-rule-soft bg-paper-2/60">
          <td className="px-3 py-1.5 pl-7 text-ink-3">↳ {measure.label}</td>
          <td className="px-3 py-1.5 font-mono text-[11px] uppercase text-ink-3">{measure.unit}</td>
          <td className="px-3 py-1.5 font-mono text-[11px] text-ink-2">{r.materialTag}</td>
          <td className="px-3 py-1.5">{select(r.costItemId, r.materialTag)}</td>
          <td className="px-3 py-1.5 text-right">
            <label className="inline-flex items-center gap-1 text-[11px] text-ink-3">
              <input type="checkbox" checked={r.enabled} disabled={pending} onChange={(e) => onToggle(r.id, e.target.checked)} />
              on
            </label>
          </td>
        </tr>
      ))}
      {drafting && (
        <tr className="border-t border-rule-soft bg-accent-soft/40">
          <td className="px-3 py-1.5 pl-7 text-ink-3">↳ {measure.label}</td>
          <td className="px-3 py-1.5 font-mono text-[11px] uppercase text-ink-3">{measure.unit}</td>
          <td className="px-3 py-1.5">
            <input
              autoFocus
              value={draftTag}
              onChange={(e) => onDraftTag(e.target.value)}
              placeholder="e.g. floor-white-oak"
              className="w-full rounded-md border border-rule bg-paper px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-accent"
            />
          </td>
          <td className="px-3 py-1.5">{draftTag ? select(null, draftTag) : <span className="text-[11px] text-ink-4">type a tag first</span>}</td>
          <td className="px-3 py-1.5 text-right">
            <button onClick={onCancelDraft} className="text-[11px] text-ink-3 hover:text-ink">
              cancel
            </button>
          </td>
        </tr>
      )}
    </>
  );
}
