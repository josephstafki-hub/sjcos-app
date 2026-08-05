import { Shell } from "@/components/shell/Shell";
import { MarketingClient } from "@/components/marketing/MarketingClient";
import { getMarketingDrafts, getMarketingProjectOptions } from "@/lib/marketing";

export default async function MarketingPage() {
  const [drafts, projects] = await Promise.all([
    getMarketingDrafts(),
    getMarketingProjectOptions(),
  ]);

  return (
    <Shell breadcrumb="MARKETING">
      <MarketingClient drafts={drafts} projects={projects} />
    </Shell>
  );
}
