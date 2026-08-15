"use client";

import { useRef } from "react";
import { GripVertical } from "lucide-react";
import { PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "./panelStore";

const clamp = (w: number) => Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, w));

/** The dock/app divider. Hand-rolled — one axis, one divider; pointer capture
 *  keeps the drag alive when the cursor leaves the strip. Double-click
 *  resets to the default width. */
export function Splitter({
  width,
  onResize,
  onCommit,
}: {
  width: number;
  onResize: (w: number) => void;
  onCommit: (w: number) => void;
}) {
  const lastRef = useRef(width);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startW = width;
    lastRef.current = width;
    el.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const w = clamp(startW + (ev.clientX - startX));
      lastRef.current = w;
      onResize(w);
    };
    const onUp = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      onCommit(lastRef.current);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  // A visible grab handle, not a hairline: a 10px strip in the page-2 tone
  // with a centered grip glyph, tinted on hover/drag. An earlier 6px strip in
  // the border color sat flush against the dock's own border and simply
  // vanished — the only tell was the cursor.
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize operator panel"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        onResize(PANEL_DEFAULT_WIDTH);
        onCommit(PANEL_DEFAULT_WIDTH);
      }}
      className="group hidden w-2.5 flex-none cursor-col-resize select-none items-center justify-center border-x border-rule bg-paper-2 transition-colors hover:bg-ai-soft active:bg-ai-soft lg:flex"
    >
      <span className="flex h-12 w-full items-center justify-center rounded-sm bg-rule/70 text-ink-3 transition-colors group-hover:bg-ai group-hover:text-paper group-active:bg-ai group-active:text-paper">
        <GripVertical className="size-3" strokeWidth={2} />
      </span>
    </div>
  );
}
