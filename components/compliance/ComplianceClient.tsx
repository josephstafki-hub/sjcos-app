"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { Check, Sparkles } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { resolveComplianceItem, queueRenewalRequests } from "@/lib/actions/compliance";
import type {
  ComplianceDot,
  ComplianceWindowCard,
  TimelineRow,
} from "@/lib/compliance";

const DOT: Record<ComplianceDot, string> = {
  flag: "bg-flag",
  accent: "bg-accent",
  ghost: "bg-ink-4",
};

// A filter chip matches one or more compliance kinds. COI groups certificates
// of insurance with the auto/insurance policies; "All" matches everything.
const FILTER_KINDS: Record<string, string[] | null> = {
  All: null,
  COI: ["coi", "insurance"],
  Licenses: ["license"],
  Tax: ["tax"],
};

export function ComplianceClient({
  eyebrow,
  filters,
  windows,
  timeline,
  aiSlot,
}: {
  eyebrow: string;
  filters: string[];
  windows: ComplianceWindowCard[];
  timeline: TimelineRow[];
  aiSlot: ReactNode;
}) {
  const [active, setActive] = useState("All");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const matches = (kind: string) => {
    const kinds = FILTER_KINDS[active];
    return !kinds || kinds.includes(kind);
  };

  const shownWindows = useMemo(
    () =>
      windows.map((w) => ({
        ...w,
        items: w.items.filter((it) => matches(it.kind)),
      })),
    [windows, active],
  );

  const shownTimeline = timeline.filter(
    (r) => matches(r.kind) && !resolved.has(r.id),
  );

  const resolve = (id: string) => {
    setResolved((s) => new Set(s).add(id));
    startTransition(async () => {
      await resolveComplianceItem(id);
    });
  };

  return (
    <>
      {/* Header — flex-wrap so the chip group drops below the title in a
          narrow content column instead of overlapping it. */}
      <div className="mb-3.5 flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            {eyebrow}
          </div>
          <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
            Compliance
          </h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {filters.map((f) => (
            <button key={f} onClick={() => setActive(f)}>
              <Chip kind={f === active ? "solid" : "ghost"}>{f}</Chip>
            </button>
          ))}
          <CollectRenewalsButton />
        </div>
      </div>

      {aiSlot}

      {/* Window cards */}
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {shownWindows.map((w) => (
          <Card key={w.label} kind={w.urgent ? "flag" : "default"} className="p-3.5">
            <div
              className={[
                "font-mono text-[9px] font-semibold uppercase tracking-[0.14em]",
                w.urgent ? "text-flag" : "text-ink-3",
              ].join(" ")}
            >
              {w.label}
            </div>
            <div className="mt-1 font-serif text-[22px] font-semibold text-ink">
              {w.items.length} item{w.items.length === 1 ? "" : "s"}
            </div>
            <div className="mt-2.5 flex flex-col gap-1.5">
              {w.items.map((it) => (
                <div key={it.title} className="flex items-center gap-2">
                  <span className="flex-1 text-[12px] text-ink-2">{it.title}</span>
                  <span className="font-mono text-[11px] text-ink-3">{it.due}</span>
                </div>
              ))}
              {w.items.length === 0 && (
                <span className="text-[11px] text-ink-4">None in this filter.</span>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Year-ahead timeline */}
      <Card id="compliance-timeline" className="scroll-mt-4 overflow-hidden p-0">
        <div className="border-b border-rule bg-paper-2 px-4 py-2.5">
          <h2 className="font-serif text-[14px] font-semibold text-ink">
            Year ahead · timeline
          </h2>
        </div>
        {shownTimeline.map((r) => {
          const open = expanded === r.id;
          return (
            <div key={r.id} className="border-b border-rule-soft last:border-b-0">
              <button
                onClick={() => setExpanded(open ? null : r.id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-paper-2"
              >
                <span className={`size-2 flex-none rounded-full ${DOT[r.dot]}`} />
                <span className="w-[64px] flex-none font-mono text-[11px] text-ink-2">
                  {r.date}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-serif text-[13.5px] font-semibold text-ink">
                    {r.what}
                  </div>
                  <div className="text-[11px] text-ink-3">{r.who}</div>
                </div>
                <span className="hidden max-w-[32%] text-right text-[11px] text-ink-3 sm:block">
                  {r.step}
                </span>
              </button>
              {open && (
                <div className="flex items-start gap-3 border-t border-rule-soft bg-paper-2 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-1 text-[12px] text-ink-2">
                    <div>
                      <span className="text-ink-3">Type:</span>{" "}
                      <span className="uppercase">{r.kind}</span>
                    </div>
                    <div>
                      <span className="text-ink-3">Next step:</span> {r.step}
                    </div>
                    {r.notes && (
                      <div>
                        <span className="text-ink-3">Notes:</span> {r.notes}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => resolve(r.id)}
                    className="flex-none rounded-md border border-rule px-2 py-1 text-[11px] font-semibold text-ink-3 transition-colors hover:bg-paper hover:text-ink"
                  >
                    Resolve
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {shownTimeline.length === 0 && (
          <div className="px-4 py-6 text-center text-[12px] text-ink-3">
            Nothing in this filter.
          </div>
        )}
      </Card>
    </>
  );
}

/** Header action: queue one Engine work item per unresolved compliance item due
 *  in the next 45 days. Internal only — nothing is emailed from here. */
function CollectRenewalsButton() {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function run() {
    setNote(null);
    startTransition(async () => {
      const res = await queueRenewalRequests();
      if (!res.ok) setNote(res.error);
      else if (res.queued === 0 && res.alreadyQueued === 0) setNote("Nothing due in the next 45 days");
      else if (res.queued === 0) setNote("Already queued");
      else setNote(`${res.queued} queued to Engine`);
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2 disabled:opacity-60"
      >
        <Sparkles className="size-3" strokeWidth={1.75} />
        {pending ? "Queueing…" : "Collect renewals"}
      </button>
      {note && (
        <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
          <Check className="size-3 text-money" strokeWidth={2} />
          {note}
        </span>
      )}
    </span>
  );
}
