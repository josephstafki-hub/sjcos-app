"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, ArrowUp, Pencil, Plus, Trash2, Archive, MessageSquare, Paperclip, X } from "lucide-react";
import { Avatar, Card, VoiceButton } from "@/components/ui";
import { mergeTranscript } from "@/lib/append-transcript";
import { pollAgentRun } from "@/lib/actions/dev-agents";
import {
  listConversationsAction,
  loadConversationAction,
  newConversationAction,
  sendMessageAction,
  renameConversationAction,
  archiveConversationAction,
  deleteConversationAction,
} from "@/lib/actions/ai-chat";
import { useChatAttachments } from "@/components/ai/useChatAttachments";
import { ASK_THREAD, recallThread, rememberThread } from "@/components/ai/threadMemory";
import type { ConversationSummary, ChatMessage } from "@/lib/ai-chat";
import {
  AGENT_META,
  AGENT_ORDER,
  CLAUDE_DEFAULTS,
  CLAUDE_MODEL_OPTIONS,
  CLAUDE_MODE_OPTIONS,
  CLAUDE_MODE_VALUES,
  CLAUDE_EFFORT_OPTIONS,
  type ClaudeModel,
  type ClaudeEffort,
  type ClaudeOptions,
  type DevAgent,
} from "@/lib/dev-agents-meta";

const DEFAULT_STARTERS = [
  "What should I focus on today?",
  "Draft a follow-up to a stalled lead.",
  "What COIs expire in the next 30 days?",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AssistantChat({
  starters = DEFAULT_STARTERS,
  initialConversationId,
  initialAgent = "qwen",
}: {
  starters?: string[];
  initialConversationId?: string;
  initialAgent?: DevAgent;
}) {
  const [agent, setAgent] = useState<DevAgent>(initialAgent);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  // Plain state, deliberately not useTransition: a turn can run for minutes,
  // React keeps a transition pending for its whole await chain, and every later
  // transition — including the App Router's own soft navigation — is entangled
  // behind it. That's what made clicking another page do nothing until the
  // agent answered.
  const [pending, setPending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // Live "what Claude is doing" log (streamed from the run's activity column)
  // and the per-run model/mode/effort selected for Claude turns.
  const [activity, setActivity] = useState<string>("");
  const [claudeOpts, setClaudeOpts] = useState<ClaudeOptions>(CLAUDE_DEFAULTS);
  // The /ai page intentionally starts with NO page context — Joe sets it via the
  // "Looking at" chip when he wants it (the ⌘K popup is what auto-carries a
  // route). A transient notice line surfaces slash-command / mode changes.
  const [pageCtx, setPageCtx] = useState<string>("");
  const [editingCtx, setEditingCtx] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const meta = AGENT_META[agent];

  // This mount's claim on the visible thread. A poll loop holds the token it
  // started under and checks it, so leaving the page (or switching threads)
  // stops the loop instead of letting it setState on a dead fiber and hit the
  // server every 2s for another 16 minutes. The run itself finishes server-side
  // regardless — reopening the thread picks it back up from dev_agent_runs.
  const liveRef = useRef({ alive: true });
  const claim = () => {
    liveRef.current.alive = false;
    liveRef.current = { alive: true };
    return liveRef.current;
  };

  const flashNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? "" : n)), 2500);
  };

  const {
    attachments,
    setAttachments,
    uploading,
    fileInputRef,
    uploadFiles,
    uploadFromTransfer,
    removeAttachment,
  } = useChatAttachments(flashNotice);

  const refreshList = useCallback(
    async (a: DevAgent) => setConversations(await listConversationsAction(a)),
    [],
  );

  const scrollDown = () =>
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }),
    );

  // Poll an in-flight run (Claude, Qwen, or Hermes) to completion, streaming
  // its live activity and then appending its reply. 480 * 2s = 16min, just
  // past the failStaleRuns() backstop so a real Hermes turn always resolves
  // itself before the client gives up on it.
  //
  // `live` is the caller's claim on this thread (see `claim` above): once it's
  // dead the loop is orphaned, so it stops and leaves the run to be resumed by
  // the next mount, which finds it via the thread's pendingRunId.
  const pollClaude = async (runId: string, live: { alive: boolean }) => {
    for (let i = 0; i < 480; i++) {
      await sleep(2000);
      if (!live.alive) return;
      const p = await pollAgentRun(runId);
      if (!live.alive) return;
      if (!p.ok) {
        setActivity("");
        setMessages((m) => [
          ...m,
          { id: `err-${runId}`, role: "assistant", body: `⚠️ ${p.error}`, costUsd: null, createdAt: "", subjectWorkItemId: null },
        ]);
        return;
      }
      if (p.status === "done") {
        setActivity("");
        setMessages((m) => [
          ...m,
          { id: `run-${runId}`, role: "assistant", body: p.answer, costUsd: p.costUsd, createdAt: "", subjectWorkItemId: null },
        ]);
        scrollDown();
        return;
      }
      setActivity(p.activity ?? "");
    }
  };

  // Open a conversation: load its messages and resume any run still in flight.
  // The messages come from the database, so a reply that landed while this
  // thread wasn't on screen is already in what we load.
  const openConversation = async (id: string) => {
    const live = claim();
    setPending(true);
    setActiveId(id);
    rememberThread(ASK_THREAD, id);
    setElapsed(0);
    setActivity("");
    try {
      const detail = await loadConversationAction(id);
      if (!live.alive) return;
      if (!detail) {
        rememberThread(ASK_THREAD, null);
        return;
      }
      setAgent(detail.agent);
      setMessages(detail.messages);
      scrollDown();
      if (detail.pendingRunId) await pollClaude(detail.pendingRunId, live);
    } finally {
      if (live.alive) setPending(false);
    }
  };

  // Whenever the agent changes: list that agent's threads (async setState).
  useEffect(() => {
    let alive = true;
    listConversationsAction(agent).then((cs) => alive && setConversations(cs));
    return () => {
      alive = false;
    };
  }, [agent]);

  // On arrival: open the deep-linked thread (?c=), or failing that whatever
  // thread was open when Joe last left this page. That reload is what shows a
  // reply that landed while he was elsewhere, and it resumes the poll for a run
  // that's still going. Unmount drops this mount's claim so any live poll stops.
  useEffect(() => {
    const id = initialConversationId ?? recallThread(ASK_THREAD);
    if (id) void openConversation(id);
    return () => {
      liveRef.current.alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick an elapsed counter while a (Claude) turn runs. Reset happens where work
  // starts (send / openConversation), so nothing setStates synchronously here.
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [pending]);

  function switchAgent(a: DevAgent) {
    if (a === agent || pending) return;
    claim();
    rememberThread(ASK_THREAD, null);
    setAgent(a);
    setActiveId(null);
    setMessages([]);
    setInput("");
    setAttachments([]);
  }

  function newChat() {
    if (pending) return;
    claim();
    rememberThread(ASK_THREAD, null);
    setActiveId(null);
    setMessages([]);
    setInput("");
    setAttachments([]);
  }

  // Cycle permission modes (Shift+Tab in the composer, like the CLI).
  function cycleMode(dir = 1) {
    setClaudeOpts((o) => {
      const i = CLAUDE_MODE_VALUES.indexOf(o.mode);
      const next = CLAUDE_MODE_VALUES[(i + dir + CLAUDE_MODE_VALUES.length) % CLAUDE_MODE_VALUES.length];
      flashNotice(`Mode → ${CLAUDE_MODE_OPTIONS.find((m) => m.value === next)?.label}`);
      return { ...o, mode: next };
    });
  }

  // Slash commands to change Claude controls without touching the dropdowns:
  //   /model opus · /effort high · /mode plan   (returns true if it handled it)
  function handleSlash(raw: string): boolean {
    const m = raw.match(/^\/(model|effort|mode)\s+(\S+)/i);
    if (!m) return false;
    const cmd = m[1].toLowerCase();
    const val = m[2].toLowerCase();
    if (cmd === "model" && CLAUDE_MODEL_OPTIONS.some((o) => o.value === val)) {
      setClaudeOpts((o) => ({ ...o, model: val as ClaudeModel }));
      flashNotice(`Model → ${val}`);
      return true;
    }
    if (cmd === "effort" && CLAUDE_EFFORT_OPTIONS.some((o) => o.value === val)) {
      setClaudeOpts((o) => ({ ...o, effort: val as ClaudeEffort }));
      flashNotice(`Effort → ${val}`);
      return true;
    }
    if (cmd === "mode") {
      const hit = CLAUDE_MODE_OPTIONS.find((o) => o.value.toLowerCase() === val || o.label.toLowerCase() === val);
      if (hit) {
        setClaudeOpts((o) => ({ ...o, mode: hit.value }));
        flashNotice(`Mode → ${hit.label}`);
        return true;
      }
    }
    flashNotice(`Unknown ${cmd} "${val}"`);
    return true; // consume the slash even if the value was invalid
  }

  function send(qRaw: string) {
    const q = qRaw.trim();
    // `uploading`: don't let the turn leave without the file still in flight.
    if (pending || uploading) return;
    // Slash commands adjust Claude controls instead of sending a message.
    if (agent === "claude" && q.startsWith("/") && handleSlash(q)) {
      setInput("");
      return;
    }
    const files = attachments;
    if (!q && !files.length) return;
    const sentAgent = agent;
    const ctx = sentAgent === "claude" && pageCtx.trim() ? pageCtx.trim() : undefined;
    const opts = sentAgent === "claude" ? claudeOpts : undefined;
    const bodyNote = files.length ? `${q}${q ? "\n\n" : ""}📎 ${files.map((f) => f.name).join(", ")}` : q;
    setInput("");
    setAttachments([]);
    setElapsed(0);
    setActivity("");
    setMessages((m) => [
      ...m,
      { id: `u-${Date.now()}`, role: "user", body: bodyNote, costUsd: null, createdAt: "", subjectWorkItemId: null },
    ]);
    scrollDown();

    // Fire the turn as plain async work rather than a transition — see the
    // `pending` declaration. Navigating away mid-turn is fine: the run finishes
    // server-side and the reply is waiting in the thread when Joe comes back.
    const live = liveRef.current;
    void (async () => {
      setPending(true);
      try {
        let convId = activeId;
        if (!convId) {
          convId = await newConversationAction(sentAgent);
          // Straight to the thread memory as well as to state: if Joe left
          // while the thread was being opened, setActiveId lands on an
          // unmounted component, and without this the next visit would start a
          // second conversation instead of returning to this one.
          rememberThread(ASK_THREAD, convId);
          setActiveId(convId);
        }
        const r = await sendMessageAction(convId, q, ctx, opts, files);
        if (!live.alive) return;
        if (!r.ok) {
          // Re-stage the files: the turn never reached the model, and re-picking
          // uploads is more annoying than retyping a prompt. Prepend rather than
          // replace — anything staged while the turn was in flight is still live.
          setAttachments((cur) => [...files, ...cur]);
          setMessages((m) => [
            ...m,
            { id: `err-${Date.now()}`, role: "assistant", body: `⚠️ ${r.error}`, costUsd: null, createdAt: "", subjectWorkItemId: null },
          ]);
        } else if (r.kind === "answer") {
          setMessages((m) => [...m, r.message]);
          scrollDown();
        } else {
          await pollClaude(r.runId, live);
        }
        if (live.alive) await refreshList(sentAgent);
      } finally {
        if (live.alive) setPending(false);
      }
    })();
  }

  async function rename(id: string, current: string) {
    const next = window.prompt("Rename conversation", current);
    if (next && next.trim()) {
      await renameConversationAction(id, next.trim());
      await refreshList(agent);
    }
  }

  async function archive(id: string) {
    await archiveConversationAction(id, true);
    if (id === activeId) newChat();
    await refreshList(agent);
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this conversation permanently?")) return;
    await deleteConversationAction(id);
    if (id === activeId) newChat();
    await refreshList(agent);
  }

  const activeTitle = conversations.find((c) => c.id === activeId)?.title;

  return (
    <div className="flex h-full min-w-0">
      {/* ─── Conversation rail ─────────────────────────────────────── */}
      <aside className="hidden w-60 flex-none flex-col border-r border-rule bg-paper-2 md:flex">
        <div className="border-b border-rule p-2.5">
          <div className="flex rounded-lg border border-rule bg-card p-0.5">
            {AGENT_ORDER.map((a) => (
              <button
                key={a}
                onClick={() => switchAgent(a)}
                disabled={pending}
                className={`flex-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors disabled:opacity-50 ${
                  a === agent ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper"
                }`}
              >
                {AGENT_META[a].label}
              </button>
            ))}
          </div>
          <button
            onClick={newChat}
            disabled={pending}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-rule bg-card py-1.5 text-[12.5px] text-ink-2 transition-colors hover:bg-paper disabled:opacity-50"
          >
            <Plus className="size-3.5" strokeWidth={1.75} /> New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5">
          {conversations.length === 0 ? (
            <p className="px-2 py-3 text-[11.5px] text-ink-4">
              No {meta.label} chats yet.
            </p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-md px-2 py-1.5 ${
                  c.id === activeId ? "bg-card" : "hover:bg-card/60"
                }`}
              >
                <MessageSquare className="size-3 flex-none text-ink-4" strokeWidth={1.5} />
                <button
                  onClick={() => openConversation(c.id)}
                  className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink-2"
                  title={c.title}
                >
                  {c.title}
                </button>
                <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => rename(c.id, c.title)} aria-label="Rename" className="rounded p-0.5 hover:bg-paper-2">
                    <Pencil className="size-3 text-ink-4" strokeWidth={1.5} />
                  </button>
                  <button onClick={() => archive(c.id)} aria-label="Archive" className="rounded p-0.5 hover:bg-paper-2">
                    <Archive className="size-3 text-ink-4" strokeWidth={1.5} />
                  </button>
                  <button onClick={() => remove(c.id)} aria-label="Delete" className="rounded p-0.5 hover:bg-paper-2">
                    <Trash2 className="size-3 text-flag" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ─── Chat pane ─────────────────────────────────────────────── */}
      <section className="flex h-full min-w-0 flex-1 flex-col">
        {/* header: page-context chip for Claude + active title */}
        <div className="flex items-center gap-2 border-b border-rule bg-paper-2 px-7 py-2">
          <span className="truncate text-[12px] font-medium text-ink-2">
            {activeTitle ?? `New ${meta.label} chat`}
          </span>
          <span className="text-[11px] text-ink-4">· {meta.note}</span>
          <div className="flex-1" />
          {agent === "claude" && (
            <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
              <span className="text-ink-4">Looking at:</span>
              {editingCtx ? (
                <input
                  value={pageCtx}
                  autoFocus
                  onChange={(e) => setPageCtx(e.target.value)}
                  onBlur={() => setEditingCtx(false)}
                  onKeyDown={(e) => e.key === "Enter" && setEditingCtx(false)}
                  placeholder="/route"
                  className="w-28 rounded border border-rule bg-card px-1.5 py-0.5 font-mono text-[11px] text-ink outline-none"
                />
              ) : (
                <button
                  onClick={() => setEditingCtx(true)}
                  className="flex items-center gap-1 rounded border border-rule bg-card px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:bg-paper"
                >
                  {pageCtx || "none"}
                  <Pencil className="size-2.5 text-ink-4" strokeWidth={1.5} />
                </button>
              )}
            </div>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-7 py-6">
          <div className="mx-auto flex max-w-[760px] flex-col gap-3.5">
            {messages.length === 0 && (
              <div className="mt-6">
                <div className="flex items-center gap-2 text-ai-2">
                  <Sparkles className="size-4" strokeWidth={1.5} />
                  <span className="font-serif text-[18px] font-semibold">Ask {meta.label}</span>
                </div>
                <p className="mt-1 text-[13px] text-ink-3">
                  {agent === "claude"
                    ? "Point Claude at a page and it'll edit the code directly (via your CLI login). Follow-ups in this thread keep context. Rebuild to see changes."
                    : "Questions about your jobs, leads, money, schedule — grounded in your data."}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(agent === "claude"
                    ? ["Fix what I described on the page I was just on.", "What files render this route?"]
                    : starters
                  ).map((s) => (
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

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex items-start gap-2.5">
                  <Avatar initials="J" kind="accent" />
                  <div className="flex-1 pt-0.5 text-[13.5px] text-ink">{m.body}</div>
                </div>
              ) : (
                <div key={m.id} className="flex items-start gap-2.5">
                  <Avatar initials={meta.initials} kind="ai" />
                  <div className="flex-1">
                    <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-4">
                      {meta.label}
                      {typeof m.costUsd === "number" && Number.isFinite(m.costUsd) && (
                        <span className="text-ink-4">· ${m.costUsd.toFixed(2)}</span>
                      )}
                    </div>
                    <Card kind="ai" className="p-3">
                      <div
                        className={`whitespace-pre-wrap text-[13px] leading-relaxed ${m.body.startsWith("⚠️") ? "text-flag" : "text-ai-2"}`}
                      >
                        {m.body}
                      </div>
                    </Card>
                  </div>
                </div>
              ),
            )}

            {pending && (
              <div className="flex items-start gap-2.5">
                <Avatar initials={meta.initials} kind="ai" />
                <div className="flex-1 pt-1">
                  <div className="text-[12px]">
                    <div className="text-ai-2">
                      {agent === "claude"
                        ? claudeOpts.mode === "plan"
                          ? "Claude is planning"
                          : "Claude is working"
                        : `${meta.label} is thinking`}
                      {elapsed > 0 ? ` · ${elapsed}s` : "…"}
                    </div>
                    {(() => {
                      const lines = activity ? activity.split("\n").filter(Boolean) : [];
                      const tail = lines.slice(-4);
                      return tail.length ? (
                        <div className="mt-1.5 space-y-0.5 border-l-2 border-rule pl-2.5">
                          {tail.map((line, i) => (
                            <div
                              key={`${i}-${line}`}
                              className={`font-mono text-[11px] ${
                                i === tail.length - 1 ? "text-ink-2" : "text-ink-4"
                              }`}
                            >
                              {line}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-1 text-ink-4">
                          {agent === "claude" ? "Reading the code…" : "Working on it…"}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* composer */}
        <div className="border-t border-rule bg-paper-2 px-7 py-3.5">
          {agent === "claude" && (
            <div className="mx-auto mb-2 flex max-w-[760px] flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-4">
              <OptSelect
                label="Model"
                value={claudeOpts.model}
                disabled={pending}
                options={CLAUDE_MODEL_OPTIONS}
                onChange={(model) => setClaudeOpts((o) => ({ ...o, model: model as ClaudeOptions["model"] }))}
              />
              <OptSelect
                label="Mode"
                value={claudeOpts.mode}
                disabled={pending}
                options={CLAUDE_MODE_OPTIONS}
                onChange={(mode) => setClaudeOpts((o) => ({ ...o, mode: mode as ClaudeOptions["mode"] }))}
              />
              <OptSelect
                label="Effort"
                value={claudeOpts.effort}
                disabled={pending}
                options={CLAUDE_EFFORT_OPTIONS}
                onChange={(effort) => setClaudeOpts((o) => ({ ...o, effort: effort as ClaudeOptions["effort"] }))}
              />
              <span className="text-ink-4">
                {CLAUDE_MODE_OPTIONS.find((m) => m.value === claudeOpts.mode)?.note}
                <span className="ml-1 text-ink-4/70">· ⇧Tab cycles · /model /effort /mode</span>
              </span>
            </div>
          )}

          {/* transient notice (slash commands / mode cycling) */}
          {notice && (
            <div className="mx-auto mb-1.5 max-w-[760px] text-[11px] font-medium text-ai-2">{notice}</div>
          )}

          {/* attachment chips */}
          {attachments.length > 0 && (
            <div className="mx-auto mb-1.5 flex max-w-[760px] flex-wrap gap-1.5">
              {attachments.map((a, i) => (
                <span
                  key={`${a.path}-${i}`}
                  className="flex items-center gap-1 rounded border border-rule bg-card px-1.5 py-0.5 text-[11px] text-ink-2"
                >
                  <Paperclip className="size-3 text-ink-4" strokeWidth={1.5} />
                  <span className="max-w-[160px] truncate">{a.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => removeAttachment(i)}
                    className="rounded p-0.5 hover:bg-paper-2"
                  >
                    <X className="size-3 text-ink-4" strokeWidth={1.75} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="mx-auto flex max-w-[760px] items-center gap-2 rounded-lg border border-rule bg-card p-2 pl-3"
          >
            <Sparkles className="size-4 flex-none text-ai" strokeWidth={1.5} />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => uploadFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending || uploading}
              aria-label="Attach files"
              title="Attach files"
              className="flex size-7 flex-none items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-paper-2 disabled:opacity-40"
            >
              <Paperclip className={`size-4 ${uploading ? "animate-pulse" : ""}`} strokeWidth={1.75} />
            </button>
            <VoiceButton compact onText={(t) => setInput((cur) => mergeTranscript(cur, t))} />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (agent === "claude" && e.key === "Tab" && e.shiftKey) {
                  e.preventDefault();
                  cycleMode(1);
                }
              }}
              onPaste={(e) => {
                // Pasting a screenshot straight into the box attaches it.
                if (uploadFromTransfer(e.clipboardData)) e.preventDefault();
              }}
              placeholder={
                agent === "claude" ? `Ask Claude… (⇧Tab: ${CLAUDE_MODE_OPTIONS.find((m) => m.value === claudeOpts.mode)?.label})` : `Ask ${meta.label} anything…`
              }
              className="flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-4"
            />
            <button
              type="submit"
              disabled={pending || uploading || (!input.trim() && attachments.length === 0)}
              aria-label="Send"
              className="flex size-7 flex-none items-center justify-center rounded-md bg-ink text-paper transition-colors hover:bg-[#232a1e] disabled:opacity-40"
            >
              <ArrowUp className="size-4" strokeWidth={2} />
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

/** Compact labeled dropdown for the Claude run controls. */
function OptSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-1">
      <span>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-rule bg-card px-1.5 py-0.5 text-[11px] text-ink-2 outline-none disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
