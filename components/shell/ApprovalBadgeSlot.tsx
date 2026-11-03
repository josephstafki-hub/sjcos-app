"use client";

import { useEffect } from "react";
import { APPROVAL_SLOT_EVENT, APPROVAL_SLOT_ID } from "@/lib/notification-placement";

// Where the compact "Decisions N" badge goes on a page that owns its bottom
// edge (lib/notification-placement.ts). Render at most one at a time; the
// badge follows it when it mounts, moves or unmounts. Hidden while empty so it
// adds no gap to the header it sits in.
export function ApprovalBadgeSlot({ className = "" }: { className?: string }) {
  useEffect(() => {
    window.dispatchEvent(new Event(APPROVAL_SLOT_EVENT));
    return () => { window.dispatchEvent(new Event(APPROVAL_SLOT_EVENT)); };
  }, []);
  return <span id={APPROVAL_SLOT_ID} className={`shrink-0 empty:hidden ${className}`} />;
}
