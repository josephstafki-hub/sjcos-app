import { Shell } from "@/components/shell/Shell";
import { MessagesClient } from "@/components/messages/MessagesClient";
import { getSmsThreads, getSmsLinkOptions, smsConfigured } from "@/lib/sms";
import { requireRole } from "@/lib/dal";

export default async function MessagesPage() {
  await requireRole("owner");
  const [threads, linkOptions] = await Promise.all([getSmsThreads(), getSmsLinkOptions()]);

  return (
    <Shell breadcrumb="MESSAGES · SMS" hideCmd>
      <MessagesClient threads={threads} linkOptions={linkOptions} configured={smsConfigured()} />
    </Shell>
  );
}
