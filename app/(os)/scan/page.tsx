import { redirect } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { ScanReceipt, type ScanJob } from "@/components/unsorted/ScanReceipt";
import { runDirect } from "@/lib/commands/db";
import { can, homeFor, requireUser } from "@/lib/dal";

export const dynamic = "force-dynamic";

/** Phone-first: photograph a receipt and send it in. Claude reads it and files
 *  it to the job, or leaves it on /unsorted (lib/receipt-scan.ts). Open to
 *  everyone on the team — sending a receipt in shows no money. */
export default async function ScanPage() {
  const user = await requireUser();
  if (user.role !== "owner" && user.role !== "staff") redirect(homeFor(user));
  const jobs = await runDirect<ScanJob>(
    `SELECT slug, name, client_name FROM projects WHERE status <> 'warranty' ORDER BY updated_at DESC`);
  return (
    <Shell breadcrumb="MONEY · SCAN RECEIPT">
      <ScanReceipt jobs={jobs} canSort={can(user, "money")} />
    </Shell>
  );
}
