import { Shell } from "@/components/shell/Shell";
import { SiteClient } from "@/components/site/SiteClient";
import { getSiteData } from "@/lib/site";

export default async function SitePage() {
  const data = await getSiteData();

  // hideCmd: the 2-pane editor fills the viewport; the ⌘K pill would overlap.
  return (
    <Shell breadcrumb="SITE · SJCARPENTRYLLC.COM · /admin" hideCmd>
      <SiteClient data={data} />
    </Shell>
  );
}
