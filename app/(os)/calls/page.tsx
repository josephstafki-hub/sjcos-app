import { Shell } from "@/components/shell/Shell";
import { CallsClient } from "@/components/calls/CallsClient";
import { requireAccess } from "@/lib/dal";
import { listCalls, voiceConfigured, voiceStatus } from "@/lib/voice";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Phone calls on the business number: inbound (forwarded to Joe's cell),
 *  voicemails, and click-to-call. Recording, transcript and AI notes per call,
 *  plus the hand-ticked discovery checklist (docs/plans/discovery-call-plan.md).
 *  ?open=<call-id>[&view=checklist] selects a call (the push links use it);
 *  ?checklist=<session-id> opens a checklist that has no call. */
export default async function CallsPage({ searchParams }: { searchParams: Promise<{ open?: string; view?: string; checklist?: string }> }) {
  const user = await requireAccess("comms");
  const { open, view, checklist } = await searchParams;
  const calls = await listCalls(150);
  const status = voiceStatus();
  return (
    <Shell breadcrumb="MESSAGES · CALLS">
      <CallsClient calls={calls} configured={voiceConfigured()} problems={status.enabled ? status.problems : []}
        openId={open ?? null} view={view ?? null} checklistId={checklist && UUID.test(checklist) ? checklist : null} userId={user.id} />
    </Shell>
  );
}
