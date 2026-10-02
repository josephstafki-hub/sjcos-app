import { Shell } from "@/components/shell/Shell";
import { InboxClient } from "@/components/inbox/InboxClient";
import { getInboxData } from "@/lib/inbox";
import { requireAccess } from "@/lib/dal";

export default async function InboxPage() {
  // requireAccess first, so the viewer is in hand for getInboxData — the inbox
  // is read through THIS person's linked mailbox (lib/mailbox.ts), not the one
  // account that used to live in GMAIL_REFRESH_TOKEN.
  const user = await requireAccess("inbox");
  const data = await getInboxData(user);

  return (
    <Shell breadcrumb="INBOX · UNIFIED">
      {/* Compose's To: prefill — the connected address when there is one, else
          their login email. Never someone else's. */}
      <InboxClient data={data} selfEmail={data.mailbox.email ?? user.email} />
    </Shell>
  );
}
