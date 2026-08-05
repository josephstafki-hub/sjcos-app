"use client";

import { useRef } from "react";
import { PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from "./panelStore";

const clamp = (w: number) => Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, w));

/** The dock/app divider. Hand-rolled — one axis, one divider; pointer capture
 *  keeps the drag alive when the cursor leaves the 6px strip. Double-click
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
      className="hidden w-1.5 flex-none cursor-col-resize bg-rule/60 transition-colors hover:bg-ai lg:block"
    />
  );
}
