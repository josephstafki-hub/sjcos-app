import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { Avatar, Card, Chip, Eyebrow } from "@/components/ui";
import { VendorNotes } from "@/components/vendors/VendorNotes";
import { VendorHeaderEdit } from "@/components/vendors/VendorHeaderEdit";
import { getVendor } from "@/lib/vendors";
import { PO_STATUS_LABEL, PO_STATUS_KIND, type PoStatus } from "@/lib/po-types";

export default async function VendorDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vendor = await getVendor(slug);
  if (!vendor) notFound();

  return (
    <Shell breadcrumb="VENDORS · DIRECTORY">
      <div className="mx-auto max-w-[900px] px-4 pb-16 pt-6 sm:px-7">
        <Link href="/vendors" className="text-[12px] font-semibold text-ink-3 hover:text-ink">
          ← All vendors
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar initials={vendor.initials} kind={vendor.fav ? "accent" : "gray"} size="lg" />
            <div>
              <Eyebrow muted>{vendor.trade || "Vendor"}</Eyebrow>
              <h1 className="font-serif text-[28px] font-medium leading-none tracking-tight text-accent-2">
                {vendor.name}
              </h1>
              <div className="mt-1 text-[12px] text-ink-3">
                {vendor.email || "—"}
                {vendor.phone ? ` · ${vendor.phone}` : ""}
              </div>
            </div>
          </div>
          <VendorHeaderEdit slug={vendor.slug} name={vendor.name} trade={vendor.trade} email={vendor.email} phone={vendor.phone} fav={vendor.fav} />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_320px]">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-rule px-4 py-2.5">
              <h3 className="font-serif text-[15px] font-semibold text-ink">
                Purchase orders · {vendor.purchaseOrders.length}
              </h3>
            </div>
            {vendor.purchaseOrders.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-ink-3">No purchase orders yet.</div>
            ) : (
              vendor.purchaseOrders.map((po, i) => (
                <Link
                  key={`${po.projectSlug}-${po.poNumber}`}
                  href={`/projects/${po.projectSlug}`}
                  className={`flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-paper-2 ${i ? "border-t border-rule-soft" : ""}`}
                >
                  <span className="w-[64px] flex-none font-mono text-[11px] text-ink-3">{po.poNumber}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ink">{po.title}</div>
                    <div className="text-[11px] text-ink-3">{po.projectName} · {po.createdLabel}</div>
                  </div>
                  <Chip kind={PO_STATUS_KIND[po.status as PoStatus] ?? "ghost"}>{PO_STATUS_LABEL[po.status as PoStatus] ?? po.status}</Chip>
                  <span className="font-mono text-[12px] text-ink-2">{po.subtotalLabel}</span>
                </Link>
              ))
            )}
          </Card>

          <VendorNotes slug={vendor.slug} notes={vendor.notes} />
        </div>
      </div>
    </Shell>
  );
}
