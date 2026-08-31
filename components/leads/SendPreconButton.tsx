"use client";

import { useSwitchLeadTab } from "@/components/leads/LeadTabs";

/** Jumps the lead-detail tab bar to Documents, where the Pre-Construction
 *  Agreement template can be filled, rendered, and sent for e-signature. */
export function SendPreconButton() {
  const switchTab = useSwitchLeadTab();

  return (
    <button
      type="button"
      onClick={() => switchTab("Documents")}
      className="mt-2.5 w-full rounded-md border border-accent bg-accent px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2"
    >
      Pre-con contract →
    </button>
  );
}
