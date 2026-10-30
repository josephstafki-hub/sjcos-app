import { formatUsPhone } from "@/lib/comms/phone";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import {
  Button,
  Card,
  Chip,
  PageHeader,
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
import { VendorNotes } from "@/components/vendors/VendorNotes";
import { VendorHeaderEdit } from "@/components/vendors/VendorHeaderEdit";
import { DirectoryRecordMenu } from "@/components/subs/DirectoryRecordMenu";
import { getVendor } from "@/lib/vendors";
import { PO_STATUS_LABEL, PO_STATUS_KIND, type PoStatus } from "@/lib/po-types";
export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const vendor = await getVendor(slug);
  if (!vendor) notFound();
  return (
    <Shell breadcrumb={`VENDORS › ${vendor.name}`}>
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 @2xl/page:px-7">
        <PageHeader
          variant="record"
          title={vendor.name}
          badge={vendor.archived ? <Chip>Archived</Chip> : undefined}
          meta={vendor.trade || "Materials supplier"}
          actions={
            <>
              {vendor.phone && <Button href={`tel:${vendor.phone}`} variant="secondary" className="min-h-11">Call</Button>}
              {vendor.email && <Button href={`mailto:${vendor.email}`} variant="secondary" className="min-h-11">Email</Button>}
              <VendorHeaderEdit {...vendor} />
              <DirectoryRecordMenu table="vendors" {...vendor} />
            </>
          }
        />
        {vendor.archived && (
          <p className="mt-4 rounded-md bg-neutral-soft px-3 py-2 text-body text-ink-2">
            Archived · purchase orders and notes are preserved. Use the actions
            menu to restore this vendor.
          </p>
        )}
        <div className="mt-6 grid min-w-0 grid-cols-1 gap-6 @4xl/page:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <h2 className="mb-3 font-serif text-heading font-semibold">
              Purchase orders{" "}
              <span className="ml-1 font-sans text-meta font-normal text-ink-3">
                {vendor.purchaseOrders.length}
              </span>
            </h2>
            <TableWrapper>
              <Table density="compact">
                <TableHead>
                  <TableRow>
                    <TableHeader>Order</TableHeader>
                    <TableHeader className="@max-2xl/page:hidden">
                      Status
                    </TableHeader>
                    <TableHeader numeric>Total</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {vendor.purchaseOrders.map((po) => (
                    <TableRow key={`${po.projectSlug}-${po.poNumber}`}>
                      <TablePrimaryCell
                        meta={
                          <>
                            {po.projectName} · {po.createdLabel}
                            <span className="ml-2 @2xl/page:hidden">
                              {PO_STATUS_LABEL[po.status as PoStatus] ??
                                po.status}
                            </span>
                          </>
                        }
                      >
                        <Link
                          href={`/projects/${po.projectSlug}?tab=Money`}
                          className="hover:underline"
                        >
                          <span className="mr-2 font-mono text-meta font-normal text-ink-3">
                            {po.poNumber}
                          </span>
                          {po.title}
                        </Link>
                      </TablePrimaryCell>
                      <TableCell className="@max-2xl/page:hidden">
                        <Chip
                          kind={
                            PO_STATUS_KIND[po.status as PoStatus] ?? "ghost"
                          }
                        >
                          {PO_STATUS_LABEL[po.status as PoStatus] ?? po.status}
                        </Chip>
                      </TableCell>
                      <TableCell numeric className="whitespace-nowrap">
                        {po.subtotalLabel}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!vendor.purchaseOrders.length && (
                <EmptyState
                  title="No purchase orders yet"
                  description="Orders created for this vendor on a project appear here with their status and total."
                />
              )}
            </TableWrapper>
            <div className="mt-6">
              <VendorNotes slug={slug} notes={vendor.notes} />
            </div>
          </div>
          <aside className="order-first min-w-0 @4xl/page:order-last">
            <Card className="p-4">
              <h2 className="mb-4 text-subheading font-semibold">Details</h2>
              <dl className="space-y-4 text-body">
                {[
                  ["Category", vendor.trade || "Not recorded"],
                  ["Email", vendor.email || "Not recorded"],
                  ["Phone", formatUsPhone(vendor.phone) || "Not recorded"],
                  ["Favorite", vendor.fav ? "Yes" : "No"],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[80px_1fr] gap-3">
                    <dt className="text-meta text-ink-3">{k}</dt>
                    <dd className="min-w-0 break-words [overflow-wrap:anywhere]">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </aside>
        </div>
      </div>
    </Shell>
  );
}
