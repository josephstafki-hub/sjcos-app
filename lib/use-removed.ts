"use client";

import { useCallback, useState } from "react";

/** Optimistically-removed row keys for a board whose data arrives as props and
 *  only changes after a server action + router.refresh() round trip. A row
 *  disappears the moment its delete is clicked (`hide`) and only comes back if
 *  the write fails (`restore`) — waiting out the refetch made removal feel
 *  broken. Keys are namespaced strings ("option:12", "board:Kitchen") so one
 *  set covers every row kind on a board. Numeric ids are serial and never
 *  reused, so their entries can stay forever without hiding anything new; a
 *  name-based key CAN come back (delete a board, recreate the room), so the
 *  create path must `restore` the key it reuses.
 */
export function useRemoved() {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const hide = useCallback((key: string) => {
    setRemoved((cur) => new Set(cur).add(key));
  }, []);
  const restore = useCallback((key: string) => {
    setRemoved((cur) => {
      const next = new Set(cur);
      next.delete(key);
      return next;
    });
  }, []);
  return { removed, hide, restore };
}
