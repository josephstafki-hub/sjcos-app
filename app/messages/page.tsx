import { Shell } from "@/components/shell/Shell";
import { MessagesClient } from "@/components/messages/MessagesClient";
import { getSmsThreads, smsConfigured } from "@/lib/sms";
import { requireRole } from "@/lib/dal";

export default async function MessagesPage() {
  await requireRole("owner");
  const threads = await getSmsThreads();

  return (
    <Shell breadcrumb="MESSAGES · SMS" hideCmd>
      <MessagesClient threads={threads} configured={smsConfigured()} />
    </Shell>
  );
}
