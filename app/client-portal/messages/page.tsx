import { Eyebrow } from "@/components/ui";
import { portalSlug } from "@/lib/client-portal";
import { getPortalThread, portalChannel } from "@/lib/portal-messages";
import { PortalMessenger } from "@/components/portal/PortalMessenger";

// Client-portal messages: the full owner ⇄ client thread with the composer.
// One thread per project (chat_messages channel portal:<slug>); Joe sees it in
// the project's Comms tab and gets a notification on every send.
export default async function PortalMessagesPage() {
  const slug = await portalSlug();
  const thread = slug ? await getPortalThread(portalChannel("client", slug)) : [];

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
