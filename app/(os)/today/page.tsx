import { Shell } from "@/components/shell/Shell";
import { TodayBody } from "@/components/today/TodayBody";
import { getTodayData } from "@/lib/today";
import { todayContext } from "@/lib/page-context";
import { requireAccess } from "@/lib/dal";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  // Today is one person's queue now: the owner's whole board, or a team
  // member's assigned to-dos (lib/today.ts).
  const data = await getTodayData(await requireAccess("today"));

  return (
    <Shell breadcrumb={data.dateLabel} aiContext={todayContext(data)}>
      <TodayBody data={data} />
    </Shell>
  );
}
