"use client";

import { useRef } from "react";
import { LinkedText, SubmitButton } from "@/components/ui";
import { sendPortalMessage } from "@/lib/actions/portal";
import type { PortalMessage } from "@/lib/portal-messages";

/** "Message Joe" thread, used by both portals. Renders recent messages and a
 *  composer; the server action persists + notifies Joe. The channel is derived
 *  server-side from identity, so `surface` is only a routing hint. */
export function PortalMessenger({
  surface,
  disabled = false,
  thread,
  placeholder = "Message Joe…",
  listMaxHClass = "max-h-[220px]",
}: {
  surface: "client" | "sub";
  disabled?: boolean;
  thread: PortalMessage[];
  placeholder?: string;
  /** Cap on the thread list — the sidebar embed stays short, the full
   *  Messages page gets room to breathe. */
  listMaxHClass?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="mt-2 flex flex-col gap-2">
      {thread.length > 0 && (
        <div className={`flex ${listMaxHClass} flex-col gap-2 overflow-y-auto`}>
          {thread.map((m) => {
            const fromJoe = m.author !== "user";
            return (
              <div key={m.id} className={`flex flex-col ${fromJoe ? "items-start" : "items-end"}`}>
                <div
                  className={[
                    "max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-body leading-snug",
                    fromJoe ? "bg-paper-3 text-ink" : "bg-accent text-white",
                  ].join(" ")}
                >
                  <LinkedText text={m.body} />
                </div>
                <span className="mt-0.5 text-meta text-ink-3">
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
          disabled={disabled}
          name="body"
          required
          rows={2}
          placeholder={placeholder}
          className="resize-none rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
        />
        <SubmitButton
          disabled={disabled}
          pendingLabel="Sending…"
          className="min-h-11 self-end rounded-md border border-ink bg-ink px-3 py-1.5 text-body font-semibold text-paper hover:bg-ink-hover"
        >
          Send
        </SubmitButton>
      </form>
    </div>
  );
}
