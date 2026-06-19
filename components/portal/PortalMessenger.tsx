"use client";

import { useRef } from "react";
import { SubmitButton } from "@/components/ui";
import { sendPortalMessage } from "@/lib/actions/portal";
import type { PortalMessage } from "@/lib/portal-messages";

/** "Message Joe" thread, used by both portals. Renders recent messages and a
 *  composer; the server action persists + notifies Joe. The channel is derived
 *  server-side from identity, so `surface` is only a routing hint. */
export function PortalMessenger({
  surface,
  thread,
  placeholder = "Message Joe…",
}: {
  surface: "client" | "sub";
  thread: PortalMessage[];
  placeholder?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="mt-2 flex flex-col gap-2">
      {thread.length > 0 && (
        <div className="flex max-h-[220px] flex-col gap-2 overflow-y-auto">
          {thread.map((m) => {
            const fromJoe = m.author !== "user";
            return (
              <div key={m.id} className={`flex flex-col ${fromJoe ? "items-start" : "items-end"}`}>
                <div
                  className={[
                    "max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12px] leading-snug",
                    fromJoe ? "bg-paper-3 text-ink" : "bg-accent text-ink",
                  ].join(" ")}
                >
                  {m.body}
                </div>
                <span className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-4">
                  {fromJoe ? m.name : "You"} · {m.when}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <form
        ref={formRef}
        action={async (fd) => {
          await sendPortalMessage(fd);
          formRef.current?.reset();
        }}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="surface" value={surface} />
        <textarea
          name="body"
          required
          rows={2}
          placeholder={placeholder}
          className="resize-none rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
        />
        <SubmitButton
          pendingLabel="Sending…"
          className="self-end rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
        >
          Send
        </SubmitButton>
      </form>
    </div>
  );
}
