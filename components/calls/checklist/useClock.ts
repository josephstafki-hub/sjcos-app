"use client";

import { useSyncExternalStore } from "react";

// A once-a-second clock for call timers, and the browser's online flag, as
// external stores — no setState inside effects, and the server render (null /
// online) never mismatches hydration.

function subscribeSecond(listener: () => void) {
  const t = setInterval(listener, 1000);
  return () => clearInterval(t);
}
const noop = () => () => {};

/** Milliseconds now, ticking each second while `active`; null on the server. */
export function useClock(active: boolean): number | null {
  const second = useSyncExternalStore(active ? subscribeSecond : noop, () => (active ? Math.floor(Date.now() / 1000) : 0), () => -1);
  return !active || second < 0 ? null : second * 1000;
}

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); };
}

export function useBrowserOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine !== false, () => true);
}

/** A sessionStorage value as a store (string snapshot, stable between reads). */
const sessionListeners = new Set<() => void>();
export function useSessionValue(key: string): string | null {
  return useSyncExternalStore(
    (l) => { sessionListeners.add(l); return () => { sessionListeners.delete(l); }; },
    () => { try { return sessionStorage.getItem(key); } catch { return null; } },
    () => null,
  );
}
export function writeSessionValue(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* tab-only anyway */ }
  sessionListeners.forEach((l) => l());
}
