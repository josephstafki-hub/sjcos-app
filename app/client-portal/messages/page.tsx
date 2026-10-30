import { requireRole } from "@/lib/dal";
import { Eyebrow } from "@/components/ui";
import { portalScope } from "@/lib/client-portal";
import { getPortalThread, portalChannel } from "@/lib/portal-messages";
import { PortalMessenger } from "@/components/portal/PortalMessenger";

// Client-portal messages: the full owner ⇄ client thread with the composer.
// One thread per scope (chat_messages channel portal:<slug>, or
// portal:lead:<slug> during the lead stage — the thread is renamed onto the
// project on conversion); Joe sees it in the project's / the lead's
// Client portal tab and gets a notification on every send.
export default async function PortalMessagesPage() {
  const user = await requireRole("owner", "client");
  const scope = await portalScope();
  const channelSlug = scope ? (scope.kind === "lead" ? `lead:${scope.slug}` : scope.slug) : null;
  const thread = channelSlug ? await getPortalThread(portalChannel("client", channelSlug)) : [];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-8 [&>*]:max-w-2xl">
      <Eyebrow>Messages</Eyebrow>
      <h1 className="mt-1 font-serif text-title font-medium leading-tight text-accent-2">
        Talk to Joe.
      </h1>
      <p className="mt-1.5 text-body leading-relaxed text-ink-2">
        Questions, changes, schedule — it all lands straight with Joe, attached to your
        project.
      </p>
      <div className="my-5 border-t border-rule" />
      {!scope && <p className="mb-4 text-body text-ink-2">No project selected. This preview cannot send messages.</p>}
      {thread.length === 0 && <div className="mb-4 rounded-lg border border-rule-soft bg-card p-4"><h2 className="text-subheading font-semibold text-ink">Your conversation starts here</h2><p className="mt-1 text-body text-ink-2">Sent messages and Joe’s replies appear in this conversation. Joe also sees them on your project’s Client portal tab.</p></div>}
      {user.role === "owner" && <p className="mb-3 text-body text-ink-3">Preview only. Reply from the project’s Client portal tab.</p>}
      <PortalMessenger
        disabled={!scope || user.role === "owner"}
        surface="client"
        thread={thread}
        placeholder="Message Joe about the project…"
        listMaxHClass="h-[min(48dvh,28rem)]"
      />
    </main>
  );
}
