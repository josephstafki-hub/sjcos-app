import { Shell } from "@/components/shell/Shell";
import { CallsClient } from "@/components/calls/CallsClient";
import { requireRole } from "@/lib/dal";
import { listCalls, voiceConfigured, voiceStatus } from "@/lib/voice";

export const dynamic = "force-dynamic";

/** Phone calls on the business number: inbound (forwarded to Joe's cell),
 *  voicemails, and click-to-call. Recording, transcript and AI notes per call.
 *  ?open=<id> selects a call (the push links use it). */
export default async function CallsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  await requireRole("owner");
  const { open } = await searchParams;
  const calls = await listCalls(150);
  const status = voiceStatus();
  return (
    <Shell breadcrumb="MESSAGES · CALLS">
      <CallsClient calls={calls} configured={voiceConfigured()} problems={status.enabled ? status.problems : []} openId={open ?? null} />
    </Shell>
  );
}
