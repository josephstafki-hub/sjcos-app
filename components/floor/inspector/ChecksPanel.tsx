"use client";

// Checks tab: live warnings from lib/plan-checks grouped by kind, each with
// Locate + Ignore, and the per-design ignore list with Restore.

import { useMemo } from "react";
import { Crosshair, EyeOff, RotateCcw } from "lucide-react";
import type { DesignerContext } from "../view-state";
import { runChecks, type Check, type CheckGroup } from "@/lib/plan-checks";
import { Empty, SectionHeader } from "./fields";

const GROUP_ORDER: CheckGroup[] = ["geometry", "clearance", "code", "estimate"];
const GROUP_LABEL: Record<CheckGroup, string> = {
  geometry: "Geometry",
  clearance: "Clearances",
  code: "Code flags (advisory)",
  estimate: "Estimate readiness",
};

export function useChecks(ctx: DesignerContext): Check[] {
  const { doc } = ctx.d;
  const prices = useMemo(() => {
    const m: Record<number, number | null> = {};
    for (const c of ctx.catalog) m[c.id] = c.priceCents;
    return m;
  }, [ctx.catalog]);
  const ruleKeys = useMemo(() => new Set(ctx.costRuleKeys), [ctx.costRuleKeys]);
  return useMemo(() => runChecks(doc, { catalogPrices: prices, costRuleKeys: ruleKeys }), [doc, prices, ruleKeys]);
}

export function ChecksPanel({ ctx }: { ctx: DesignerContext }) {
  const all = useChecks(ctx);
  const ignored = new Set(ctx.d.doc.ignoredChecks);
  const live = all.filter((c) => !ignored.has(c.id));
  const ro = ctx.readOnly;

  const groups = GROUP_ORDER.map((g) => ({ g, checks: live.filter((c) => c.group === g) })).filter((x) => x.checks.length);

  const locate = (c: Check) => {
    ctx.d.select(c.elementIds);
    if (c.levelId && c.levelId !== ctx.d.levelId) ctx.d.setLevelId(c.levelId);
    if (c.anchor) ctx.focus2d({ x: c.anchor.x, y: c.anchor.y, levelId: c.levelId ?? undefined });
    else if (c.elementIds[0]) ctx.focus2d({ id: c.elementIds[0], levelId: c.levelId ?? undefined });
  };

  return (
    <div>
      {live.length === 0 ? (
        <Empty>No open warnings. Nice.</Empty>
      ) : (
        groups.map(({ g, checks }) => (
          <div key={g}>
            <SectionHeader right={<span className="font-mono text-[10px] text-ink-3">{checks.length}</span>}>{GROUP_LABEL[g]}</SectionHeader>
            <div className="flex flex-col gap-1">
              {checks.map((c) => (
                <div key={c.id} className="group flex items-start gap-2 rounded-md border border-rule px-2 py-1.5 text-[12px]">
                  <span className={`mt-1.5 size-1.5 flex-none rounded-full ${c.severity === "warn" ? "bg-flag" : "bg-info"}`} />
                  <span className="min-w-0 flex-1 leading-snug text-ink-2">{c.message}</span>
                  <div className="flex flex-none gap-0.5">
                    <button type="button" title="Locate" onClick={() => locate(c)} className="rounded p-0.5 text-ink-3 hover:text-ink">
                      <Crosshair className="size-3.5" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      title="Ignore on this design"
                      disabled={ro}
                      onClick={() => ctx.d.apply({ op: "ignoreCheck", id: c.id, on: true })}
                      className="rounded p-0.5 text-ink-3 hover:text-ink disabled:opacity-40"
                    >
                      <EyeOff className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {ctx.d.doc.ignoredChecks.length > 0 && (
        <>
          <SectionHeader>Ignored ({ctx.d.doc.ignoredChecks.length})</SectionHeader>
          <div className="flex flex-col gap-1">
            {ctx.d.doc.ignoredChecks.map((id) => {
              const c = all.find((x) => x.id === id);
              return (
                <div key={id} className="flex items-start gap-2 rounded-md border border-dashed border-rule px-2 py-1.5 text-[12px] text-ink-3">
                  <div className="min-w-0 flex-1">
                    <div className="leading-snug">{c?.message ?? "No longer firing"}</div>
                    <div className="truncate font-mono text-[10px] text-ink-4">{id}</div>
                  </div>
                  <button
                    type="button"
                    title="Restore"
                    disabled={ro}
                    onClick={() => ctx.d.apply({ op: "ignoreCheck", id, on: false })}
                    className="rounded p-0.5 text-ink-3 hover:text-ink disabled:opacity-40"
                  >
                    <RotateCcw className="size-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
