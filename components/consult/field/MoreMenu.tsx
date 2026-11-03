"use client";
/**
 * ⋯ menu (plan §6.2): the same sheet on every visitor screen and width — Sun mode and
 * Back to SJC OS. Sun mode is a switch whose state is a word (On / Off) beside a
 * track; it never borrows a coverage mark (○ is the legend's "Open").
 * No next/* imports: bundled into the offline capture shell too.
 */
import { useState, useSyncExternalStore } from "react";
import { W } from "@/lib/consult/ui/words";
import { Btn, Sheet } from "./primitives";

const SUN_KEY = "sjcos-consult-sun";
const sunListeners = new Set<() => void>();
export const sunStore = {
  subscribe: (fn: () => void) => { sunListeners.add(fn); return () => { sunListeners.delete(fn); }; },
  get: () => { try { return localStorage.getItem(SUN_KEY) === "1"; } catch { return false; } },
  set: (v: boolean) => { try { localStorage.setItem(SUN_KEY, v ? "1" : "0"); } catch { /* private mode */ } for (const fn of sunListeners) fn(); },
};
export function useSun(): [boolean, () => void] {
  const sun = useSyncExternalStore(sunStore.subscribe, sunStore.get, () => false);
  return [sun, () => sunStore.set(!sun)];
}

/** Label left, state word + track right; the whole row is one 56 px target. */
export function SunSwitch() {
  const [sun, toggle] = useSun();
  return (
    <button type="button" role="switch" aria-checked={sun} onClick={toggle}
      className="flex min-h-14 w-full items-center justify-between gap-4 rounded-md border-2 border-rule bg-card px-4 text-left text-[1em] font-semibold text-ink hover:bg-paper-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus">
      <span>{W.sunMode}</span>
      <span className="flex items-center gap-3">
        <span className="min-w-[2.5em] text-right">{sun ? W.on : W.off}</span>
        <span aria-hidden className={`relative inline-block h-7 w-12 rounded-full border-2 ${sun ? "border-accent bg-accent" : "border-rule bg-paper-2"}`}>
          <span className={`absolute top-0.5 size-5 rounded-full border-2 border-rule bg-card transition-[left] ${sun ? "left-[calc(100%-1.4rem)]" : "left-0.5"}`} />
        </span>
      </span>
    </button>
  );
}

/** ⋯ button + sheet. `onExit` decides how leaving works (the visit warns about unsent items first). */
export function MoreMenu({ onExit, exitHref }: { onExit?: () => void; exitHref?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={W.more} aria-haspopup="dialog"
        className="inline-flex size-14 shrink-0 items-center justify-center rounded-md text-[1.4em] font-bold text-ink hover:bg-hover focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-focus">⋯</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={W.more}>
        <div className="grid gap-3">
          <SunSwitch />
          {onExit
            ? <Btn wide onClick={() => { setOpen(false); onExit(); }}>{W.back}</Btn>
            : exitHref ? <a href={exitHref} className="inline-flex min-h-14 w-full items-center justify-center rounded-md border-2 border-rule bg-card px-4 font-semibold text-ink no-underline hover:bg-paper-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus">{W.back}</a> : null}
        </div>
      </Sheet>
    </>
  );
}
