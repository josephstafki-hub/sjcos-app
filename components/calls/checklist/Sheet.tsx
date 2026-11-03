"use client";

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Modal surface for the checklist: a bottom sheet on phones and tablets, a
// right-hand side panel on desktop (`side`), or a centred confirm (`dialog`).
// Traps focus, closes on Escape, and hands focus back to whatever opened it.
// It opens inside the Shell's main column ([data-sheet-root]) so a dialog is
// centred over the page Joe is working in — not over the sidebar or the
// Operator dock — and never grows past that column: the body scrolls instead.

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  title, onClose, children, footer, layout = "side", initialFocus, labelledBy,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Pinned to the bottom (Undo / Save) so it sits under the thumb. */
  footer?: ReactNode;
  layout?: "side" | "dialog";
  /** CSS selector inside the sheet to focus first. */
  initialFocus?: string;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Sheets only open after a tap, never in the server render, so the root can
  // be looked up once when the sheet first renders.
  const [root] = useState<Element | null>(() => (typeof document === "undefined" ? null : document.querySelector("[data-sheet-root]")));
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const first = (initialFocus && root?.querySelector<HTMLElement>(initialFocus)) || root?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); if (opener?.isConnected) opener.focus(); };
  }, [initialFocus]);

  // Bounded by the column (or the viewport when there's no Shell), so a long
  // list of results scrolls inside the body and the search stays in view.
  const bound = root ? "max-h-[calc(100%-2rem)]" : "max-h-[calc(100dvh-2rem)]";
  const panel = layout === "dialog"
    ? `mx-4 w-full max-w-[440px] rounded-lg ${bound}`
    : "w-full max-h-[min(92dvh,100%)] rounded-t-xl lg:h-full lg:max-h-none lg:w-[440px] lg:rounded-none lg:border-l";

  const sheet = (
    <div className={`${root ? "absolute" : "fixed"} inset-0 z-50 flex bg-ink/30 ${layout === "dialog" ? "items-center justify-center" : "items-end justify-center lg:items-stretch lg:justify-end"}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? titleId}
        className={`flex min-h-0 flex-col border-rule bg-card shadow-modal ${panel} ${layout === "dialog" ? "border" : "border-t lg:border-t-0"}`}>
        <div className="flex flex-none items-center gap-2 border-b border-rule px-4 py-2">
          <h2 id={titleId} className="min-w-0 flex-1 break-words font-serif text-[20px] font-semibold leading-7 text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex size-12 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
            <X aria-hidden className="size-5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 text-[16px] leading-6 text-ink">{children}</div>
        {footer && <div className="flex flex-none flex-wrap items-center gap-3 border-t border-rule bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>}
      </div>
    </div>
  );
  return root ? createPortal(sheet, root) : sheet;
}

/** 48 px button used across the checklist (office surface target, plan §1.1). */
export function Btn({
  children, onClick, kind = "secondary", disabled, className = "", type = "button", ...rest
}: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean; className?: string; type?: "button" | "submit";
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type" | "children" | "className" | "disabled">) {
  const tone = kind === "primary" ? "bg-ink text-paper hover:bg-ink-hover"
    : kind === "ghost" ? "text-ink-2 hover:bg-hover hover:text-ink"
    : kind === "danger" ? "border border-flag/40 bg-card text-flag hover:bg-flag-soft"
    : "border border-rule bg-card text-ink hover:bg-paper-2";
  return (
    <button type={type} onClick={onClick} disabled={disabled} {...rest}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-[16px] font-semibold leading-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 ${tone} ${className}`}>
      {children}
    </button>
  );
}
