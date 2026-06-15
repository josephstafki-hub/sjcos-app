import { Shell } from "@/components/shell/Shell";
import { InboxClient } from "@/components/inbox/InboxClient";
import { getInboxData } from "@/lib/inbox";

export default async function InboxPage() {
  const data = await getInboxData();

  // hideCmd: the reader's bottom composer occupies the spot the ⌘K pill floats in.
  return (
    <Shell breadcrumb="INBOX · UNIFIED" hideCmd>
      <InboxClient data={data} />
    </Shell>
  );
}
