"use client";
import { useState } from "react";
import Link from "next/link";
import { Search, Star } from "lucide-react";
import {
  Button,
  Chip,
  Segmented,
  EmptyState,
  TableWrapper,
  Table,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TablePrimaryCell,
  TableCell,
} from "@/components/ui";
import type { SubsData } from "@/lib/subs";
export function SubsClient({ data }: { data: SubsData }) {
  const [trade, setTrade] = useState("All"),
    [view, setView] = useState("active"),
    [q, setQ] = useState("");
  const [missingCoi, setMissingCoi] = useState(false);
  const subs = data.subs.filter(
    (s) =>
      s.archived === (view === "archived") &&
      (trade === "All" || s.tradeKey === trade) &&
      (!missingCoi || s.coiStatus === "missing") &&
      `${s.name} ${s.trade}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          aria-label="Directory status"
          value={view}
          onChange={setView}
          options={[
            {
              value: "active",
              label: "Active",
              count: data.subs.filter((s) => !s.archived).length,
            },
            {
              value: "archived",
              label: "Archived",
              count: data.subs.filter((s) => s.archived).length,
            },
          ]}
        />
        <label className="ml-auto flex h-9 w-full items-center gap-2 rounded-md border border-rule bg-card px-3 @xl/page:w-60">
          <Search className="size-4 shrink-0 text-ink-3" />
          <input
            type="search"
            aria-label="Search subs"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or trade…"
            className="w-full min-w-0 bg-transparent text-body outline-none"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-2 text-label text-ink-3">
          Trade
          <select
            aria-label="Trade"
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            className="h-8 rounded-md border border-rule bg-card px-2 text-body text-ink"
          >
            {data.trades.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <Button variant={missingCoi ? "primary" : "secondary"} size="sm" aria-pressed={missingCoi} onClick={() => setMissingCoi(!missingCoi)}>Missing COI</Button>
        <span className="self-center text-meta text-ink-3">
          {subs.length} shown · {data.subs.filter((s) => s.archived === (view === "archived") && s.coiStatus === "missing").length} missing COI
        </span>
      </div>
      <TableWrapper>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Subcontractor</TableHeader>
              <TableHeader className="w-24 whitespace-nowrap @max-2xl/page:hidden">Rating</TableHeader>
              <TableHeader numeric className="w-24 whitespace-nowrap @max-xl/page:hidden">
                Open jobs
              </TableHeader>
              <TableHeader className="w-28">COI</TableHeader>
              <TableHeader className="@max-3xl/page:hidden">Rate</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {subs.map((s) => (
              <TableRow key={s.slug}>
                <TablePrimaryCell
                  meta={
                    <>
                      {s.trade}
                      <span className="ml-2 @xl/page:hidden">
                        · {s.openJobs} open
                      </span>
                    </>
                  }
                >
                  <Link href={`/subs/${s.slug}`} className="hover:underline">
                    {s.name}
                  </Link>
                  {s.fav && (
                    <Star
                      aria-label="Preferred"
                      className="ml-2 inline size-3 fill-accent text-accent"
                    />
                  )}
                </TablePrimaryCell>
                <TableCell className="w-24 whitespace-nowrap @max-2xl/page:hidden">
                  {s.rating ? `${s.rating} / 5` : "Not rated"}
                </TableCell>
                <TableCell numeric className="w-24 whitespace-nowrap @max-xl/page:hidden">
                  {s.openJobs}
                </TableCell>
                <TableCell>
                  <Chip
                    kind={
                      s.coiStatus === "current"
                        ? "ok"
                        : s.coiStatus === "expiring"
                          ? "warn"
                          : "flag"
                    }
                  >
                    {s.coiStatus === "current"
                      ? "COI current"
                      : s.coiStatus === "expiring"
                        ? "COI expiring"
                        : s.coiStatus === "expired"
                          ? "COI expired"
                          : "COI missing"}
                  </Chip>
                  <Link href={`/subs/${s.slug}?tab=Paperwork`} className="mt-2 block text-label text-accent-2 hover:underline">{s.coiStatus === "current" ? "View COI" : "Review / add COI"} →</Link>
                </TableCell>
                <TableCell className="@max-3xl/page:hidden">
                  {s.rate || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!subs.length && (
          <EmptyState
            title={
              view === "archived" ? "No archived subs" : "No matching subs"
            }
            description={
              view === "archived"
                ? "Archived subcontractors appear here. Open a record to restore it."
                : "Onboard a subcontractor or adjust the search and trade filter."
            }
          />
        )}
      </TableWrapper>
    </div>
  );
}
