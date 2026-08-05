import { Shell } from "@/components/shell/Shell";
import { TodayBody } from "@/components/today/TodayBody";
import { getTodayData } from "@/lib/today";

// Deep-link to the command bar: renders the Today dashboard behind the open
// overlay (matches the design). The bar is global in Shell — Ctrl/⌘+K opens it
// from any page; this route just opens it on mount.
export default async function CmdkPage() {
  const data = await getTodayData();

  return (
    <Shell breadcrumb={data.dateLabel} cmdkOpen>
      <TodayBody data={data} />
    </Shell>
  );
}
