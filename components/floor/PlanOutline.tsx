import type { PlanDesignSummary } from "@/lib/plan-designs";

/** A small outline of the saved plan, not a generated sample floor plan. */
export function PlanOutline({ design }: { design: PlanDesignSummary }) {
  const walls = design.outline ?? [];
  const points = walls.flatMap((w) => [w.a, w.b]);
  if (!points.length) return <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md border border-rule-soft bg-paper-2 px-2 text-center text-meta font-normal text-ink-3">No walls yet</div>;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - x), height = Math.max(1, Math.max(...ys) - y);
  const pad = Math.max(width, height) * 0.08;
  return <svg role="img" aria-label={`${design.name} plan outline`} viewBox={`${x - pad} ${y - pad} ${width + pad * 2} ${height + pad * 2}`} className="h-16 w-24 shrink-0 rounded-md border border-rule-soft bg-paper-2 p-1 text-accent-2">
    {walls.map((w, i) => <line key={i} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
  </svg>;
}
