import { Shell } from "@/components/shell/Shell";
import { TodayBody } from "@/components/today/TodayBody";
import { getTodayData } from "@/lib/today";
import { todayContext } from "@/lib/page-context";

export default async function TodayPage() {
  const data = await getTodayData();

  return (
    <Shell breadcrumb={data.dateLabel} aiContext={todayContext(data)}>
      <TodayBody data={data} />
    </Shell>
  );
}
