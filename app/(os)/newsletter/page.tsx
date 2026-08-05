import { Shell } from "@/components/shell/Shell";
import { NewsletterClient } from "@/components/newsletter/NewsletterClient";
import { getNewsletterData } from "@/lib/newsletter";

export default async function NewsletterPage() {
  const data = await getNewsletterData();

  return (
    <Shell breadcrumb="NEWSLETTER">
      <NewsletterClient data={data} />
    </Shell>
  );
}
