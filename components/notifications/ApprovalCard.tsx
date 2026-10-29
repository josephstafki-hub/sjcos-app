"use client";

// One thing waiting on Joe's yes/no — shown in the corner popup and inline on
// /notifications. Shows exactly what goes out (To / Subject / message) and
// what approving does, so the tap is informed; the Approve button says
// "Approve & send" only when approving really transmits something.

import Link from "next/link";
import { useState } from "react";
import { Chip } from "@/components/ui";
import type { PendingApproval } from "@/lib/approvals";
import { GrantDetails } from "@/components/engine/GrantDetails";

export function ApprovalCard({
  approval: a,
  busy,
  disabled,
  onAnswer,
  floating,
}: {
  approval: PendingApproval;
  busy: boolean;
  disabled: boolean;
  onAnswer: (verb: "approve" | "decline") => void;
  /** Popup styling (shadow, tighter) vs inline feed card. */
  floating?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const long = (a.body ?? "").length > 220;
  return (
    <div className={`rounded-md border border-flag/50 bg-paper p-3 pr-7 ${floating ? "shadow-lg" : ""}`}>
      <div className="flex items-center gap-1.5">
        <Chip kind="flag">{a.tag}</Chip>
        {a.requestedBy && <span className="truncate font-mono text-[10px] text-ink-3">{a.requestedBy}</span>}
      </div>
      <div className="mt-1 font-serif text-[14px] font-semibold leading-snug text-ink">{a.title}</div>
      {(a.to || a.subject) && (
        <div className="mt-1 space-y-0.5 font-mono text-[10.5px] text-ink-3">
          {a.to && <div className="truncate">To: {a.to}</div>}
          {a.subject && <div className="truncate">Subject: {a.subject}</div>}
        </div>
      )}
      {a.body && (
        <div className="mt-1.5 rounded border border-rule bg-paper-2 px-2 py-1.5 text-[12px] leading-relaxed text-ink-2">
          <div className={`whitespace-pre-wrap ${open ? "max-h-64 overflow-y-auto" : "line-clamp-4"}`}>{a.body}</div>
          {long && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="mt-0.5 text-[11px] font-medium text-accent-2 hover:underline">
              {open ? "Show less" : "Show all"}
            </button>
          )}
        </div>
      )}
      {a.effect && <div className="mt-1.5 text-[11.5px] text-ink-3">{a.effect}</div>}
      {/* The body above already shows the draft; Details adds the facts and links. */}
      {a.detail && <GrantDetails detail={a.detail} showDraft={!a.body} />}
      <div className="mt-2 flex items-center gap-1.5">
        <Link href={a.href} className="text-[11.5px] font-medium text-ink-3 hover:text-ink hover:underline">
          Open
        </Link>
        <div className="flex-1" />
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAnswer("decline")}
          className="rounded-md border border-ink-4 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:opacity-40"
        >
          Decline
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAnswer("approve")}
          className="rounded-md border border-accent bg-accent px-2.5 py-1 text-[12px] font-semibold text-paper transition-colors hover:bg-accent-2 disabled:opacity-50"
        >
          {busy ? "Working…" : a.sends ? "Approve & send" : "Approve"}
        </button>
      </div>
    </div>
  );
}
