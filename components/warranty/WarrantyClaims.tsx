"use client";

import { useState, useTransition } from "react";
import { Card, Chip } from "@/components/ui";
import { resolveWarrantyClaim, acknowledgeWarrantyClaim } from "@/lib/actions/warranty";
import type { ClaimDot, WarrantyClaim } from "@/lib/warranty";

const DOT: Record<ClaimDot, string> = {
  accent: "bg-accent",
  flag: "bg-flag",
  ghost: "bg-ink-4",
};

/** Active-claims card with expandable, resolvable claim rows. Clicking a claim
 *  opens its detail; "Resolve claim" closes it out (owner-gated). */
export function WarrantyClaims({ claims }: { claims: WarrantyClaim[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const shown = claims.filter((c) => !resolved.has(c.id));

  const resolve = (id: string) => {
    setResolved((s) => new Set(s).add(id));
    setNotice(null);
    startTransition(async () => {
      const r = await resolveWarrantyClaim(id);
      if (!r.ok) {
        setResolved((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
        setNotice(r.error ?? "Couldn't resolve that claim.");
      }
    });
  };

  return (
    <Card className="mb-5 overflow-hidden p-0">
      <div className="border-b border-rule bg-paper-2 px-4 py-2.5">
        <h2 className="font-serif text-[14px] font-semibold text-ink">
          Active claims · {shown.length}
        </h2>
      </div>

      {notice && (
        <div className="border-b border-rule-soft bg-flag-soft px-4 py-2 text-[12px] text-flag">
          {notice}
        </div>
      )}

      {shown.map((c) => {
        const isOpen = open === c.id;
        return (
          <div key={c.id} className="border-b border-rule-soft last:border-b-0">
            <button
              onClick={() => setOpen(isOpen ? null : c.id)}
              className="flex w-full flex-col gap-3 px-4 py-3.5 text-left transition-colors hover:bg-paper-2 sm:flex-row sm:items-start"
            >
              <span className={`mt-1.5 size-2 flex-none rounded-full ${DOT[c.dot]}`} />
              <div className="min-w-0 flex-1">
                <h3 className="font-serif text-[15px] font-semibold text-ink">{c.project}</h3>
                <div className="mt-0.5 text-[11px] text-ink-3">
                  {c.client}{c.age ? ` · ${c.age}` : ""}
                </div>
                <p className="mt-1.5 text-[13px] text-ink-2">{c.issue}</p>
              </div>
              <div className="flex flex-col items-start gap-1.5 sm:items-end">
                <Chip kind="flag" dot>
                  {c.deadline}
                </Chip>
                <span className="text-[11px] text-ink-3">{c.step}</span>
              </div>
            </button>

            {isOpen && (
              <div className="flex flex-col gap-3 border-t border-rule-soft bg-paper-2 px-4 py-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-1 text-[12px] text-ink-2">
                  <div>
                    <span className="text-ink-3">Client:</span> {c.client}
                  </div>
                  <div>
                    <span className="text-ink-3">Issue:</span> {c.issue}
                  </div>
                  <div>
                    <span className="text-ink-3">Deadline:</span> {c.deadline}
                  </div>
                  <div>
                    <span className="text-ink-3">Status:</span> {c.step}
                  </div>
                </div>
                <div className="flex flex-none gap-2">
                  <button
                    onClick={() => startTransition(async () => { await acknowledgeWarrantyClaim(c.id); })}
                    className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-paper hover:text-ink"
                  >
                    Acknowledge
                  </button>
                  <button
                    onClick={() => resolve(c.id)}
                    className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]"
                  >
                    Resolve claim
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {shown.length === 0 && (
        <div className="px-4 py-6 text-center text-[12px] text-ink-3">
          No active claims.
        </div>
      )}
    </Card>
  );
}
