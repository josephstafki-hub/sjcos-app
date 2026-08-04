"use client";

import { startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Plus } from "lucide-react";
import { pollAgentRun } from "@/lib/actions/dev-agents";
import {
  loadConversationAction,
  newConversationAction,
  sendMessageAction,
} from "@/lib/actions/ai-chat";
import { TODAY_THREAD, recallThread, rememberThread } from "@/components/ai/threadMemory";
import type { ChatMessage } from "@/lib/ai-chat";
import { AGENT_META, AGENT_ORDER, type DevAgent } from "@/lib/dev-agents-meta";
import { doItDirective, prepDirective } from "@/lib/today-directives";
import { parseModelActions } from "@/lib/today-actions";
import type { TodayPriority } from "@/lib/today";
import { useTodayQueue } from "./TodayQueueContext";
import { PriorityCard } from "./PriorityCard";
import { ModelActionChips } from "./ModelActionChips";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The Today feed: the interactive centerpiece. Priority cards (deterministic
 *  React chips keyed to work_item ids) live INSIDE the chat scroll area,
 *  interleaved with the conversation. Chat mechanics mirror CommandBar
 *  (create conversation → sendMessageAction → poll the run → append reply) but
 *  add hand-offs: a card can be handed to Hermes to complete via MCP, and when
 *  the turn lands the queue refreshes so the card checks off in place. */
export function TodayFeed({
  brief,
  aiContext,
  enableActionChips = false,
}: {
  brief: ReactNode;
  aiContext: string;
  /** Today v2 · Phase 7: render model-emitted action chips. Off on /today
   *  (matches the shipped experience); on for the /today-preview demo route.
   *  The fence is always stripped from replies regardless of this flag. */
  enableActionChips?: boolean;
}) {
  const { priorities, refresh } = useTodayQueue();
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
  const router = useRouter();
  const meta = AGENT_META[agent];

  // This mount's claim on the visible thread. A poll loop holds the token it
  // started under, so leaving /today stops it instead of letting it setState on
  // a dead fiber and hit the server every 2s for another 16 minutes. The run
  // finishes server-side regardless and is resumed on the way back in.
  const liveRef = useRef({ alive: true });
  const claim = () => {
    liveRef.current.alive = false;
    liveRef.current = { alive: true };
    return liveRef.current;
  };

  // Poll a backgrounded Qwen/Hermes turn until it lands. When `subjectId` is
  // set (a card was handed off), refresh the queue on resolution — that's when
  // a Hermes-completed card checks off and the next backlog item swaps in.
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
        if (subjectId) await refresh(); // Hermes may have partially worked it
        return;
      }
      if (p.status === "done") {
        setActivity("");
        setMessages((m) => [
          ...m,
          { id: `run-${runId}`, role: "assistant", body: p.answer, costUsd: p.costUsd, createdAt: "", subjectWorkItemId: subjectId ?? null },
        ]);
        if (subjectId) await refresh();
        return;
      }
      setActivity(p.activity ?? "");
    }
  };

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [pending]);

  // ⌘/Ctrl+K focuses the composer (the feed is always on screen — no popup).
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

  // Keep the newest content in view as messages/activity grow.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, activity, pending]);

  const reopen = async (id: string) => {
    const live = claim();
    setPending(true);
    try {
      const detail = await loadConversationAction(id);
      if (!live.alive) return;
      if (!detail) {
        rememberThread(TODAY_THREAD, null);
        return;
      }
      setAgent(detail.agent);
      setConversationId(detail.id);
      setMessages(detail.messages);
      if (detail.pendingRunId) {
        // A hand-off tags its user turn with the card it's about; carry that
        // through so the resumed run still checks the card off when it lands.
        const subjectId = detail.messages[detail.messages.length - 1]?.subjectWorkItemId ?? undefined;
        setElapsed(0);
        await pollTurn(detail.pendingRunId, subjectId, live);
      }
    } finally {
      if (live.alive) setPending(false);
    }
  };

  // Reopen the thread this feed had going when Joe last left /today. The
  // transcript is reloaded from the database — which is what shows a reply that
  // landed while he was on another page — and a run still in flight resumes its
  // poll. Unmount drops this mount's claim so any live poll stops.
  //
  // Only the opening state swap is inside startTransition — that's the sync
  // part an effect isn't allowed to do bare. The load and any resumed poll are
  // awaited past it, deliberately outside any transition (see `pending`).
  useEffect(() => {
    const id = recallThread(TODAY_THREAD);
    if (id) startTransition(() => void reopen(id));
    return () => {
      liveRef.current.alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newChat = () => {
    if (pending) return;
    claim();
    rememberThread(TODAY_THREAD, null);
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

  const finishSend = async (
    r: Awaited<ReturnType<typeof sendMessageAction>>,
    subjectId: string | undefined,
    live: { alive: boolean },
  ) => {
    if (!live.alive) return;
    if (!r.ok) {
      setMessages((m) => [
        ...m,
        { id: `err-${Date.now()}`, role: "assistant", body: `⚠️ ${r.error}`, costUsd: null, createdAt: "", subjectWorkItemId: subjectId ?? null },
      ]);
      if (subjectId) await refresh();
    } else if (r.kind === "answer") {
      setMessages((m) => [...m, { ...r.message, subjectWorkItemId: subjectId ?? r.message.subjectWorkItemId }]);
      if (subjectId) await refresh();
    } else {
      await pollTurn(r.runId, subjectId, live);
    }
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

    if (agent === "claude") {
      // Claude is the builder — hand off to /ai like CommandBar does.
      runTurn(async () => {
        try {
          const convId = await newConversationAction("claude");
          await sendMessageAction(convId, q, "/today");
          router.push(`/ai?c=${convId}`);
        } catch (e) {
          setError((e as Error).message);
        }
      });
      return;
    }

    setPrompt("");
    setElapsed(0);
    setActivity("");
    pushUser(q);

    runTurn(async (live) => {
      let convId = conversationId;
      if (!convId) {
        convId = await newConversationAction(agent);
        // Remembered directly as well as in state: if Joe left while the thread
        // was being opened, setConversationId lands on an unmounted feed, and
        // without this the next visit would fork a second conversation.
        rememberThread(TODAY_THREAD, convId);
        setConversationId(convId);
      }
      const r = await sendMessageAction(convId, q, aiContext);
      await finishSend(r, undefined, live);
    });
  };

  // "Have Hermes do it" / "Prep me" — send a structured directive as the user
  // turn, tagged with the work_item id so the queue refreshes when it lands.
  const handOff = (p: TodayPriority, kind: "do" | "prep") => {
    if (pending) return;
    setError("");
    setNotice("");

    if (kind === "do") {
      // Only Hermes has the MCP tools. Switch to a Hermes thread if needed.
      runTurn(async (live) => {
        let convId = conversationId;
        if (agent !== "hermes" || !convId) {
          setAgent("hermes");
          setNotice("Handing to Hermes…");
          setMessages([]);
          convId = await newConversationAction("hermes");
          rememberThread(TODAY_THREAD, convId);
          setConversationId(convId);
        }
        setElapsed(0);
        setActivity("");
        pushUser(`✦ Have Hermes do it — ${p.title}`, p.id);
        const r = await sendMessageAction(convId, doItDirective(p), aiContext, undefined, undefined, p.id);
        await finishSend(r, p.id, live);
      });
      return;
    }

    // "Prep me" — read-only context gathering. Runs on the selected local
    // agent (Claude → treat as Qwen, which has no MCP tools).
    const target: DevAgent = agent === "claude" ? "qwen" : agent;
    runTurn(async (live) => {
      let convId = conversationId;
      if (agent === "claude" || !convId) {
        setAgent(target);
        convId = await newConversationAction(target);
        rememberThread(TODAY_THREAD, convId);
        setConversationId(convId);
        setMessages([]);
      }
      setElapsed(0);
      setActivity("");
      pushUser(`✦ Prep me — ${p.title}`, p.id);
      const r = await sendMessageAction(convId, prepDirective(p), aiContext, undefined, undefined, p.id);
      await finishSend(r, p.id, live);
    });
  };

  return (
    <section className="flex max-h-[calc(100vh-160px)] min-h-[420px] flex-col overflow-hidden rounded-[10px] border-[1.5px] border-ai bg-paper shadow-card">
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
                rememberThread(TODAY_THREAD, null);
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
        <span className="truncate text-[11px] text-ink-4">
          {agent === "claude" ? "Builder · opens in Ask" : meta.note}
        </span>
        <div className="flex-1" />
        {agent !== "claude" && messages.length > 0 && (
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

      {/* Scroll area: brief → priority cards → transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-3">{brief}</div>

        <div className="mb-1 flex items-center gap-2">
          <h2 className="font-serif text-[15px] font-semibold text-ink">Priorities</h2>
          <span className="text-[11px] text-ink-3">· what moves the week</span>
        </div>
        <div className="flex flex-col gap-2.5">
          {priorities.map((p) => (
            <PriorityCard key={p.id} p={p} onHandOff={handOff} />
          ))}
        </div>

        {(messages.length > 0 || notice) && (
          <div className="mt-4 flex flex-col gap-2.5 border-t border-rule pt-3">
            {notice && <div className="text-[11px] font-medium text-ai-2">{notice}</div>}
            {messages.map((m) => {
              if (m.role === "user") {
                return (
                  <div key={m.id} className="text-[12.5px] font-medium text-ink-2">
                    {m.body}
                  </div>
                );
              }
              // Assistant reply. If it's about a still-open card, re-render that
              // card's chips under it so Joe can act without scrolling up.
              const subject = m.subjectWorkItemId
                ? priorities.find((p) => p.id === m.subjectWorkItemId)
                : undefined;
              // Phase 7: a reply may end with a `sjcos-actions` block. Strip it
              // from the shown text and turn any valid entries into chips
              // (ModelActionChips filters to items in the live queue).
              const { body: displayBody, actions } = parseModelActions(m.body);
              return (
                <div key={m.id}>
                  {displayBody && (
                    <div
                      className={`whitespace-pre-wrap rounded-md bg-ai-soft px-3 py-2 text-[13px] leading-relaxed ${
                        displayBody.startsWith("⚠️") ? "text-flag" : "text-ai-2"
                      }`}
                    >
                      {displayBody}
                    </div>
                  )}
                  {enableActionChips && actions.length > 0 && (
                    <div>
                      {!displayBody && (
                        <div className="mb-0.5 text-[11px] font-medium text-ink-3">
                          Suggested
                        </div>
                      )}
                      <ModelActionChips actions={actions} />
                    </div>
                  )}
                  {subject && (
                    <div className="mt-1.5">
                      <PriorityCard p={subject} onHandOff={handOff} />
                    </div>
                  )}
                </div>
              );
            })}
            {pending && agent !== "claude" && (
              <div className="text-[12px]">
                <div className="text-ai-2">
                  {meta.label} is working{elapsed > 0 ? ` · ${elapsed}s` : "…"}
                </div>
                {activity && <div className="mt-1 font-mono text-[11px] text-ink-4">{activity}</div>}
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
          placeholder="Ask about today…"
          className="flex-1 bg-transparent font-serif text-[15px] text-ink outline-none placeholder:text-ink-4"
        />
        <span className="font-mono text-[11px] text-ink-3">
          {pending ? "…" : agent === "claude" ? "↵ launch" : "↵ send"}
        </span>
      </form>
    </section>
  );
}
