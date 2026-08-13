import { Eyebrow } from "@/components/ui";
import { portalScope } from "@/lib/client-portal";
import { getPortalThread, portalChannel } from "@/lib/portal-messages";
import { PortalMessenger } from "@/components/portal/PortalMessenger";

// Client-portal messages: the full owner ⇄ client thread with the composer.
// One thread per scope (chat_messages channel portal:<slug>, or
// portal:lead:<slug> during the lead stage — the thread is renamed onto the
// project on conversion); Joe sees it in the project's Comms tab / the lead's
// Client portal tab and gets a notification on every send.
export default async function PortalMessagesPage() {
  const scope = await portalScope();
  const channelSlug = scope ? (scope.kind === "lead" ? `lead:${scope.slug}` : scope.slug) : null;
  const thread = channelSlug ? await getPortalThread(portalChannel("client", channelSlug)) : [];

  return (
    <main className="mx-auto w-full max-w-2xl px-9 py-7">
      <Eyebrow>Messages</Eyebrow>
      <h1 className="mt-1 font-serif text-[26px] font-medium leading-tight text-accent-2">
        Talk to Joe.
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        Questions, changes, schedule — it all lands straight with Joe, attached to your
        project.
      </p>
      <div className="my-5 border-t border-rule" />
      <PortalMessenger
        surface="client"
        thread={thread}
        placeholder="Message Joe about the project…"
        listMaxHClass="max-h-[55vh]"
      />
    </main>
  );
}
