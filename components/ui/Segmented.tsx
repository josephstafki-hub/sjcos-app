"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type SegmentedOption = {
  value: string;
  label: ReactNode;
  count?: ReactNode;
  href?: string;
  disabled?: boolean;
};

export type SegmentedProps = {
  options: SegmentedOption[];
  value: string;
  onChange?: (value: string) => void;
  "aria-label": string;
  className?: string;
};

/** A controlled filter/view switch, or navigation links when options have hrefs. */
export function Segmented({ options, value, onChange, className = "", "aria-label": label }: SegmentedProps) {
  return (
    <div role="group" aria-label={label} className={`inline-flex h-8 max-w-full items-center gap-0.5 overflow-x-auto rounded-md bg-paper-2 p-0.5 ${className}`}>
      {options.map((option) => {
        const active = value === option.value;
        const classes = `inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-[5px] px-2.5 font-sans text-label font-medium transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50 ${active ? "bg-card text-ink shadow-card" : "text-ink-3"}`;
        const content = <>{option.label}{option.count != null && <span className="ml-1.5 text-meta font-normal text-ink-3">{option.count}</span>}</>;
        return option.href && !option.disabled ? (
          <Link key={option.value} href={option.href} aria-current={active ? "page" : undefined} className={classes}>{content}</Link>
        ) : (
          <button key={option.value} type="button" aria-pressed={active} disabled={option.disabled} onClick={() => onChange?.(option.value)} className={classes}>{content}</button>
        );
      })}
    </div>
  );
}
