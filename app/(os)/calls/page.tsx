import { Shell } from "@/components/shell/Shell";
import { CallsClient } from "@/components/calls/CallsClient";
import { requireAccess } from "@/lib/dal";
import { listCalls, voiceConfigured, voiceStatus } from "@/lib/voice";
import { linesForViewer } from "@/lib/phone-lines";

export const dynamic = "force-dynamic";

/** Phone calls on the business number: inbound (forwarded to Joe's cell),
 *  voicemails, and click-to-call. Recording, transcript and AI notes per call.
 *  ?open=<id> selects a call (the push links use it). */
export default async function CallsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const user = await requireAccess("comms");
  const { open } = await searchParams;
  // Owner: every line's calls; a team member: the company lines + their own.
  const [calls, lines] = await Promise.all([listCalls(150, user), linesForViewer(user, "voice")]);
  const status = voiceStatus();
  return (
    <Shell breadcrumb="MESSAGES · CALLS">
      <CallsClient calls={calls} configured={voiceConfigured()} problems={status.enabled ? status.problems : []} openId={open ?? null} lines={lines} />
    </Shell>
  );
}
