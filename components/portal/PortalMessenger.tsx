"use client";

import { useLayoutEffect, useRef } from "react";
import { SubmitButton } from "@/components/ui";
import { sendPortalMessage } from "@/lib/actions/portal";
import { messageParts } from "@/lib/portal-presentation";
import type { PortalMessage } from "@/lib/portal-messages";

/** "Message Joe" thread, used by both portals. Renders recent messages and a
 *  composer; the server action persists + notifies Joe. The channel is derived
 *  server-side from identity, so `surface` is only a routing hint. */
export function PortalMessenger({
  surface,
  initialDraft = "",
  disabled = false,
  thread,
  placeholder = "Message Joe…",
  listMaxHClass = "max-h-[220px]",
}: {
  surface: "client" | "sub";
  initialDraft?: string;
  disabled?: boolean;
  thread: PortalMessage[];
  placeholder?: string;
  /** Cap on the thread list — the sidebar embed stays short, the full
   *  Messages page gets room to breathe. */
  listMaxHClass?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const latestId = thread.at(-1)?.id;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const showLatest = () => { list.scrollTop = list.scrollHeight; };
    showLatest();
    const observer = new ResizeObserver(showLatest);
    observer.observe(list);
    return () => observer.disconnect();
  }, [latestId]);

  return (
    <div className="mt-2 flex flex-col gap-2">
      {thread.length > 0 && (
        <div ref={listRef} className={`flex ${listMaxHClass} flex-col gap-2 overflow-y-auto`}>
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
                  {messageParts(m.body).map((part, i) => part.href ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="my-2 flex min-h-11 items-center rounded-md border border-current/30 px-3 py-2 font-semibold underline underline-offset-4">{part.label} ↗</a> : <span key={i}>{part.text}</span>)}
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
          defaultValue={initialDraft}
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
