"use client";
import { useEffect, useRef, type RefObject } from "react";
/** Local dialog behavior for the operations pages. Escape closes and returns
 * focus to the trigger; Tab stays inside the topmost modal. */
export function useDialogDismiss(open: boolean, close: () => void, trigger?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const previous = trigger?.current ?? (document.activeElement as HTMLElement | null);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); }
      if (e.key === "Tab") {
        const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
        const dialog = dialogs[dialogs.length - 1];
        const fields = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
        if (!fields?.length) return;
        const first = fields[0], last = fields[fields.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); previous?.focus(); };
  }, [open, trigger]);
}
