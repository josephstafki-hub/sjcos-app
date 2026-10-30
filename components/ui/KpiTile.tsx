import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Card } from "./Card";

export type KpiTileProps = {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  hint?: string;
  tone?: "default" | "ok" | "money" | "warn" | "flag";
  className?: string;
};
const TONES = { default: "text-ink", ok: "text-ok", money: "text-money", warn: "text-warn", flag: "text-flag" };

/** Use up to four in grid-cols-2 @3xl/page:grid-cols-4 gap-3. Only the value carries status color. */
export function KpiTile({ label, value, meta, hint, tone = "default", className = "" }: KpiTileProps) {
  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex items-center gap-1.5 text-label font-medium text-ink-3">
        {label}
        {hint && <span tabIndex={0} aria-label={hint} title={hint} className="rounded focus-visible:outline-2 focus-visible:outline-focus"><Info aria-hidden className="size-3.5" strokeWidth={1.75} /></span>}
      </div>
      <div className={`mt-1 font-serif text-kpi font-medium tabular-nums ${TONES[tone]}`}>{value}</div>
      {meta && <div className="mt-0.5 text-meta text-ink-3">{meta}</div>}
    </Card>
  );
}
