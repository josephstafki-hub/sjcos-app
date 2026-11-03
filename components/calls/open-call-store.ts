"use client";

import { useSyncExternalStore } from "react";

// Which call / checklist the Calls page has open in this tab, so the app-wide
// live-call bar can hide itself for the call already on screen (plan §4.1).

export type OpenChecklist = { sessionId: string | null; callId: string | null } | null;

let current: OpenChecklist = null;
const listeners = new Set<() => void>();

export function setOpenChecklist(next: OpenChecklist) {
  if (current?.sessionId === next?.sessionId && current?.callId === next?.callId) return;
  current = next;
  listeners.forEach((l) => l());
}

export function useOpenChecklist(): OpenChecklist {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => current,
    () => null,
  );
}
