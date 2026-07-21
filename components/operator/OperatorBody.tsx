import { Chip } from "@/components/ui";
import { TodayQueueProvider } from "@/components/today/TodayQueueContext";
import { OperatorGrid } from "./OperatorGrid";
import { operatorContext } from "@/lib/page-context";
import type { TodayData } from "@/lib/today";

/** Operator console body (spec §1.2) — mirrors TodayBody's shell/provider
 *  pattern but lays out the three-panel OperatorGrid. Reuses the Today queue
 *  provider unchanged so priorities/waiting stay in sync with /today's logic. */
export function OperatorBody({ data }: { data: TodayData }) {
  const aiContext = operatorContext(data);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-7">
      {/* Header strip */}
      <div className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
            {data.greeting}
          </h1>
          <div className="mt-1 text-[12.5px] text-ink-3">
            Operator — talk to an agent, hand it a card, watch the record change.
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:items-end">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            {data.weekLabel}
          </div>
          {/* Wraps on phones so long money chips stay on screen. */}
          <div className="flex flex-wrap gap-1.5 sm:flex-nowrap">
            {data.headerChips.map((c) => (
              <Chip key={c.label} kind={c.kind} dot>
                {c.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <TodayQueueProvider initialPriorities={data.priorities} initialWaiting={data.waiting}>
        <OperatorGrid aiContext={aiContext} />
      </TodayQueueProvider>
    </div>
  );
}
