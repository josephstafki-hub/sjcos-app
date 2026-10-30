"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Button,
  Segmented,
  Card,
  Chip,
  TableWrapper,
  Table,
  TableHead,
  TableHeader,
  TableBody,
} from "@/components/ui";
import { runAction } from "@/lib/run-action";
import { MEASURE_DEFS } from "@/lib/plan-measures";
import type { PlanCostRule } from "@/lib/plan-designs";
import {
  setPlanCostRule,
  setPlanCostRuleEnabled,
} from "@/lib/actions/plan-estimate";

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
export function PlanRulesPanel({
  rules,
  costItems,
}: {
  rules: PlanCostRule[];
  costItems: CostItemLite[];
}) {
  const [pending, start] = useTransition();
  const [tagDraft, setTagDraft] = useState<{
    measure: string;
    tag: string;
  } | null>(null);
  const [feedback,setFeedback] = useState("");
  const [group, setGroup] = useState("All");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string[]>([]);
  const isMapped = (key: string) => (byMeasure.get(key) ?? []).some(r => r.enabled && r.costItemId != null);

  const groups = useMemo(
    () => ["All", ...new Set(MEASURE_DEFS.map((m) => m.group))],
    [],
  );
  const byMeasure = useMemo(() => {
    const m = new Map<string, PlanCostRule[]>();
    for (const r of rules) m.set(r.measure, [...(m.get(r.measure) ?? []), r]);
    return m;
  }, [rules]);
  const mapped = MEASURE_DEFS.filter((m) =>
    isMapped(m.key),
  ).length;

  const set = (measure: string, tag: string, costItemId: number | null) =>
    start(async () => {
      await runAction(() => setPlanCostRule(measure, tag, costItemId),{onSuccess:()=>setFeedback("Saved"),onError:setFeedback});
    });

  const itemsFor = (unit: string) =>
    costItems
      .filter((c) => c.unit === unit)
      .concat(costItems.filter((c) => c.unit !== unit));

  return (
    <div className="mt-10">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <div className="text-label font-medium text-ink-3">
            Floor-plan designer
          </div>
          <h2 className="mt-1 font-serif text-title font-medium leading-none text-accent-2">
            Plan rules
          </h2>
          <p className="mt-1.5 max-w-[640px] text-label leading-relaxed text-ink-3">
            When an estimate is generated from a design, each measured quantity
            (demo wall LF, floor SF, base cabinet LF…) becomes a line priced by
            the cost-book item chosen here. Unmapped measures come back as a
            checklist instead of silently dropping.
          </p>
        </div>
        <Chip kind={mapped === MEASURE_DEFS.length ? "money" : "ghost"} dot>
          {mapped} / {MEASURE_DEFS.length} mapped
        </Chip>
      </div>

      <label className="mb-3 flex items-center gap-2 text-label text-ink-3">
        Measure group
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className="h-9 rounded-md border border-rule bg-card px-2 text-body text-ink"
        >
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </label>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented aria-label="Mapping status" value={filter} onChange={setFilter} options={[{value:"all",label:"All",count:MEASURE_DEFS.length},{value:"mapped",label:"Mapped",count:mapped},{value:"unmapped",label:"Unmapped",count:MEASURE_DEFS.length-mapped}]} />
        <Button variant="secondary" size="sm" disabled={mapped === MEASURE_DEFS.length} onClick={() => {
          const next = MEASURE_DEFS.find(m => !isMapped(m.key));
          if (!next) return;
          setFilter("unmapped");setGroup("All");setExpanded(e => [...new Set([...e,next.group])]);
          requestAnimationFrame(() => {const field = document.getElementById(`rule-${next.key}`);field?.scrollIntoView({block:"center",behavior:"smooth"});field?.focus();});
        }}>Map next unmapped</Button>
      </div>
      <p role="status" className="mb-3 text-meta text-ink-2">{pending ? "Saving…" : feedback}</p>
      {groups.filter(g => g !== "All" && (group === "All" || group === g)).map(g => {
        const measures = MEASURE_DEFS.filter(m => m.group === g && (filter === "all" || (filter === "mapped" ? isMapped(m.key) : !isMapped(m.key))));
        if (!measures.length) return null;
        const groupMapped = MEASURE_DEFS.filter(m => m.group === g && isMapped(m.key)).length;
        return <details key={g} open={expanded.includes(g)} onToggle={e => {const open=e.currentTarget.open;setExpanded(old => open ? [...new Set([...old,g])] : old.filter(v => v !== g));}} className="mb-3 rounded-lg border border-rule-soft">
        <summary className="cursor-pointer px-3 py-3 text-subheading font-semibold">{g} <span className="ml-2 text-meta font-normal text-ink-3">{groupMapped} mapped · {MEASURE_DEFS.filter(m => m.group === g).length-groupMapped} unmapped</span></summary>
      <TableWrapper>
        <Table density="compact">
          <TableHead>
            <tr>
              <TableHeader>Measure</TableHeader>
              <TableHeader className="@max-3xl/page:hidden">Unit</TableHeader>
              <TableHeader className="@max-2xl/page:hidden">
                Material tag
              </TableHeader>
              <TableHeader>Cost-book item</TableHeader>
              <TableHeader>
                <span className="sr-only">Actions</span>
              </TableHeader>
            </tr>
          </TableHead>
          <TableBody>
            {measures.map((m) => {
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
                      await runAction(() => setPlanCostRuleEnabled(id, on),{onSuccess:()=>setFeedback("Saved"),onError:setFeedback});
                    })
                  }
                />
              );
            })}
          </TableBody>
        </Table>
      </TableWrapper></details>;})}
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
      id={tag === "" ? `rule-${measure.key}` : undefined}
      aria-label={`${measure.label} ${tag || "default"} cost-book item`}
      value={value ?? ""}
      disabled={pending}
      onChange={(e) =>
        onSet(tag, e.target.value ? Number(e.target.value) : null)
      }
      className="w-full max-w-80 rounded-md border border-transparent bg-transparent hover:border-rule hover:bg-card px-2 py-1 text-label text-ink outline-none focus:border-accent"
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
          <div className="text-meta text-ink-3 @3xl/page:hidden">
            {measure.unit}
          </div>
        </td>
        <td className="px-3 py-1.5 text-meta text-ink-3 @max-3xl/page:hidden">
          {measure.unit}
        </td>
        <td className="px-3 py-1.5 text-ink-3 @max-2xl/page:hidden">default</td>
        <td className="px-3 py-1.5">{select(base?.costItemId ?? null, "")}</td>
        <td className="px-3 py-1.5 text-right">
          {!drafting && (
            <button
              aria-label={`Add a material rule for ${measure.label}`}
              onClick={() => onDraftTag("")}
              className="text-meta text-ink-3 hover:text-ink"
            >
              <span className="@max-xl/page:hidden">+ by material</span>
              <span className="@xl/page:hidden">+</span>
            </button>
          )}
        </td>
      </tr>
      {extras.map((r) => (
        <tr key={r.id} className="border-t border-rule-soft bg-paper-2/60">
          <td className="px-3 py-1.5 pl-7 text-ink-3">↳ {measure.label}</td>
          <td className="px-3 py-1.5 text-meta text-ink-3 @max-3xl/page:hidden">
            {measure.unit}
          </td>
          <td className="px-3 py-1.5 text-meta text-ink-2 @max-2xl/page:hidden">
            {r.materialTag}
          </td>
          <td className="px-3 py-1.5">{select(r.costItemId, r.materialTag)}</td>
          <td className="px-3 py-1.5 text-right">
            <label className="inline-flex items-center gap-1 text-meta text-ink-3">
              <input
                type="checkbox"
                checked={r.enabled}
                disabled={pending}
                onChange={(e) => onToggle(r.id, e.target.checked)}
              />
              on
            </label>
          </td>
        </tr>
      ))}
      {drafting && (
        <tr className="border-t border-rule-soft bg-accent-soft/40">
          <td className="px-3 py-1.5 pl-7 text-ink-3">↳ {measure.label}</td>
          <td className="px-3 py-1.5 text-meta text-ink-3 @max-3xl/page:hidden">
            {measure.unit}
          </td>
          <td className="px-3 py-1.5">
            <input
              autoFocus
              value={draftTag}
              onChange={(e) => onDraftTag(e.target.value)}
              placeholder="e.g. floor-white-oak"
              className="w-full rounded-md border border-rule bg-paper px-2 py-1 text-meta text-ink outline-none focus:border-accent"
            />
          </td>
          <td className="px-3 py-1.5">
            {draftTag ? (
              select(null, draftTag)
            ) : (
              <span className="text-meta text-ink-4">type a tag first</span>
            )}
          </td>
          <td className="px-3 py-1.5 text-right">
            <button
              onClick={onCancelDraft}
              className="text-meta text-ink-3 hover:text-ink"
            >
              cancel
            </button>
          </td>
        </tr>
      )}
    </>
  );
}
