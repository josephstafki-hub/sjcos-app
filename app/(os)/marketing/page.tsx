import { Shell } from "@/components/shell/Shell";
import { MarketingClient } from "@/components/marketing/MarketingClient";
import { getMarketingDrafts, getMarketingProjectOptions } from "@/lib/marketing";
import { requireAccess } from "@/lib/dal";

export default async function MarketingPage() {
  const user = await requireAccess("marketing");
  const isOwner = user.role === "owner";
  const [drafts, projects] = await Promise.all([getMarketingDrafts(), getMarketingProjectOptions()]);

  return (
    <Shell breadcrumb="MARKETING">
      <MarketingClient drafts={drafts} projects={projects} isOwner={isOwner} />
    </Shell>
  );
}
