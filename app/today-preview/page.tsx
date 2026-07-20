import { Shell } from "@/components/shell/Shell";
import { TodayBody } from "@/components/today/TodayBody";
import { getTodayData } from "@/lib/today";
import { todayContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

// Temporary demo route: identical to /today, but with the Today v2 · Phase 7
// model-emitted action chips turned ON, so Joe can try the chip experience for
// a while before it replaces /today. When we're ready to ship it, flip
// enableActionChips on the real /today page and delete this route + its nav
// entry (Sidebar.tsx). See docs/today-interactive-plan.md.
export default async function TodayPreviewPage() {
  const data = await getTodayData();

  return (
    <Shell breadcrumb={`${data.dateLabel} · Preview`} aiContext={todayContext(data)} embeddedAsk>
      <TodayBody data={data} enableActionChips />
    </Shell>
  );
}
