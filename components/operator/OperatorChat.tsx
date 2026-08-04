"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { Sparkles, Plus } from "lucide-react";
import { pollAgentRun } from "@/lib/actions/dev-agents";
import {
  loadConversationAction,
  newConversationAction,
  sendMessageAction,
} from "@/lib/actions/ai-chat";
import { OPERATOR_THREAD, recallThread, rememberThread } from "@/components/ai/threadMemory";
import type { ChatMessage } from "@/lib/ai-chat";
import { AGENT_META, AGENT_ORDER, type DevAgent } from "@/lib/dev-agents-meta";
import { doItDirective, prepDirective } from "@/lib/today-directives";
import { queueNarration } from "@/lib/operator-narration";
import type { TodayPriority } from "@/lib/today";
import { useTodayQueue } from "@/components/today/TodayQueueContext";
import { PriorityCard } from "@/components/today/PriorityCard";
import type { ActiveRun } from "./OperatorGrid";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Operator console · center panel (spec §1.2, §2, §3). A port of
 *  components/today/TodayFeed.tsx chat mechanics (create conversation →
 *  sendMessageAction → poll the run → append reply), with three console
 *  differences:
 *   - Claude runs IN PLACE (no /ai redirect) — §2.3.
 *   - The opening bubble is the deterministic queueNarration (§2.1).
 *   - Run lifecycle is reported up (onRunStart/onRunEnd) so the Workbench can
 *     snap to the entity and poll faster while a run is live.
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
  const [agent, setAgent] = useState<DevAgent>("hermes");
  const [prompt, setPrompt] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Plain state, deliberately not useTransition: a turn can run for minutes,
  // React keeps a transition pending for its whole await chain, and every later
  // transition — including the App Router's own soft navigation — is entangled
  // behind it. That's what made clicking another page do nothing until the
  // agent answered.
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const meta = AGENT_META[agent];

  // This mount's claim on the visible thread. A poll loop holds the token it
  // started under, so leaving the console stops it instead of letting it
  // setState on a dead fiber and hit the server every 2s for another 16
  // minutes. The run finishes server-side regardless and resumes on return.
  const liveRef = useRef({ alive: true });
  const claim = () => {
    liveRef.current.alive = false;
    liveRef.current = { alive: true };
    return liveRef.current;
  };

  const narration = queueNarration(priorities, { items: waiting, total: waiting.length });

  // Poll a backgrounded turn until it lands, then report run end + refresh the
  // queue (a completed hand-off checks its card off; free text can change any
  // item). Claude is polled identically to Qwen/Hermes.
  const pollTurn = async (runId: string, subjectId: string | undefined, live: { alive: boolean }) => {
    for (let i = 0; i < 480; i++) {
      await sleep(2000);
      if (!live.alive) return;
      const p = await pollAgentRun(runId);
      if (!live.alive) return;
      if (!p.ok) {
        setActivity("");
        setMessages((m) => [
          ...m,
          { id: `err-${runId}`, role: "assistant", body: `⚠️ ${p.error}`, costUsd: null, createdAt: "", subjectWorkItemId: subjectId ?? null },
        ]);
        onRunEnd();
        await refresh();
        return;
      }
      if (p.status === "done") {
        setActivity("");
        setMessages((m) => [
          ...m,
          { id: `run-${runId}`, role: "assistant", body: p.answer, costUsd: p.costUsd, createdAt: "", subjectWorkItemId: subjectId ?? null },
        ]);
        onRunEnd();
        await refresh();
        return;
      }
      setActivity(p.activity ?? "");
    }
    onRunEnd();
  };

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [pending]);

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
  }, [messages.length, activity, pending]);

  // Reopen the thread the console had going when Joe last left it. The
  // transcript comes back from the database — which is what shows a reply that
  // landed while he was on another page — and a run still in flight resumes its
  // poll (and its workbench focus). Unmount drops the claim so the poll stops.
  const reopen = async (id: string) => {
    const live = claim();
    setPending(true);
    try {
      const detail = await loadConversationAction(id);
      if (!live.alive) return;
      if (!detail) {
        rememberThread(OPERATOR_THREAD, null);
        return;
      }
      setAgent(detail.agent);
      setConversationId(detail.id);
      setMessages(detail.messages);
      if (detail.pendingRunId) {
        // A hand-off tags its user turn with the card it's about; carry that
        // through so the resumed run still refreshes the queue and re-focuses
        // the workbench on the right entity.
        const subjectId = detail.messages[detail.messages.length - 1]?.subjectWorkItemId ?? undefined;
        setElapsed(0);
        onRunStart({
          runId: detail.pendingRunId,
          agent: detail.agent,
          subjectId: subjectId ?? null,
          startedAt: Date.now(),
        });
        await pollTurn(detail.pendingRunId, subjectId, live);
      }
    } finally {
      if (live.alive) setPending(false);
    }
  };

  // Only the opening state swap is inside startTransition — that's the sync
  // part an effect isn't allowed to do bare. The load and any resumed poll are
  // awaited past it, deliberately outside any transition (see `pending`).
  useEffect(() => {
    const id = recallThread(OPERATOR_THREAD);
    if (id) startTransition(() => void reopen(id));
    return () => {
      liveRef.current.alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newChat = () => {
    if (pending) return;
    claim();
    rememberThread(OPERATOR_THREAD, null);
    setConversationId(null);
    setMessages([]);
    setActivity("");
    setError("");
    setNotice("");
  };

  const pushUser = (body: string, subjectId?: string) =>
    setMessages((m) => [
      ...m,
      { id: `u-${Date.now()}`, role: "user", body, costUsd: null, createdAt: "", subjectWorkItemId: subjectId ?? null },
    ]);

  // Kick a send that has already created its conversation + user bubble.
  const runSend = async (
    convId: string,
    directive: string,
    runAgent: DevAgent,
    subjectId: string | undefined,
    live: { alive: boolean },
  ) => {
    const r = await sendMessageAction(convId, directive, aiContext, undefined, undefined, subjectId);
    if (!live.alive) return;
    if (!r.ok) {
      setMessages((m) => [
        ...m,
        { id: `err-${Date.now()}`, role: "assistant", body: `⚠️ ${r.error}`, costUsd: null, createdAt: "", subjectWorkItemId: subjectId ?? null },
      ]);
      await refresh();
      return;
    }
    if (r.kind === "answer") {
      // Rare synchronous path — no run row to poll.
      setMessages((m) => [...m, { ...r.message, subjectWorkItemId: subjectId ?? r.message.subjectWorkItemId }]);
      await refresh();
      return;
    }
    onRunStart({ runId: r.runId, agent: runAgent, subjectId: subjectId ?? null, startedAt: Date.now() });
    await pollTurn(r.runId, subjectId, live);
  };

  /** Run a turn as plain async work rather than a transition — see the
   *  `pending` declaration. Navigating away mid-turn is fine: the run finishes
   *  server-side and the reply is in the thread when Joe comes back. */
  const runTurn = (work: (live: { alive: boolean }) => Promise<void>) => {
    const live = liveRef.current;
    void (async () => {
      setPending(true);
      try {
        await work(live);
      } finally {
        if (live.alive) setPending(false);
      }
    })();
  };

  const ask = () => {
    const q = prompt.trim();
    if (!q || pending) return;
    setError("");
    setNotice("");
    setPrompt("");
    setElapsed(0);
    setActivity("");
    pushUser(q);
    runTurn(async (live) => {
      let convId = conversationId;
      if (!convId) {
        convId = await newConversationAction(agent);
        // Remembered directly as well as in state: if Joe left while the thread
        // was being opened, setConversationId lands on an unmounted console, and
        // without this the next visit would fork a second conversation.
        rememberThread(OPERATOR_THREAD, convId);
        setConversationId(convId);
      }
      await runSend(convId, q, agent, undefined, live);
    });
  };

  // "Have Hermes do it" / "Prep me" — same directives as /today.
  const handOff = (p: TodayPriority, kind: "do" | "prep") => {
    if (pending) return;
    setError("");
    setNotice("");
    if (kind === "do") {
      runTurn(async (live) => {
        let convId = conversationId;
        if (agent !== "hermes" || !convId) {
          setAgent("hermes");
          setNotice("Handing to Hermes…");
          setMessages([]);
          convId = await newConversationAction("hermes");
          rememberThread(OPERATOR_THREAD, convId);
          setConversationId(convId);
        }
        setElapsed(0);
        setActivity("");
        pushUser(`✦ Have Hermes do it — ${p.title}`, p.id);
        await runSend(convId, doItDirective(p), "hermes", p.id, live);
      });
      return;
    }
    const target: DevAgent = agent === "claude" ? "qwen" : agent;
    runTurn(async (live) => {
      let convId = conversationId;
      if (agent === "claude" || !convId) {
        setAgent(target);
        convId = await newConversationAction(target);
        rememberThread(OPERATOR_THREAD, convId);
        setConversationId(convId);
        setMessages([]);
      }
      setElapsed(0);
      setActivity("");
      pushUser(`✦ Prep me — ${p.title}`, p.id);
      await runSend(convId, prepDirective(p), target, p.id, live);
    });
  };

  // Expose the live handOff closure to sibling QueueRail via the parent (§1.4).
  useEffect(() => {
    registerHandOff(handOff);
  });

  // Claude activity is multi-line and rich — show the last few lines (§3.3).
  const activityLines = activity ? activity.split("\n").slice(-4) : [];

  return (
    <section className="flex max-h-[calc(100vh-160px)] min-h-[460px] flex-col overflow-hidden rounded-[10px] border-[1.5px] border-ai bg-paper shadow-card">
      {/* Header: agent picker + New chat */}
      <div className="flex items-center gap-2 border-b border-rule px-4 py-2">
        <div className="flex rounded-md border border-rule bg-paper-2 p-0.5">
          {AGENT_ORDER.map((a) => (
            <button
              key={a}
              onClick={() => {
                if (pending) return;
                // Each agent keeps its own thread, so this abandons the current
                // one — drop the claim and the memory of it too.
                claim();
                rememberThread(OPERATOR_THREAD, null);
                setAgent(a);
                setConversationId(null);
                setMessages([]);
                setActivity("");
                setError("");
                setNotice("");
                inputRef.current?.focus();
              }}
              disabled={pending}
              className={`rounded px-2.5 py-0.5 text-[11.5px] font-medium transition-colors disabled:opacity-50 ${
                a === agent ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper"
              }`}
            >
              {AGENT_META[a].label}
            </button>
          ))}
        </div>
        <span className="truncate text-[11px] text-ink-4">{meta.note}</span>
        <div className="flex-1" />
        {messages.length > 0 && (
          <button
            onClick={newChat}
            disabled={pending}
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

        {(messages.length > 0 || notice) && (
          <div className="mt-4 flex flex-col gap-2.5 border-t border-rule pt-3">
            {notice && <div className="text-[11px] font-medium text-ai-2">{notice}</div>}
            {messages.map((m) =>
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
            {pending && (
              <div className="text-[12px]">
                <div className="text-ai-2">
                  {meta.label} is working{elapsed > 0 ? ` · ${elapsed}s` : "…"}
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

        {error && <div className="mt-3 text-[13px] text-flag">{error}</div>}
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
        <span className="font-mono text-[11px] text-ink-3">{pending ? "…" : "↵ send"}</span>
      </form>
    </section>
  );
}
