import { Shell } from "@/components/shell/Shell";
import { InboxClient } from "@/components/inbox/InboxClient";
import { getInboxData } from "@/lib/inbox";
import { getCurrentUser } from "@/lib/dal";

export default async function InboxPage() {
  const [data, user] = await Promise.all([getInboxData(), getCurrentUser()]);

  return (
    <Shell breadcrumb="INBOX · UNIFIED">
      <InboxClient data={data} ownerEmail={user?.email ?? ""} />
    </Shell>
  );
}
