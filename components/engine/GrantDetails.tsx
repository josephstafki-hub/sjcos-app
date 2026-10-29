"use client";

// The "Details" toggle on a permission card: the job, the key facts (amount,
// who it goes to, the document), the message that goes out, and links to the
// PDF / record. Shared by the panel chat card, the bell / corner popup and
// /engine/permissions so every surface explains a request the same way.

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { GrantDetail } from "@/lib/owner-grant-types";

export function GrantDetails({
  detail,
  defaultOpen = false,
  showDraft = true,
}: {
  detail: GrantDetail;
  defaultOpen?: boolean;
  /** Off where the card already shows the message body itself. */
  showDraft?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const draft = showDraft ? detail.draft : null;
  const hasMore = detail.facts.length > 0 || !!draft || !!detail.draftNote || detail.links.length > 0;
  if (!hasMore) return null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-0.5 text-[11.5px] font-medium text-accent-2 hover:underline"
        aria-expanded={open}
      >
        <Chevron className="size-3.5" strokeWidth={2} />
        {open ? "Hide details" : draft ? "Details & draft" : "Details"}
      </button>
      {open && (
        <div className="mt-1 rounded-md border border-rule bg-paper-2 px-2.5 py-2 text-[12px] text-ink-2">
          {detail.facts.length > 0 && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
              {detail.facts.map((f, i) => (
                <div key={i} className="contents">
                  <dt className="text-[11px] text-ink-3">{f.label}</dt>
                  <dd className={`break-words ${f.label === "Heads up" ? "font-medium text-flag" : ""}`}>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {draft && (
            <div className={detail.facts.length ? "mt-2 border-t border-rule pt-2" : ""}>
              {draft.to && <div className="font-mono text-[10.5px] text-ink-3">To: {draft.to}</div>}
              {draft.subject && <div className="font-mono text-[10.5px] text-ink-3">Subject: {draft.subject}</div>}
              <div className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed">{draft.body}</div>
            </div>
          )}
          {detail.draftNote && <div className="mt-1.5 text-[11.5px] text-ink-3">{detail.draftNote}</div>}
          {detail.links.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {detail.links.map((l) =>
                l.href.startsWith("/api/") ? (
                  <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="text-[11.5px] font-medium text-accent-2 hover:underline">
                    {l.label} ↗
                  </a>
                ) : (
                  <Link key={l.href} href={l.href} className="text-[11.5px] font-medium text-accent-2 hover:underline">
                    {l.label}
                  </Link>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
