"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import type { Selection, SelectionStatus } from "@/lib/selections";
import { decideSelection } from "@/lib/actions/selections";

const STATUS_CHIP: Record<SelectionStatus, ChipKind> = {
  draft: "ghost",
  pending: "info",
  approved: "money",
  declined: "flag",
};

const STATUS_LABEL: Record<SelectionStatus, string> = {
  draft: "draft",
  pending: "needs your decision",
  approved: "approved",
  declined: "declined",
};

/** Client-portal selections section. Pushed selections render with their image;
 *  pending ones get Approve / Decline. Approve/decline routes through the
 *  owner-or-scoped-client decideSelection action. */
export function ClientSelections({ selections }: { selections: Selection[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function decide(id: number, approve: boolean) {
    setError("");
    startTransition(async () => {
      const r = await decideSelection(id, approve);
      if (!r.ok) setError(r.error ?? "Something went wrong.");
    });
  }

  if (selections.length === 0) {
    return <div className="mt-2 text-[12px] text-ink-3">Nothing to review right now.</div>;
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {error && <div className="text-[11px] text-flag">{error}</div>}
      {selections.map((s) => (
        <Card key={s.id} className="overflow-hidden p-0">
          {s.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.imageUrl} alt={s.choice} className="aspect-[4/3] w-full border-b border-rule object-cover" />
          ) : null}
          <div className="flex flex-col gap-1.5 p-2.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">{s.area}</span>
            <span className="text-[12px] leading-snug text-ink">{s.choice}</span>
            <div className="flex items-center gap-2">
              <Chip kind={STATUS_CHIP[s.status]} dot>
                {STATUS_LABEL[s.status]}
              </Chip>
              {s.status === "pending" && (
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    disabled={pending}
                    onClick={() => decide(s.id, true)}
                    className="inline-flex items-center gap-1 rounded-md border border-money/40 bg-money/10 px-2 py-1 text-[11px] font-semibold text-money hover:bg-money/20 disabled:opacity-50"
                  >
                    <Check className="size-3" strokeWidth={1.75} />
                    Approve
                  </button>
                  <button
                    disabled={pending}
                    onClick={() => decide(s.id, false)}
                    className="inline-flex items-center gap-1 rounded-md border border-rule px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2 hover:text-flag disabled:opacity-50"
                  >
                    <X className="size-3" strokeWidth={1.75} />
                    Decline
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
