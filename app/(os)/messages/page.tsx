import { Shell } from "@/components/shell/Shell";
import { MessagesClient } from "@/components/messages/MessagesClient";
import { getSmsThreads, getSmsLinkOptions, smsConfigured, smsStatus } from "@/lib/sms";
import { voiceConfigured } from "@/lib/voice";
import { requireAccess } from "@/lib/dal";
import { linesForViewer } from "@/lib/phone-lines";

export const dynamic = "force-dynamic";

export default async function MessagesPage({searchParams}:{searchParams:Promise<{thread?:string}>}) {
  const {thread}=await searchParams;
  const initialThreadId=thread&&/^\d+$/.test(thread)?Number(thread):undefined;
  const user = await requireAccess("comms");
  // Owner: every line's conversations; a team member: the company lines + their own.
  const [threads, linkOptions, lines] = await Promise.all([getSmsThreads(user), getSmsLinkOptions(), linesForViewer(user, "sms")]);
  const status = smsStatus();

  return (
    <Shell breadcrumb="MESSAGES · SMS">
      <MessagesClient
        initialThreadId={initialThreadId}
        threads={threads}
        linkOptions={linkOptions}
        configured={smsConfigured()}
        problems={status.enabled ? status.problems : []}
        voiceConfigured={voiceConfigured()}
        lines={lines}
      />
    </Shell>
  );
}
