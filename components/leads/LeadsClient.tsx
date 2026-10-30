"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Chip,
  EmptyState,
  PageHeader,
  Segmented,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui";
import { NewLeadButton } from "./NewLeadButton";
import type { LeadsData } from "@/lib/leads";

const FILTERS = [
  { value: "All", label: "All" },
  { value: "hot", label: "Hot" },
  { value: "cooling", label: "Cooling" },
  { value: "lost", label: "Lost / Archived" },
];
export function LeadsClient({ data }: { data: LeadsData }) {
  const [filter, setFilter] = useState("All");
  const [stage, setStage] = useState("all");
  const active = data.leads.filter((l) => l.stage !== "lost");
  const filtered = data.leads.filter((l) =>
    filter === "lost"
      ? l.stage === "lost"
      : l.stage !== "lost" && (filter === "All" || l.temperature === filter),
  );
  const visible = filtered.filter((l) => stage === "all" || l.stage === stage);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads"
        meta={data.summary}
        actions={<NewLeadButton />}
      />
      <Segmented
        aria-label="Lead filters"
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setStage("all");
        }}
        options={FILTERS.map((f) => ({
          ...f,
          count:
            f.value === "All"
              ? active.length
              : data.leads.filter((l) =>
                  f.value === "lost"
                    ? l.stage === "lost"
                    : l.stage !== "lost" && l.temperature === f.value,
                ).length,
        }))}
      />
      {filter !== "lost" && (
        <div>
          <Segmented
            aria-label="Pipeline stage"
            value={stage}
            onChange={setStage}
            options={[
              { value: "all", label: "All stages", count: filtered.length },
              ...data.stages.map((s) => ({
                value: s.key,
                label: s.label,
                count: filtered.filter((l) => l.stage === s.key).length,
              })),
            ]}
          />
        </div>
      )}
      {!visible.length ? (
        <EmptyState
          title="No leads in this view"
          description="New inquiries appear here. Choose another filter or add a new lead."
        />
      ) : (
        <TableWrapper>
          <Table>
            <TableHead>
              <tr>
                <TableHeader>Lead</TableHeader>
                <TableHeader className="hidden @4xl/page:table-cell">
                  Scope
                </TableHeader>
                <TableHeader className="hidden @xl/page:table-cell">
                  Stage
                </TableHeader>
                <TableHeader numeric className="hidden @2xl/page:table-cell">
                  Value
                </TableHeader>
                <TableHeader className="hidden @5xl/page:table-cell">
                  AI take
                </TableHeader>
              </tr>
            </TableHead>
            <TableBody>
              {visible.map((l) => (
                <TableRow key={l.slug} className="relative">
                  <TableCell twoLine className="@xl/page:min-w-[180px]">
                    <Link
                      href={`/leads/${l.slug}`}
                      className="block break-words text-subheading font-semibold text-ink hover:text-accent after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      {l.name}
                    </Link>
                    <div className="text-meta text-ink-3">
                      {l.ageDays}d since first contact
                    </div>
                    <div className="text-meta text-ink-2 @4xl/page:hidden">
                      {l.scope}
                    </div>
                    <div className="mt-1 text-meta text-ink-3 @xl/page:hidden">
                      {l.stageLabelText}
                      {l.value && l.value !== "?" ? ` · ${l.value}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-60 @4xl/page:table-cell">
                    <div className="truncate text-ink-2" title={l.scope}>
                      {l.scope || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="hidden @xl/page:table-cell">
                    <Chip kind={l.stageAdvanced ? "accent" : "ghost"}>
                      {l.stageLabelText}
                    </Chip>
                  </TableCell>
                  <TableCell
                    numeric
                    className="hidden whitespace-nowrap @2xl/page:table-cell"
                  >
                    {l.value === "?" ? "—" : l.value || "—"}
                  </TableCell>
                  <TableCell className="hidden max-w-52 @5xl/page:table-cell">
                    <div className="text-meta text-ink-2">
                      {l.flag?.label || "—"}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>
      )}
    </div>
  );
}
