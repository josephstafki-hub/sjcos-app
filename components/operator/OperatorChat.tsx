"use client";

import { useEffect, useRef } from "react";
import { Sparkles, Plus } from "lucide-react";
import { useState } from "react";
import { AGENT_META, AGENT_ORDER, type DevAgent } from "@/lib/dev-agents-meta";
import { doItDirective, prepDirective } from "@/lib/today-directives";
import { queueNarration } from "@/lib/operator-narration";
import type { TodayPriority } from "@/lib/today";
import { useTodayQueue } from "@/components/today/TodayQueueContext";
import { PriorityCard } from "@/components/today/PriorityCard";
import { useAgentChat } from "@/components/panel/useAgentChat";
import type { ActiveRun } from "./OperatorGrid";

/** Operator console · center panel (spec §1.2, §2, §3). The chat mechanics now
 *  live in components/panel/useAgentChat — the shared engine the universal
 *  panel is built on — leaving this component the console-specific parts:
 *   - The opening bubble is the deterministic queueNarration (§2.1).
 *   - Run lifecycle is reported up (onRunStart/onRunEnd) so the Workbench can
 *     snap to the entity and poll faster while a run is live.
 *   - Claude runs IN PLACE (no /ai redirect) — §2.3.
 *  Per guardrail #4 the console never parses model text for actions — only the
 *  app-rendered card chips act. */
export function OperatorChat({
  aiContext,
  registerHandOff,
  onRunStart,
  onRunEnd,
}: {
  aiContext: string;
  registerHandOff: (fn: (p: TodayPriority, kind: "do" | "prep") => void) => void;
  onRunStart: (run: ActiveRun) => void;
  onRunEnd: () => void;
}) {
  const { priorities, waiting, refresh } = useTodayQueue();
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useAgentChat({
    getPageContext: () => aiContext,
    onRunStart,
    onRunEnd,
    onSettled: refresh,
  });
  const meta = AGENT_META[chat.agent];

  const narration = queueNarration(priorities, { items: waiting, total: waiting.length });

  // ⌘/Ctrl+K focuses the composer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages.length, chat.activity, chat.pending]);

  const ask = () => {
    const q = prompt.trim();
    if (!q || chat.pending) return;
    setPrompt("");
    chat.submit({ directive: q });
  };

  // "Have Hermes do it" / "Prep me" — same directives as /today.
  const handOff = (p: TodayPriority, kind: "do" | "prep") => {
    if (chat.pending) return;
    if (kind === "do") {
      chat.submit({
        directive: doItDirective(p),
        display: `✦ Have Hermes do it — ${p.title}`,
        agent: "hermes",
        subjectId: p.id,
        notice: chat.agent !== "hermes" ? "Handing to Hermes…" : undefined,
      });
      return;
    }
    // Prep stays on the grounded assistants; Claude is the wrong tool for it.
    const target: DevAgent = chat.agent === "claude" ? "qwen" : chat.agent;
    chat.submit({
      directive: prepDirective(p),
      display: `✦ Prep me — ${p.title}`,
      agent: target,
      subjectId: p.id,
    });
  };

  // Expose the live handOff closure to sibling QueueRail via the parent (§1.4).
  useEffect(() => {
    registerHandOff(handOff);
  });

  // Claude activity is multi-line and rich — show the last few lines (§3.3).
  const activityLines = chat.activity ? chat.activity.split("\n").slice(-4) : [];

  return (
    <section className="flex max-h-[calc(100vh-160px)] min-h-[460px] flex-col overflow-hidden rounded-[10px] border-[1.5px] border-ai bg-paper shadow-card">
      {/* Header: agent picker + New chat */}
      <div className="flex items-center gap-2 border-b border-rule px-4 py-2">
        <div className="flex rounded-md border border-rule bg-paper-2 p-0.5">
          {AGENT_ORDER.map((a) => (
            <button
              key={a}
              onClick={() => {
                if (chat.pending) return;
                chat.selectAgent(a);
                inputRef.current?.focus();
              }}
              disabled={chat.pending}
              className={`rounded px-2.5 py-0.5 text-[11.5px] font-medium transition-colors disabled:opacity-50 ${
                a === chat.agent ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper"
              }`}
            >
              {AGENT_META[a].label}
            </button>
          ))}
        </div>
        <span className="truncate text-[11px] text-ink-4">{meta.note}</span>
        <div className="flex-1" />
        {chat.messages.length > 0 && (
          <button
            onClick={chat.newChat}
            disabled={chat.pending}
            aria-label="New chat"
            title="New chat"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-paper disabled:opacity-40"
          >
            <Plus className="size-3" strokeWidth={2} /> New
          </button>
        )}
      </div>

      {/* Scroll area: narration → (inline queue cards on narrow screens) → transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="whitespace-pre-wrap rounded-md bg-ai-soft px-3 py-2 text-[12.5px] leading-relaxed text-ai-2">
          {narration}
        </div>

        {/* Inline queue cards — shown only when the QueueRail column is hidden (< xl). */}
        <div className="mt-3 xl:hidden">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            Priorities
          </div>
          <div className="flex flex-col gap-2.5">
            {priorities.map((p) => (
              <PriorityCard key={p.id} p={p} onHandOff={handOff} />
            ))}
          </div>
        </div>

        {(chat.messages.length > 0 || chat.notice) && (
          <div className="mt-4 flex flex-col gap-2.5 border-t border-rule pt-3">
            {chat.notice && <div className="text-[11px] font-medium text-ai-2">{chat.notice}</div>}
            {chat.messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="text-[12.5px] font-medium text-ink-2">
                  {m.body}
                </div>
              ) : (
                <div
                  key={m.id}
                  className={`whitespace-pre-wrap rounded-md bg-ai-soft px-3 py-2 text-[13px] leading-relaxed ${
                    m.body.startsWith("⚠️") ? "text-flag" : "text-ai-2"
                  }`}
                >
                  {m.body}
                </div>
              ),
            )}
            {chat.pending && (
              <div className="text-[12px]">
                <div className="text-ai-2">
                  {meta.label} is working{chat.elapsed > 0 ? ` · ${chat.elapsed}s` : "…"}
                </div>
                {activityLines.length > 0 && (
                  <div className="mt-1 space-y-0.5 font-mono text-[11px] text-ink-4">
                    {activityLines.map((line, i) => (
                      <div key={i} className="truncate">{line}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {chat.error && <div className="mt-3 text-[13px] text-flag">{chat.error}</div>}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
        className="flex items-center gap-2.5 border-t border-rule px-4 py-3"
      >
        <Sparkles className="size-[18px] flex-none text-ai" strokeWidth={1.5} />
        <input
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Tell ${meta.label} what to do…`}
          className="flex-1 bg-transparent font-serif text-[15px] text-ink outline-none placeholder:text-ink-4"
        />
        <span className="font-mono text-[11px] text-ink-3">{chat.pending ? "…" : "↵ send"}</span>
      </form>
    </section>
  );
}
