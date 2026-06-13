import type { ReactNode } from "react";
import { Eyebrow } from "./Eyebrow";

type FieldProps = {
  label: string;
  value?: ReactNode;
  className?: string;
};

/** Label + value readout, used on detail pages. */
export function Field({ label, value, className = "" }: FieldProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <Eyebrow muted>{label}</Eyebrow>
      <div className="text-[13px] text-ink">{value ?? <span className="text-ink-4">—</span>}</div>
    </div>
  );
}
