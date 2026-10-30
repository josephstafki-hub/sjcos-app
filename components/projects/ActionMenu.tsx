"use client";

import { useId, useRef, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui";

/** Local feature composition: the top layer keeps row actions outside table
 * scroll clipping. Native popovers handle Escape, outside click and focus return. */
export function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  return (
    <span ref={trigger} className="inline-flex">
      <Button variant="ghost" iconOnly icon={MoreHorizontal}
        aria-label={label} title={label} popoverTarget={id} />
      <div id={id} popover="auto" aria-label={label}
        className="fixed m-0 max-h-[80dvh] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-rule-soft bg-card p-1 shadow-pop [&_button]:flex [&_button]:min-h-11 [&_button]:w-full [&_button]:justify-start"
        onToggle={event => {
          if (event.newState !== "open" || !trigger.current) return;
          const menu = event.currentTarget;
          const anchor = trigger.current.getBoundingClientRect();
          menu.style.left = `${Math.max(8, Math.min(anchor.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
          menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - menu.offsetHeight - 8))}px`;
        }}
        onClick={event => {
          if ((event.target as HTMLElement).closest("button, a")) event.currentTarget.hidePopover();
        }}>
        {children}
      </div>
    </span>
  );
}
