"use client";

import { useRef, useState, useTransition } from "react";
import { Sparkles, ArrowUp } from "lucide-react";
import { Avatar, Card } from "@/components/ui";
import { AI_NAME } from "@/lib/ai-name";
import { askQwen } from "@/lib/actions/ask";

interface Msg {
  role: "user" | "ai";
  text: string;
  error?: boolean;
}

const DEFAULT_STARTERS = [
  "What should I focus on today?",
  "Draft a follow-up to a stalled lead.",
  "What COIs expire in the next 30 days?",
];

/** Real Ask-{AI_NAME} chat. Each turn calls the askQwen server action (Qwen via
 *  Ollama, mock fallback) and appends the answer. General assistant — no page
 *  context here (the in-page command bar carries that). `starters` come from the
 *  page so chips can name real records. */
export function AssistantChat({ starters = DEFAULT_STARTERS }: { starters?: string[] }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  function send(qRaw: string) {
    const q = qRaw.trim();
    if (!q || pending) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: q }]);
    startTransition(async () => {
      const r = await askQwen(q);
      setMsgs((m) => [
        ...m,
        r.ok
          ? { role: "ai", text: r.answer ?? "" }
          : { role: "ai", text: r.error ?? "Couldn't reach the assistant.", error: true },
      ]);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }),
      );
    });
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-7 py-6">
        <div className="mx-auto flex max-w-[760px] flex-col gap-3.5">
          {msgs.length === 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-2 text-ai-2">
                <Sparkles className="size-4" strokeWidth={1.5} />
                <span className="font-serif text-[18px] font-semibold">Ask {AI_NAME}</span>
              </div>
              <p className="mt-1 text-[13px] text-ink-3">
                Questions about your jobs, leads, money, schedule — grounded in your data.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {starters.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-rule bg-paper px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:bg-paper-2"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex items-start gap-2.5">
                <Avatar initials="J" kind="accent" />
                <div className="flex-1 pt-0.5 text-[13.5px] text-ink">{m.text}</div>
              </div>
            ) : (
              <div key={i} className="flex items-start gap-2.5">
                <Avatar initials={AI_NAME.slice(0, 1)} kind="ai" />
                <div className="flex-1">
                  <Card kind="ai" className="p-3">
                    <div
                      className={`whitespace-pre-wrap text-[13px] leading-relaxed ${m.error ? "text-flag" : "text-ai-2"}`}
                    >
                      {m.text}
                    </div>
                  </Card>
                </div>
              </div>
            ),
          )}

          {pending && (
            <div className="flex items-start gap-2.5">
              <Avatar initials={AI_NAME.slice(0, 1)} kind="ai" />
              <div className="flex-1 space-y-1.5 pt-1" aria-hidden>
                <div className="h-3 w-[78%] animate-pulse rounded bg-ai/15" />
                <div className="h-3 w-[55%] animate-pulse rounded bg-ai/15" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* composer */}
      <div className="border-t border-rule bg-paper-2 px-7 py-3.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="mx-auto flex max-w-[760px] items-center gap-2 rounded-lg border border-rule bg-card p-2 pl-3"
        >
          <Sparkles className="size-4 flex-none text-ai" strokeWidth={1.5} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask ${AI_NAME} anything…`}
            className="flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-4"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            aria-label="Send"
            className="flex size-7 flex-none items-center justify-center rounded-md bg-ink text-paper transition-colors hover:bg-[#232a1e] disabled:opacity-40"
          >
            <ArrowUp className="size-4" strokeWidth={2} />
          </button>
        </form>
      </div>
    </section>
  );
}
