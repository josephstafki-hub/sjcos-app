"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import {
  EmptyState,
  Segmented,
  Table,
  TableBody,
  TableCell,
  TableGroupRow,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from "@/components/ui";
import type { ProjectGroup } from "@/lib/projects";

const FILTERS = [
  { value: "all", label: "All open" },
  { value: "active", label: "On site" },
  { value: "pre_construction", label: "Pre-con" },
  { value: "closeout", label: "Closeout" },
  { value: "warranty", label: "Warranty" },
];

export function ProjectsClient({ groups }: { groups: ProjectGroup[] }) {
  const [filter, setFilter] = useState("all");
  const shown =
    filter === "all" ? groups : groups.filter((g) => g.key === filter);
  return (
    <div className="space-y-4">
      <Segmented
        aria-label="Project stage"
        value={filter}
        onChange={setFilter}
        options={FILTERS.map((f) => ({
          ...f,
          count: groups
            .filter((g) => f.value === "all" || g.key === f.value)
            .reduce((n, g) => n + g.items.length, 0),
        }))}
      />
      {!shown.length ? (
        <EmptyState
          title="No projects in this view"
          description="Projects appear here as they move into this stage. Choose All open to see your other jobs."
        />
      ) : (
        <TableWrapper>
          <Table>
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
                          className="block break-words text-subheading font-semibold text-ink hover:text-accent after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-focus"
                        >
                          {p.name}
                        </Link>
                        {p.sub && (
                          <div className="text-meta text-ink-3">{p.sub}</div>
                        )}
                        <div className="text-meta text-ink-2 @4xl/page:hidden">
                          {p.stage}
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
                        <div className="truncate text-ink-2" title={p.stage}>
                          {p.stage}
                        </div>
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
