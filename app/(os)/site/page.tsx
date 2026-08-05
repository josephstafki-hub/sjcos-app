import { Shell } from "@/components/shell/Shell";
import { SiteClient } from "@/components/site/SiteClient";
import { getSiteComposerData } from "@/lib/site";

export default async function SitePage() {
  const data = await getSiteComposerData();

  return (
    <Shell breadcrumb="WEBSITE · CONTENT COMPOSER · BLOG">
      <SiteClient posts={data.posts} projects={data.projects} />
    </Shell>
  );
}
