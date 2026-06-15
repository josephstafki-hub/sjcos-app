import { Shell } from "@/components/shell/Shell";
import { TodayBody } from "@/components/today/TodayBody";
import { getTodayData } from "@/lib/today";

export default async function TodayPage() {
  const data = await getTodayData();

  return (
    <Shell breadcrumb={data.dateLabel}>
      <TodayBody data={data} />
    </Shell>
  );
}
