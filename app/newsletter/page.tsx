import { Shell } from "@/components/shell/Shell";
import { NewsletterClient } from "@/components/newsletter/NewsletterClient";
import { getNewsletterData } from "@/lib/newsletter";

export default async function NewsletterPage() {
  const data = await getNewsletterData();

  return (
    <Shell breadcrumb="NEWSLETTER · MAY ISSUE (DRAFT)" hideCmd>
      <NewsletterClient data={data} />
    </Shell>
  );
}
