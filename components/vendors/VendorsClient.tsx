"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import { Avatar, Card, Chip } from "@/components/ui";
import type { VendorCard, VendorsData } from "@/lib/vendors";

export function VendorsClient({ data }: { data: VendorsData }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.vendors.map((v) => (
        <VendorGridCard key={v.slug} vendor={v} />
      ))}
      {data.vendors.length === 0 && (
        <Card kind="dashed" className="col-span-full p-8 text-center">
          <div className="text-[13px] text-ink-3">No vendors yet — add one, or save a one-off supplier from a purchase order.</div>
        </Card>
      )}
    </div>
  );
}

function VendorGridCard({ vendor: v }: { vendor: VendorCard }) {
  return (
    <Link href={`/vendors/${v.slug}`} className="block">
      <Card className="p-3.5 transition-colors hover:bg-paper-2">
        <div className="flex items-start gap-2.5">
          <Avatar initials={v.initials} kind={v.fav ? "accent" : "gray"} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="flex-1 truncate font-serif text-[14px] font-semibold text-ink">{v.name}</span>
              {v.fav && <Star className="size-3 flex-none fill-accent text-accent" strokeWidth={1.5} />}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-3">{v.trade || "—"}</div>
          </div>
        </div>

        <div className="my-3 border-t border-dashed border-rule" />

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip kind="ghost">{v.poCount} PO{v.poCount === 1 ? "" : "s"}</Chip>
          {v.email && <Chip kind="ghost">{v.email}</Chip>}
        </div>
      </Card>
    </Link>
  );
}
