import { Shell } from "@/components/shell/Shell";
import { MessagesClient } from "@/components/messages/MessagesClient";
import { getSmsThreads, getSmsLinkOptions, smsConfigured, smsStatus } from "@/lib/sms";
import { voiceConfigured } from "@/lib/voice";
import { requireRole } from "@/lib/dal";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  await requireRole("owner");
  const [threads, linkOptions] = await Promise.all([getSmsThreads(), getSmsLinkOptions()]);
  const status = smsStatus();

  return (
    <Shell breadcrumb="MESSAGES · SMS">
      <MessagesClient
        threads={threads}
        linkOptions={linkOptions}
        configured={smsConfigured()}
        problems={status.enabled ? status.problems : []}
        voiceConfigured={voiceConfigured()}
      />
    </Shell>
  );
}
