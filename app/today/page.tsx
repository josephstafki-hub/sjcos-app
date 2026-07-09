import { Shell } from "@/components/shell/Shell";
import { TodayBody } from "@/components/today/TodayBody";
import { getTodayData } from "@/lib/today";
import { todayContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const data = await getTodayData();

  return (
    <Shell breadcrumb={data.dateLabel} aiContext={todayContext(data)} embeddedAsk>
      <TodayBody data={data} embedAsk />
    </Shell>
  );
}
