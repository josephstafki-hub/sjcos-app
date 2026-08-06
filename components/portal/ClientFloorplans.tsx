"use client";

import { useState, useTransition } from "react";
import { Check, FileText } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { FloorplanVersion } from "@/lib/floorplans";
import { approveFloorplan } from "@/lib/actions/floorplans";

/** Client-portal floor plans. The current version renders full width with an
 *  approve-by-typed-name affordance; superseded versions collapse into a
 *  history list. Approval is the lightweight portal acknowledgment — contracts
 *  and money documents go through the e-sign flow on the Documents page. */
export function ClientFloorplans({
  plans,
  signerName,
}: {
  plans: FloorplanVersion[];
  signerName: string;
}) {
  if (plans.length === 0) {
    return (
      <p className="text-[13.5px] leading-relaxed text-ink-3">
        No plans posted yet. When Joe uploads a floor plan, the latest version will appear
        here for your review.
      </p>
    );
  }

  const [current, ...older] = plans;

  return (
    <div className="flex flex-col gap-4">
      <PlanCard plan={current} current signerName={signerName} />
      {older.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
            Earlier versions
          </span>
          {older.map((p) => (
            <PlanCard key={p.id} plan={p} signerName={signerName} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  current = false,
  signerName,
}: {
  plan: FloorplanVersion;
  current?: boolean;
  signerName: string;
}) {
  const [name, setName] = useState(signerName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve() {
    setError(null);
    if (!name.trim()) return setError("Type your name to approve.");
    const fd = new FormData();
    fd.set("approvedName", name.trim());
    startTransition(async () => {
      const res = await approveFloorplan(plan.id, fd);
      if (!res.ok) setError(res.error ?? "Something went wrong.");
    });
  }

  return (
    <Card className={current ? "p-3" : "p-2.5"}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
          Version {plan.version}
        </span>
        <span className="font-mono text-[10px] text-ink-4">{plan.uploaded}</span>
        <div className="flex-1" />
        {plan.approvedLabel ? (
          <Chip kind="money" dot>
            approved {plan.approvedLabel}
          </Chip>
        ) : current ? (
          <Chip kind="info" dot>
            for your review
          </Chip>
        ) : (
          <Chip kind="ghost">superseded</Chip>
        )}
      </div>

      {plan.notes && (
        <p className="mt-1.5 text-[12px] leading-snug text-ink-2">{plan.notes}</p>
      )}

      <div className="mt-2.5">
        {plan.isPdf ? (
          <>
            {/* Plans are issued as PDFs — show the sheet inline; the link opens
                the browser viewer for download/print. */}
            <iframe
              src={`${plan.fileUrl}#toolbar=1`}
              title={`Floor plan version ${plan.version}`}
              className={`w-full rounded-md border border-rule bg-card ${
                current ? "h-[560px]" : "h-[280px]"
              }`}
            />
            <a
              href={plan.fileUrl}
              target="_blank"
              rel="noopener"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent-soft px-2.5 py-1.5 text-[12px] font-semibold text-accent-2 hover:bg-accent-soft/70"
            >
              <FileText className="size-3.5" strokeWidth={1.75} />
              Open · download · print
            </a>
          </>
        ) : (
          <a href={plan.fileUrl} target="_blank" rel="noopener">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={plan.fileUrl}
              alt={`Floor plan version ${plan.version}`}
              className={`w-full rounded-md border border-rule bg-card object-contain ${
                current ? "max-h-[520px]" : "max-h-[240px]"
              }`}
            />
          </a>
        )}
      </div>

      {current && !plan.approvedLabel && (
        <div className="mt-3 border-t border-rule-soft pt-2.5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-ink-2">
              Type your name to approve this plan
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              className="w-full max-w-xs rounded-md border border-rule bg-card px-2.5 py-1.5 font-serif text-[15px] italic text-ink focus:border-accent focus:outline-none"
            />
          </label>
          {error && <div className="mt-1.5 text-[11px] text-flag">{error}</div>}
          <button
            type="button"
            onClick={approve}
            disabled={pending}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-money bg-money px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            <Check className="size-3" strokeWidth={2.5} />
            {pending ? "Approving…" : "Approve this plan"}
          </button>
          <p className="mt-1.5 text-[10px] leading-snug text-ink-3">
            Not quite right? Send Joe a note from the Messages tab and a revised version
            will show up here.
          </p>
        </div>
      )}

      {plan.approvedName && (
        <div className="mt-2 font-mono text-[10px] text-ink-3">
          Approved by {plan.approvedName}
        </div>
      )}
    </Card>
  );
}
