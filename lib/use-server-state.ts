"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * useState seeded from a server-rendered prop that ALSO adopts the prop again
 * whenever the server sends different data — e.g. after LiveUpdates'
 * router.refresh() because an agent, a timer or another tab changed the rows.
 * Plain useState(prop) keeps the first value forever: refresh() re-renders the
 * server components but never resets client state.
 *
 * Compared by content, not identity, so a refresh that brings back the same
 * rows (most of them — any table bump refreshes every page) leaves local edits
 * alone: an optimistic toggle survives until the server actually disagrees.
 * Render-phase adjustment, not an effect (react.dev/learn/you-might-not-need-
 * an-effect#adjusting-some-state-when-a-prop-changes).
 */
export function useServerState<T>(serverValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(serverValue);
  const json = JSON.stringify(serverValue);
  const [seen, setSeen] = useState(json);
  if (json !== seen) {
    setSeen(json);
    setState(serverValue);
  }
  return [state, setState];
}
