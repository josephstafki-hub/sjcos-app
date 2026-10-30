"use client";

// One thing waiting on Joe's yes/no — shown in the corner popup and inline on
// /notifications. Shows exactly what goes out (To / Subject / message) and
// what approving does, so the tap is informed; the Approve button says
// "Approve & send" only when approving really transmits something.

import Link from "next/link";
import { useState } from "react";
import { Button, Chip } from "@/components/ui";
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
    <div className={`rounded-lg border border-rule-soft bg-card p-4 ${floating ? "shadow-pop" : ""}`}>
      <div className="flex items-center gap-1.5">
        <Chip kind="flag">{a.tag}</Chip>
        {a.requestedBy && <span className="truncate text-meta text-ink-3">{a.requestedBy}</span>}
      </div>
      <div className="mt-1 text-subheading font-semibold leading-snug text-ink">{a.title}</div>
      {(a.to || a.subject) && (
        <div className="mt-1 space-y-0.5 text-meta text-ink-3">
          {a.to && <div className="truncate">To: {a.to}</div>}
          {a.subject && <div className="truncate">Subject: {a.subject}</div>}
        </div>
      )}
      {a.body && (
        <div className="mt-1.5 rounded border border-rule bg-paper-2 px-2 py-1.5 text-meta leading-relaxed text-ink-2">
          <div className={`whitespace-pre-wrap ${open ? "max-h-64 overflow-y-auto" : "line-clamp-4"}`}>{a.body}</div>
          {long && (
            <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} className="mt-0.5 text-meta font-medium text-accent-2 hover:underline">
              {open ? "Show less" : "Show all"}
            </Button>
          )}
        </div>
      )}
      {a.effect && <div className="mt-1.5 text-meta text-ink-3">{a.effect}</div>}
      {/* The body above already shows the draft; Details adds the facts and links. */}
      {a.detail && <GrantDetails detail={a.detail} showDraft={!a.body} />}
      <div className="mt-2 flex items-center gap-1.5">
        <Link href={a.href} className="text-meta font-medium text-ink-3 hover:text-ink hover:underline">
          Open
        </Link>
        <div className="flex-1" />
        <Button
          type="button"
          disabled={disabled}
          onClick={() => onAnswer("decline")}
          variant="secondary"
        >
          Decline
        </Button>
        <Button
          type="button"
          disabled={disabled}
          onClick={() => onAnswer("approve")}
          variant="primary"
        >
          {busy ? "Working…" : a.sends ? "Approve & send" : "Approve"}
        </Button>
      </div>
    </div>
  );
}
