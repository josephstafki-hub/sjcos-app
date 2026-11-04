"use client";
import { formatUsPhone } from "@/lib/comms/phone";
import { useState } from "react";
import Link from "next/link";
import { Search, Star } from "lucide-react";
import {
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
import type { VendorsData } from "@/lib/vendors";
export function VendorsClient({ data }: { data: VendorsData }) {
  const [view, setView] = useState("active"),
    [q, setQ] = useState("");
  const vendors = data.vendors.filter(
    (v) =>
      v.archived === (view === "archived") &&
      `${v.name} ${v.trade} ${v.email}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap gap-3">
        <Segmented
          aria-label="Vendor status"
          value={view}
          onChange={setView}
          options={[
            {
              value: "active",
              label: "Active",
              count: data.vendors.filter((v) => !v.archived).length,
            },
            {
              value: "archived",
              label: "Archived",
              count: data.vendors.filter((v) => v.archived).length,
            },
          ]}
        />
        <label className="ml-auto flex h-9 w-full items-center gap-2 rounded-md border border-rule bg-card px-3 @xl/page:w-60">
          <Search className="size-4 shrink-0 text-ink-3" />
          <input
            aria-label="Search vendors"
            type="search"
            placeholder="Search vendors…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full min-w-0 bg-transparent text-body outline-none"
          />
        </label>
      </div>
      <TableWrapper>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Vendor</TableHeader>
              <TableHeader className="@max-2xl/page:hidden">
                Contact
              </TableHeader>
              <TableHeader numeric>POs</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {vendors.map((v) => (
              <TableRow key={v.slug}>
                <TablePrimaryCell meta={v.trade || "Supplier"}>
                  <Link href={`/vendors/${v.slug}`} className="hover:underline">
                    {v.name}
                  </Link>
                  <div className="flex flex-wrap gap-3 text-label">
                    {v.phone && <a href={`tel:${v.phone}`} className="inline-flex min-h-11 items-center rounded-md px-3 text-accent-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">Call</a>}
                    {v.email && <a href={`mailto:${v.email}`} className="inline-flex min-h-11 items-center rounded-md px-3 text-accent-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">Email</a>}
                  </div>
                  {v.fav && (
                    <span role="img" aria-label={`${v.name} is a favorite vendor`} title="Favorite vendor">
                      <Star aria-hidden="true" className="inline size-3 fill-accent text-accent" />
                    </span>
                  )}
                </TablePrimaryCell>
                <TableCell className="@max-2xl/page:hidden">
                  <div className="break-all text-body">
                    {v.email || "No email recorded"}
                  </div>
                  <div className="text-meta text-ink-3">{formatUsPhone(v.phone)}</div>
                </TableCell>
                <TableCell numeric>{v.poCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!vendors.length && (
          <EmptyState
            title="No vendors in this view"
            description="Add a supplier, adjust your search, or open Archived to restore a vendor."
          />
        )}
      </TableWrapper>
    </div>
  );
}
