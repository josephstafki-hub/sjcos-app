"use client";

import { useRef } from "react";
import { Card, SubmitButton } from "@/components/ui";
import { sendProjectMessage } from "@/lib/actions/portal";
import type { PortalMessage } from "@/lib/portal-messages";

/** Project Comms tab — the real owner ⇄ client thread (portal:<slug>). The
 *  client sees the same conversation on their dashboard. Owner composer posts
 *  via sendProjectMessage; the form resets after submit. */
export function ProjectComms({ slug, thread }: { slug: string; thread: PortalMessage[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const send = sendProjectMessage.bind(null, slug);

  return (
    <Card className="max-w-[680px] overflow-hidden p-0">
      <div className="border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        Client thread · {thread.length} message{thread.length === 1 ? "" : "s"}
      </div>

      <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto px-4 py-3">
        {thread.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-ink-3">
            No messages yet. Start the conversation — the client sees it on their dashboard.
          </div>
        ) : (
          thread.map((m) => {
            const fromOwner = m.author !== "user";
            return (
              <div key={m.id} className={`flex flex-col ${fromOwner ? "items-end" : "items-start"}`}>
                <div
                  className={[
                    "max-w-[80%] rounded-lg px-2.5 py-1.5 text-[12.5px] leading-snug",
                    fromOwner ? "bg-accent text-ink" : "bg-paper-3 text-ink",
                  ].join(" ")}
                >
                  {m.body}
                </div>
                <span className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-4">
                  {fromOwner ? "You" : m.name} · {m.when}
                </span>
              </div>
            );
          })
        )}
      </div>

      <form
        ref={formRef}
        action={async (fd) => {
          await send(fd);
          formRef.current?.reset();
        }}
        className="flex items-center gap-2 border-t border-rule bg-paper-2 px-4 py-2.5"
      >
        <input
          name="body"
          required
          placeholder="Message the client…"
          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
        />
        <SubmitButton className="rounded-md bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]">
          Send
        </SubmitButton>
      </form>
    </Card>
  );
}
