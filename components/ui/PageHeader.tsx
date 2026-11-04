import type { ReactNode } from "react";
import { Eyebrow } from "./Eyebrow";

export type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Record headers use the smaller title scale. */
  variant?: "index" | "record";
  badge?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  filters?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, variant = "index", badge, meta, actions, tabs, filters, className = "" }: PageHeaderProps) {
  return (
    <header className={`${tabs ? "border-b border-rule" : ""} ${className}`}>
      <div className="flex flex-col items-start justify-between gap-4 @3xl/page:flex-row">
        <div className="min-w-0 flex-1">
          {eyebrow && <Eyebrow className="mb-1">{eyebrow}</Eyebrow>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 max-sm:flex-col max-sm:items-start">
            <h1 className={`min-w-0 break-words font-serif font-medium text-ink ${variant === "record" ? "text-title max-sm:text-[22px] max-sm:leading-7" : "text-display max-sm:text-[26px] max-sm:leading-8"}`}>{title}</h1>
            {badge}
          </div>
          {meta && <div className="mt-1 text-meta text-ink-3">{meta}</div>}
        </div>
        {actions && <div className="flex max-w-full flex-none flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-5">{tabs}</div>}
      {filters && <div className="mt-5 flex flex-wrap items-center gap-3">{filters}</div>}
    </header>
  );
}
