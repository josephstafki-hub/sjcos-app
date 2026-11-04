"use client";
import { useEffect, useRef, type RefObject } from "react";
/** Local dialog behavior for the operations pages. Escape closes and returns
 * focus to the trigger; Tab stays inside the topmost modal. */
export function useDialogDismiss(
  open: boolean,
  close: () => void,
  trigger?: RefObject<HTMLElement | null>,
) {
  // Capture before a newly mounted modal's autoFocus moves focus into it.
  // Keep the optional explicit trigger used by other operations dialogs.
  const lastTrigger = useRef<HTMLElement | null>(
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement),
  );
  useEffect(() => {
    if (open) return;
    const remember = () => {
      const target = document.activeElement as HTMLElement;
      if (
        target &&
        target !== document.body &&
        !target.closest('[role="dialog"]')
      )
        lastTrigger.current = target;
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, [open]);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const previous = trigger?.current ?? lastTrigger.current;
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1];
    if (dialog && !dialog.contains(document.activeElement))
      dialog
        .querySelector<HTMLElement>(
          'button, input:not([type="hidden"]), select, textarea',
        )
        ?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const dialogs =
          document.querySelectorAll<HTMLElement>('[role="dialog"]');
        const dialog = dialogs[dialogs.length - 1];
        const fields = dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        );
        if (!fields?.length) return;
        const first = fields[0],
          last = fields[fields.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      previous?.focus();
    };
  }, [open, trigger]);
}
