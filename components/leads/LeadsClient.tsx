"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { NewLeadButton } from "@/components/leads/NewLeadButton";
// Type-only — never pull lib/leads (→ lib/db → pg) into the client bundle.
import type { LeadsData, LeadListItem, LeadTemperature } from "@/lib/leads";

type FilterKey = "All" | "lost" | LeadTemperature;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "All", label: "All" },
  { key: "hot", label: "Hot" },
  { key: "cooling", label: "Cooling" },
  { key: "lost", label: "Lost / Archived" },
];

export function LeadsClient({ data }: { data: LeadsData }) {
  const [filter, setFilter] = useState<FilterKey>("All");

  // Terminal lost/archived leads are hidden from the active views (All/Hot/
  // Cooling) and only shown under their own filter.
  const active = data.leads.filter((l) => l.stage !== "lost");
  const lost = data.leads.filter((l) => l.stage === "lost");
  const visible =
    filter === "All"
      ? active
      : filter === "lost"
        ? lost
        : active.filter((l) => l.temperature === filter);

  return (
    <>
      {/* Header */}
      <div className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="min-w-0 flex-1">
          <Eyebrow>{data.summary}</Eyebrow>
          <h1 className="mt-1 font-serif text-[34px] font-medium leading-none tracking-tight text-accent-2">
            Leads
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}>
              <Chip kind={filter === f.key ? "solid" : "ghost"}>{f.label}</Chip>
            </button>
          ))}
          <NewLeadButton />
        </div>
      </div>

      {/* Pipeline stage strip */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {data.stages.map((s, i) => (
          <Card key={s.key} kind="tan" className="p-2.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
              Stage {i + 1}
            </div>
            <div className="mt-0.5 font-serif text-[13.5px] font-semibold text-ink">{s.label}</div>
            <div className="mt-1.5 flex items-end gap-1">
              <span className="font-mono text-[22px] font-bold leading-none text-accent-2 tabular-nums">
                {s.count}
              </span>
              <span className="text-[11px] text-ink-3">leads</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Lead table */}
      <Card className="overflow-hidden p-0">
        {/* Column headers */}
        <div className="flex items-center gap-2 border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-ink-3">
          <span className="w-[200px]">Lead</span>
          <span className="hidden w-[150px] md:block">Scope</span>
          <span className="w-[130px]">Stage</span>
          <span className="hidden w-[72px] md:block">Value</span>
          <div className="flex-1" />
          <span>AI take</span>
          <span className="w-3" />
        </div>

        {visible.map((l) => (
          <LeadRow key={l.slug} lead={l} />
        ))}
        {visible.length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] text-ink-3">
            No {filter === "All" ? "" : filter + " "}leads right now.
          </div>
        )}
      </Card>
    </>
  );
}

function LeadRow({ lead: l }: { lead: LeadListItem }) {
  return (
    <Link
      href={`/leads/${l.slug}`}
      className="flex items-center gap-2 border-b border-rule-soft px-4 py-3 transition-colors last:border-b-0 hover:bg-paper-2"
    >
      <div className="flex w-[200px] items-center gap-2">
        <div className="min-w-0">
          <div className="truncate font-serif text-[13.5px] font-semibold text-ink">{l.name}</div>
          <div className="text-[11px] text-ink-3">{l.ageDays}d since first contact</div>
        </div>
      </div>
      <div className="hidden w-[150px] text-[12px] text-ink-2 md:block">{l.scope}</div>
      <div className="w-[130px]">
        <Chip kind={l.stageAdvanced ? "accent" : "ghost"}>{l.stageLabelText}</Chip>
      </div>
      <div className="hidden w-[72px] font-mono text-[12px] text-ink-2 md:block">{l.value}</div>
      <div className="flex flex-1 justify-end">
        {l.flag && (
          <Chip kind={l.flag.kind} dot>
            {l.flag.label}
          </Chip>
        )}
      </div>
      <ChevronRight className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
    </Link>
  );
}
