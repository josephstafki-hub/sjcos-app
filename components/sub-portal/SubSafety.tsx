"use client";

import { useState, useTransition } from "react";
import { HardHat, Check } from "lucide-react";
import { Chip } from "@/components/ui";
import { acknowledgeOrientation } from "@/lib/actions/safety";
import type { SubOrientation } from "@/lib/safety";

/** Sub-portal safety card — read the jobsite orientation(s) for the current
 *  project and acknowledge them. */
export function SubSafety({ orientations }: { orientations: SubOrientation[] }) {
  const [acked, setAcked] = useState<Set<number>>(
    () => new Set(orientations.filter((o) => o.acknowledged).map((o) => o.id)),
  );
  const [pending, startTransition] = useTransition();

  function ack(id: number) {
    setAcked((s) => new Set(s).add(id)); // optimistic
    startTransition(async () => {
      await acknowledgeOrientation(id);
    });
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <HardHat className="size-3.5 text-accent" strokeWidth={1.75} />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Safety orientation</span>
      </div>
      <div className="mt-2 flex flex-col gap-2.5">
        {orientations.map((o) => {
          const isAcked = acked.has(o.id);
          return (
            <div key={o.id} className="rounded-md border border-rule bg-paper p-2.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 font-serif text-[13px] font-semibold text-ink">{o.trade}</span>
                {isAcked ? (
                  <Chip kind="money" dot>
                    acknowledged
                  </Chip>
                ) : (
                  <button
                    type="button"
                    onClick={() => ack(o.id)}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2 py-0.5 text-[11px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
                  >
                    <Check className="size-2.5" strokeWidth={2} />
                    Acknowledge
                  </button>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-line text-[12px] leading-snug text-ink-2">{o.body}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
