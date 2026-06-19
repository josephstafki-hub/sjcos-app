"use client";

import { useState } from "react";
import Link from "next/link";

const CAP = 5;

/** "Waiting on me" list, capped at 5 with a Show-all toggle. */
export function WaitingList({ items }: { items: { label: string; href?: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, CAP);
  const hidden = items.length - CAP;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {shown.map((item, i) => {
        const row = (
          <>
            <span className="size-3.5 flex-none rounded-[3px] border border-ink-4" />
            <span className="text-[12px] text-ink-2">{item.label}</span>
          </>
        );
        return item.href ? (
          <Link
            key={i}
            href={item.href}
            className="-mx-1 flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-paper-3"
          >
            {row}
          </Link>
        ) : (
          <div key={i} className="flex items-center gap-2">
            {row}
          </div>
        );
      })}
      {hidden > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 self-start text-[11px] font-medium text-ink-3 hover:text-ink"
        >
          {expanded ? "Show less" : `Show all (${hidden} more)`}
        </button>
      )}
    </div>
  );
}
