"use client";

import { useSyncExternalStore } from "react";
import { fmtIn, type Pt } from "@/lib/plan-doc";
import type { DesignerContext } from "./view-state";
import { TOOL_BY_ID } from "./ToolPalette";

export interface CursorInfo {
  pt: Pt | null;
  /** Current segment while drawing: length + angle. */
  segment?: { lengthIn: number; angleDeg: number } | null;
  snap?: string | null;
  roomName?: string | null;
  roomSf?: number | null;
  roomLf?: number | null;
  /** Free-form hint from the active interaction (e.g. "Enter to finish"). */
  hint?: string | null;
}

// Tiny external store so pointer moves re-render only the status bar, not the
// whole designer (the 3D scene is expensive to re-render).
const EMPTY: CursorInfo = { pt: null };
let current: CursorInfo = EMPTY;
const listeners = new Set<() => void>();
export const cursorStore = {
  set(info: CursorInfo) {
    current = info;
    for (const l of listeners) l();
  },
  clear() {
    cursorStore.set(EMPTY);
  },
};
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useCursor(): CursorInfo {
  return useSyncExternalStore(subscribe, () => current, () => EMPTY);
}

export function StatusBar({ ctx }: { ctx: DesignerContext }) {
  const cursor = useCursor();
  const tool = TOOL_BY_ID[ctx.d.tool];
  const s = ctx.d.save;
  const saveText =
    s.kind === "saved"
      ? "Saved"
      : s.kind === "dirty"
        ? "Unsaved changes"
        : s.kind === "saving"
          ? "Saving…"
          : s.kind === "offline"
            ? "Offline — will retry"
            : s.kind === "conflict"
              ? "Conflict — see Versions"
              : `Save failed: ${s.message}`;
  return (
    <div className="flex h-7 flex-none items-center gap-3 overflow-hidden border-t border-rule bg-paper px-3 font-mono text-[10px] text-ink-3">
      <span className="w-[150px] truncate">
        {cursor.pt ? `x ${fmtIn(cursor.pt.x)}  y ${fmtIn(cursor.pt.y)}` : "—"}
      </span>
      {cursor.segment && (
        <span className="truncate text-ink-2">
          L {fmtIn(cursor.segment.lengthIn)} · ∠ {Math.round(cursor.segment.angleDeg)}°
        </span>
      )}
      {cursor.snap && <span className="truncate text-accent-2">⌖ {cursor.snap}</span>}
      {cursor.roomName && (
        <span className="truncate">
          {cursor.roomName}
          {cursor.roomSf != null ? ` · ${Math.round(cursor.roomSf)} sf` : ""}
          {cursor.roomLf != null ? ` · ${Math.round(cursor.roomLf)} lf` : ""}
        </span>
      )}
      <span className="flex-1 truncate text-ink-4">{cursor.hint ?? tool?.hint ?? ""}</span>
      <span className="truncate">{ctx.view.snapOn ? `snap ${fmtIn(ctx.d.doc.settings.snapIn)}` : "snap off"}</span>
      <span className={s.kind === "saved" ? "text-money" : s.kind === "error" || s.kind === "conflict" ? "text-flag" : "text-ink-3"}>
        {saveText}
      </span>
    </div>
  );
}
