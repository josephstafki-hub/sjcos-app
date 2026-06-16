import { Shell } from "@/components/shell/Shell";
import { LeadsClient } from "@/components/leads/LeadsClient";
import { getLeadsData } from "@/lib/leads";

export default async function LeadsPage() {
  const data = await getLeadsData();

  return (
    <Shell breadcrumb="LEADS">
      <div className="mx-auto max-w-[1100px] px-7 py-6">
        <LeadsClient data={data} />
      </div>
    </Shell>
  );
}
