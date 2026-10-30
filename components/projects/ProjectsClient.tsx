"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import {
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableGroupRow,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui";
import { NextStep } from "./NextStep";
import type { ProjectGroup } from "@/lib/projects";

const FILTERS = [
  { value: "all", label: "All open" },
  { value: "active", label: "On site" },
  { value: "pre_construction", label: "Pre-con" },
  { value: "closeout", label: "Closeout" },
  { value: "warranty", label: "Warranty" },
];

export function ProjectsClient({ groups, initialFilter }: { groups: ProjectGroup[]; initialFilter?: string }) {
  const [filter, setFilter] = useState(FILTERS.some(f => f.value === initialFilter) ? initialFilter! : "all");
  const [query, setQuery] = useState("");
  const shown =
    (filter === "all" ? groups : groups.filter((g) => g.key === filter))
      .map((g) => ({ ...g, items: g.items.filter((p) => `${p.name} ${p.sub} ${p.stage}`.toLowerCase().includes(query.trim().toLowerCase())) }))
      .filter((g) => g.items.length > 0);
  return (
    <div className="space-y-4">
      <input type="search" aria-label="Search projects" placeholder="Search projects or next steps…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-11 w-full rounded-md border border-rule bg-card px-3 text-body @xl/page:h-9" />
      <label className="flex min-w-0 items-center gap-2 text-label">
        Project stage
        <select aria-label="Project stage" value={filter} onChange={e => setFilter(e.target.value)} className="h-11 min-w-0 flex-1 rounded-md border border-rule bg-card px-2 text-body">
          {FILTERS.map(f => <option key={f.value} value={f.value}>{f.label} ({groups.filter(g => f.value === "all" || g.key === f.value).reduce((n, g) => n + g.items.length, 0)})</option>)}
        </select>
      </label>
      {!shown.length ? (
        <EmptyState
          title="No projects in this view"
          description="Projects appear here as they move into this stage. Choose All open to see your other jobs."
        />
      ) : (
        <TableWrapper>
          <Table className="table-fixed">
            <TableHead>
              <tr>
                <TableHeader className="@xl/page:min-w-[220px]">
                  Project
                </TableHeader>
                <TableHeader className="hidden @4xl/page:table-cell">
                  Next step
                </TableHeader>
                <TableHeader className="hidden @2xl/page:table-cell">
                  Paid
                </TableHeader>
                <TableHeader numeric className="hidden @xl/page:table-cell">
                  Paid / Total
                </TableHeader>
              </tr>
            </TableHead>
            <TableBody>
              {shown.map((g) => (
                <Fragment key={g.key}>
                  <TableGroupRow colSpan={4} count={g.items.length}>
                    {g.title}
                  </TableGroupRow>
                  {g.items.map((p) => (
                    <TableRow key={p.slug} className="relative">
                      <TableCell twoLine className="@xl/page:min-w-[220px]">
                        <Link
                          href={`/projects/${p.slug}`}
                          className="block break-words text-subheading font-semibold text-ink hover:text-accent focus-visible:outline-2 focus-visible:outline-focus"
                        >
                          {p.name}
                        </Link>
                        {p.sub && (
                          <div className="line-clamp-1 text-meta text-ink-3">{p.sub}</div>
                        )}
                        <div className="min-w-0 @4xl/page:hidden">
                          <NextStep text={p.stage} />
                        </div>
                        <div className="mt-1 tabular-nums text-meta text-ink-3 @xl/page:hidden">
                          {p.hasTotal
                            ? `${p.paid} / ${p.value} · ${p.billed}% paid`
                            : p.value
                              ? `${p.value} estimated · No job total yet`
                              : "No job total yet"}
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-64 @4xl/page:table-cell">
                        <NextStep text={p.stage} />
                      </TableCell>
                      <TableCell className="hidden w-28 @2xl/page:table-cell">
                        {p.hasTotal ? (
                          <>
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-paper-3">
                              <div
                                className="h-full bg-accent"
                                style={{
                                  width: `${Math.min(100, Math.max(0, p.billed))}%`,
                                }}
                              />
                            </div>
                            <div className="mt-1 text-meta text-ink-3 tabular-nums">
                              {p.billed}%
                            </div>
                          </>
                        ) : (
                          <span className="text-meta text-ink-3">—</span>
                        )}
                      </TableCell>
                      <TableCell numeric className="hidden @xl/page:table-cell">
                        {p.hasTotal ? (
                          <span className="whitespace-nowrap">
                            {p.paid}{" "}
                            <span className="text-ink-3">/ {p.value}</span>
                          </span>
                        ) : (
                          <>
                            <div className="text-meta text-ink-3">
                              No job total yet
                            </div>
                            {p.value && (
                              <div className="text-meta text-ink-3">
                                {p.value} estimated
                              </div>
                            )}
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>
      )}
    </div>
  );
}
