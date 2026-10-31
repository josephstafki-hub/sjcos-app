import { Shell } from "@/components/shell/Shell";
import { MarketingClient } from "@/components/marketing/MarketingClient";
import { getMarketingDrafts, getMarketingProjectOptions } from "@/lib/marketing";
import { getPostingAccounts } from "@/lib/publisher/server";
import { requireAccess } from "@/lib/dal";

export default async function MarketingPage() {
  const user = await requireAccess("marketing");
  const isOwner = user.role === "owner";
  const [drafts, projects, accounts] = await Promise.all([
    getMarketingDrafts(),
    getMarketingProjectOptions(),
    isOwner ? getPostingAccounts() : Promise.resolve(null),
  ]);

  return (
    <Shell breadcrumb="MARKETING">
      <MarketingClient drafts={drafts} projects={projects} isOwner={isOwner} accounts={accounts} />
    </Shell>
  );
}
