"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Plus,
  History,
  Paperclip,
  X,
  Mic,
  AudioLines,
  Volume2,
  Loader2,
  ArrowUp,
  Square,
  ShieldQuestion,
  CircleHelp,
} from "lucide-react";
import { VoiceButton } from "@/components/ui";
import { mergeTranscript } from "@/lib/append-transcript";
import { useVoiceRound } from "@/lib/use-voice-round";
import { approveGrant, denyGrant } from "@/lib/actions/owner-grants";
import type { PendingGrant } from "@/lib/actions/dev-agents";
import type {
  AgentInteraction,
  InteractionQuestion,
  InteractionResponse,
  PermissionPayload,
  QuestionPayload,
} from "@/lib/agent-interactions";
import { useChatAttachments } from "./useChatAttachments";
import { ThreadList } from "./ThreadList";
import {
  AGENT_META,
  AGENT_ORDER,
  CLAUDE_CONTEXT_WINDOW,
  CLAUDE_MODEL_OPTIONS,
  CLAUDE_MODE_OPTIONS,
  CLAUDE_MODE_VALUES,
  CLAUDE_EFFORT_OPTIONS,
  type ClaudeModel,
  type ClaudeEffort,
  type PanelAgent,
} from "@/lib/dev-agents-meta";
import { doItDirective, prepDirective } from "@/lib/today-directives";
import { queueNarration, spokenQueue } from "@/lib/operator-narration";
import { parseModelActions } from "@/lib/today-actions";
import type { TodayPriority } from "@/lib/today";
import { useTodayQueue } from "@/components/today/TodayQueueContext";
import { PriorityCard } from "@/components/today/PriorityCard";
import { ModelActionChips } from "@/components/today/ModelActionChips";
import { consumeHandOff, subscribePanelBus } from "./panelBus";
import { getPanelPageContext, getPanelPageRoute } from "./PageAiContext";
import { queueContext } from "./queueContext";
import { startersForRoute } from "./panelStarters";
import { useAgentChat, type ActiveRun } from "./useAgentChat";

/** Reply labels for Auto threads (message.agent → name). */
const AGENT_LABELS: Record<string, string> = {
  claude: "Claude",
  qwen: "Qwen",
  hermes: "Hermes",
  concierge: "Claude · voice",
};

/**
 * The universal panel's chat — successor to OperatorChat, AssistantChat, the
 * ⌘K CommandBar and the Today/newsletter chats, in one surface. Engine:
 * useAgentChat. Console traits kept: deterministic queueNarration opening,
 * hand-off directives, run lifecycle reported up. Ask-page traits kept:
 * thread history (drawer), Claude model/mode/effort controls with /model
 * /effort /mode and ⇧Tab, attachments (pick + paste), dictation. New: voice
 * conversation rounds — push-to-talk in, spoken answers out (local Piper).
 */
export function PanelChat({
  registerHandOff,
  onRunStart,
  onRunEnd,
  showQueueCards,
  compact = false,
  threadsRail = false,
}: {
  registerHandOff: (fn: (p: TodayPriority, kind: "do" | "prep") => void) => void;
  onRunStart: (run: ActiveRun) => void;
  onRunEnd: () => void;
  showQueueCards: boolean;
  /** Mobile drawer over another page: no narration/cards/starters — just the
   *  conversation and composer, so most of the page stays visible. */
  compact?: boolean;
  /** Wide dock/popout: the thread list rides beside the chat as its own
   *  always-visible column (T3-style); narrower docks keep the History
   *  overlay drawer instead. */
  threadsRail?: boolean;
}) {
  const { priorities, waiting, refresh } = useTodayQueue();
  const [prompt, setPrompt] = useState("");
  const [flash, setFlash] = useState("");
  const [threadsOpen, setThreadsOpen] = useState(false);
  // Per-message express permission: the next Claude turn gets a short-lived
  // owner grant for client-facing sends (bid packages, POs, invoices, emails…).
  // Plain state, never written to panelStore, and reset after every send so a
  // grant never outlives the message that gave it.
  const [allowSends, setAllowSends] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const flashNotice = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((n) => (n === msg ? "" : n)), 2500);
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

  const voice = useVoiceRound({
    send: async (text) => submitVoice(text),
    onError: flashNotice,
  });

  // Every turn is grounded in the live queue (ids included) PLUS whatever
  // page the app view is showing — read at send time via a ref so the poll
  // loop never captures a stale queue.
  const queueRef = useRef({ priorities, waiting });
  useEffect(() => {
    queueRef.current = { priorities, waiting };
  });
  const getPageContext = () => {
    const q = queueContext(queueRef.current.priorities, queueRef.current.waiting);
    const page = getPanelPageContext();
    return page ? `${q}\n\n${page}` : q;
  };

  const chat = useAgentChat({
    getPageContext,
    onRunStart,
    onRunEnd,
    onSettled: refresh,
    // Claude's own voice reply is already plain speech; a delegated run's
    // written answer gets condensed server-side into a spoken update.
    onAnswer: (id, body, spoken) => (spoken ? voice.speak(id, body) : voice.speakRun(id)),
    onSendError: (spec) => {
      // Re-stage the files: the turn never reached the model, and re-picking
      // uploads is more annoying than retyping a prompt.
      if (spec.attachments?.length) setAttachments((cur) => [...spec.attachments!, ...cur]);
    },
  });
  const meta = AGENT_META[chat.agent];

  const narration = queueNarration(priorities, { items: waiting, total: waiting.length });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages.length, chat.activity, chat.pending]);

  // ─── Claude controls: ⇧Tab mode cycling + slash commands ──────────────────

  const cycleMode = (dir = 1) => {
    const i = CLAUDE_MODE_VALUES.indexOf(chat.claudeOpts.mode);
    const next = CLAUDE_MODE_VALUES[(i + dir + CLAUDE_MODE_VALUES.length) % CLAUDE_MODE_VALUES.length];
    chat.setClaudeOpts({ mode: next });
    flashNotice(`Mode → ${CLAUDE_MODE_OPTIONS.find((m) => m.value === next)?.label}`);
  };

  //   /model opus · /effort high · /mode plan · /mcp off · /session new ·
  //   /stop   (returns true if it handled it)
  const handleSlash = (raw: string): boolean => {
    const m = raw.match(/^\/(model|effort|mode|mcp|tools|session|stop)(?:\s+(\S+))?/i);
    if (!m) return false;
    const cmd = m[1].toLowerCase();
    const val = (m[2] ?? "").toLowerCase();
    if (cmd === "stop") {
      chat.stop();
      flashNotice("Stopping the run…");
      return true;
    }
    if (cmd === "session") {
      if (val === "new" || val === "fresh" || val === "") {
        chat.freshSession();
        flashNotice("Fresh CLI session — next Claude turn starts clean");
        return true;
      }
    }
    if (cmd === "mcp" || cmd === "tools") {
      if (val === "on" || val === "off") {
        chat.setClaudeOpts({ withMcp: val === "on" });
        flashNotice(`Business tools (MCP) → ${val}`);
        return true;
      }
    }
    if (cmd === "model" && CLAUDE_MODEL_OPTIONS.some((o) => o.value === val)) {
      chat.setClaudeOpts({ model: val as ClaudeModel });
      flashNotice(`Model → ${val}`);
      return true;
    }
    if (cmd === "effort" && CLAUDE_EFFORT_OPTIONS.some((o) => o.value === val)) {
      chat.setClaudeOpts({ effort: val as ClaudeEffort });
      flashNotice(`Effort → ${val}`);
      return true;
    }
    if (cmd === "mode") {
      const hit = CLAUDE_MODE_OPTIONS.find((o) => o.value.toLowerCase() === val || o.label.toLowerCase() === val);
      if (hit) {
        chat.setClaudeOpts({ mode: hit.value });
        flashNotice(`Mode → ${hit.label}`);
        return true;
      }
    }
    flashNotice(`Unknown ${cmd} "${val}"`);
    return true; // consume the slash even if the value was invalid
  };

  // ─── Sending ───────────────────────────────────────────────────────────────

  const submitText = (raw: string) => {
    const q = raw.trim();
    // Slash commands work even mid-run (/stop is FOR mid-run) and in Auto
    // threads (the options apply whenever Claude is the one who runs).
    if ((chat.agent === "claude" || chat.agent === "auto") && q.startsWith("/") && handleSlash(q)) {
      setPrompt("");
      return;
    }
    if (chat.pending || uploading) return;
    const files = attachments;
    if (!q && !files.length) return;
    const display = files.length ? `${q}${q ? "\n\n" : ""}📎 ${files.map((f) => f.name).join(", ")}` : q;
    setPrompt("");
    setAttachments([]);
    chat.submit({
      directive: q,
      display,
      attachments: files,
      // Auto counts too — the router may hand this turn to Claude.
      allowSends: (chat.agent === "claude" || chat.agent === "auto") && allowSends ? true : undefined,
    });
    setAllowSends(false);
  };

  /** Voice-mode send: the transcript goes to the Claude concierge, which
   *  speaks back immediately and delegates any OS work. */
  const submitVoice = (text: string) => {
    const q = text.trim();
    if (!q || chat.pending) return;
    chat.submit({ directive: q, voice: true });
  };

  // "Have Hermes do it" / "Prep me" — same directives as the operator console.
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
    const target: PanelAgent = chat.agent === "claude" ? "qwen" : chat.agent;
    chat.submit({
      directive: prepDirective(p),
      display: `✦ Prep me — ${p.title}`,
      agent: target,
      subjectId: p.id,
    });
  };

  // Expose the live handOff closure to the sibling queue column via the dock,
  // and keep a latest-ref for the bus relay below.
  const handOffRef = useRef(handOff);
  useEffect(() => {
    registerHandOff(handOff);
    handOffRef.current = handOff;
  });

  // Hand-offs raised outside this component — /today cards (same window,
  // local echo) or another window entirely. The stash covers a hand-off fired
  // before this chat mounted (e.g. mobile sheet opening in response to it).
  useEffect(() => {
    const stashed = consumeHandOff();
    if (stashed) handOffRef.current(stashed.priority, stashed.kind);
    return subscribePanelBus((m) => {
      if (m.type !== "handoff") return;
      consumeHandOff(); // claimed — clear the stash
      handOffRef.current(m.priority, m.kind);
    });
  }, []);

  // ⌘/Ctrl+K focuses the composer — the panel is the app's one Ask surface.
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

  // ─── Thread navigation (ThreadList: rail beside the chat, or drawer) ───────

  const openThread = (id: string) => {
    setThreadsOpen(false);
    void chat.openConversation(id);
    inputRef.current?.focus();
  };

  const newThread = () => {
    setThreadsOpen(false);
    chat.newChat();
    inputRef.current?.focus();
  };

  // Reload the list when the open thread changes or a turn settles (a fresh
  // thread gets its real title on the first settled turn).
  const threadsRefreshKey = `${chat.conversationId ?? ""}:${chat.pending ? 1 : 0}`;

  const activityLines = chat.activity ? chat.activity.split("\n").filter(Boolean).slice(-4) : [];
  const route = getPanelPageRoute();
  const starters = startersForRoute(route, chat.agent);

  const chatSection = (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border-[1.5px] border-ai bg-paper shadow-card">
      {/* Header: agent picker + history + New chat */}
      <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
        <div className="flex rounded-md border border-rule bg-paper-2 p-0.5">
          {AGENT_ORDER.map((a) => (
            <button
              key={a}
              onClick={() => {
                chat.selectAgent(a);
                inputRef.current?.focus();
              }}
              // Live mid-run: the current turn is left running in its own
              // thread rather than blocking the rail (useAgentChat.detachRun).
              title={
                chat.pending && a !== chat.agent
                  ? `Start a ${AGENT_META[a].label} chat — the turn in flight keeps running and its answer waits in that thread`
                  : AGENT_META[a].label
              }
              className={`rounded px-2.5 py-0.5 text-[11.5px] font-medium transition-colors ${
                a === chat.agent ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper"
              }`}
            >
              {AGENT_META[a].label}
            </button>
          ))}
        </div>
        {route && (
          <span className="hidden truncate font-mono text-[10.5px] text-ink-4 min-[460px]:inline" title="The page the app view is showing — turns are grounded in it">
            {route}
          </span>
        )}
        <div className="flex-1" />
        {!threadsRail && (
          <button
            onClick={() => setThreadsOpen((o) => !o)}
            aria-label="Threads"
            title="Threads"
            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-paper"
          >
            <History className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
        {chat.messages.length > 0 && (
          <button
            onClick={newThread}
            aria-label="New chat"
            title={
              chat.pending
                ? "New chat — the turn in flight keeps running; its answer waits in that thread"
                : "New chat"
            }
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-paper"
          >
            <Plus className="size-3" strokeWidth={2} /> New
          </button>
        )}
      </div>

      {/* Thread drawer — overlays the transcript on narrow docks/mobile */}
      {!threadsRail && threadsOpen && (
        <div className="absolute inset-x-0 top-[41px] bottom-0 z-10 flex flex-col bg-paper">
          <ThreadList
            variant="drawer"
            className="min-h-0 flex-1"
            currentId={chat.conversationId}
            refreshKey={threadsRefreshKey}
            onOpen={openThread}
            onNew={newThread}
            onClose={() => setThreadsOpen(false)}
            onCurrentRemoved={newThread}
          />
        </div>
      )}

      {/* Scroll area: narration → starters/cards → transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {!compact && (
          <div className="whitespace-pre-wrap rounded-md bg-ai-soft px-3 py-2 text-[12.5px] leading-relaxed text-ai-2">
            {narration}
          </div>
        )}

        {showQueueCards && !compact && (
          <div className="mt-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
              Priorities
            </div>
            <div className="flex flex-col gap-2.5">
              {priorities.map((p) => (
                <PriorityCard key={p.id} p={p} onHandOff={handOff} />
              ))}
            </div>
          </div>
        )}

        {chat.messages.length === 0 && !compact && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {starters.map((s) => (
              <button
                key={s}
                onClick={() => submitText(s)}
                className="rounded-full border border-rule bg-paper px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:bg-paper-2"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {(chat.messages.length > 0 || chat.notice) && (
          <div className={compact ? "flex flex-col gap-2.5" : "mt-4 flex flex-col gap-2.5 border-t border-rule pt-3"}>
            {chat.notice && <div className="text-[11px] font-medium text-ai-2">{chat.notice}</div>}
            {chat.messages.map((m) => {
              if (m.role === "user") {
                return (
                  <div key={m.id} className="whitespace-pre-wrap text-[12.5px] font-medium text-ink-2">
                    {m.body}
                  </div>
                );
              }
              // Strip any sjcos-actions fence from display; the parsed actions
              // render as app-validated chips (ModelActionChips only shows a
              // chip when its id matches a live queue card — the model can
              // name an item, never invent one).
              const parsed = parseModelActions(m.body);
              // In an Auto thread the answering model changes turn to turn —
              // label each reply so the transcript reads as the hand-offs
              // actually happened.
              const who = chat.agent === "auto" && m.agent ? AGENT_LABELS[m.agent] : undefined;
              const hasCost = typeof m.costUsd === "number" && Number.isFinite(m.costUsd);
              const turns = (m.tokenUsage as { num_turns?: number } | null | undefined)?.num_turns;
              return (
                <div key={m.id}>
                  {(who || hasCost || turns) && (
                    <div className="mb-0.5 text-[10.5px] font-medium text-ink-4">
                      {[who, hasCost ? `$${(m.costUsd as number).toFixed(2)}` : null, turns ? `${turns} turns` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                  <div
                    className={`whitespace-pre-wrap rounded-md bg-ai-soft px-3 py-2 text-[13px] leading-relaxed ${
                      m.body.startsWith("⚠️") ? "text-flag" : "text-ai-2"
                    }`}
                  >
                    {parsed.body}
                  </div>
                  <ModelActionChips actions={parsed.actions} />
                  {chat.logs[m.id] && <ActivityLog text={chat.logs[m.id]} done />}
                </div>
              );
            })}
            {/* The agent is blocked on Joe: question boxes + tool approvals,
                answered right here (the blocked call resumes within ~2s). */}
            {chat.interactions.map((it) =>
              it.kind === "question" ? (
                <QuestionCard key={it.id} interaction={it} onRespond={chat.respond} onDismiss={chat.dismiss} />
              ) : (
                <ApprovalCard key={it.id} interaction={it} onRespond={chat.respond} />
              ),
            )}
            {/* request_owner_permission → approve/deny inline instead of
                leaving the chat for /engine/permissions. */}
            {chat.grants.map((g) => (
              <GrantCard key={g.id} grant={g} onDone={chat.dropGrant} />
            ))}
            {chat.pending && (
              <div className="text-[12px]">
                <div className="flex items-center gap-2 text-ai-2">
                  <span>
                    {chat.interactions.length > 0 || chat.grants.length > 0
                      ? `${meta.label === "Auto" ? "The agent" : meta.label} is waiting on you`
                      : chat.agent === "claude" && chat.claudeOpts.mode === "plan"
                        ? "Claude is planning"
                        : `${meta.label} is working`}
                    {chat.elapsed > 0 ? ` · ${chat.elapsed}s` : "…"}
                  </span>
                  {chat.activeRunId && (
                    <button
                      type="button"
                      onClick={chat.stop}
                      title="Stop this run (the agent is told it was stopped)"
                      className="flex items-center gap-1 rounded border border-rule px-1.5 py-0.5 text-[10.5px] font-medium text-flag transition-colors hover:bg-paper-2"
                    >
                      <Square className="size-2.5 fill-current" strokeWidth={2} /> Stop
                    </button>
                  )}
                </div>
                {activityLines.length > 0 && <ActivityLog text={chat.activity} />}
              </div>
            )}
            {/* Plan-mode hand-off: the plan just landed — one click flips to
                Accept edits and tells Claude to build it. */}
            {!chat.pending &&
              chat.claudeOpts.mode === "plan" &&
              (chat.agent === "claude" || chat.agent === "auto") &&
              chat.messages.length > 0 &&
              chat.messages[chat.messages.length - 1].role === "assistant" &&
              chat.messages[chat.messages.length - 1].agent === "claude" &&
              !chat.messages[chat.messages.length - 1].body.startsWith("⚠️") && (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      chat.setClaudeOpts({ mode: "acceptEdits" });
                      chat.submit({
                        directive:
                          "Go ahead — implement the plan you proposed above. You are no longer in plan mode.",
                        display: "✦ Approve plan — build it",
                      });
                    }}
                    className="rounded-md bg-ink px-2.5 py-1 text-[11.5px] font-medium text-paper transition-colors hover:bg-[#232a1e]"
                  >
                    Approve plan → build it
                  </button>
                </div>
              )}
          </div>
        )}

        {chat.error && <div className="mt-3 text-[13px] text-flag">{chat.error}</div>}
      </div>

      {/* Claude run controls — also shown on Auto (they apply whenever the
          router hands the turn to Claude). */}
      {(chat.agent === "claude" || chat.agent === "auto") && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule px-3 py-1.5 text-[11px] text-ink-4">
          <OptSelect
            label="Model"
            value={chat.claudeOpts.model}
            disabled={chat.pending}
            options={CLAUDE_MODEL_OPTIONS}
            onChange={(model) => chat.setClaudeOpts({ model: model as ClaudeModel })}
          />
          <OptSelect
            label="Mode"
            value={chat.claudeOpts.mode}
            disabled={chat.pending}
            options={CLAUDE_MODE_OPTIONS}
            onChange={(mode) => chat.setClaudeOpts({ mode: mode as (typeof CLAUDE_MODE_VALUES)[number] })}
          />
          <OptSelect
            label="Effort"
            value={chat.claudeOpts.effort}
            disabled={chat.pending}
            options={CLAUDE_EFFORT_OPTIONS}
            onChange={(effort) => chat.setClaudeOpts({ effort: effort as ClaudeEffort })}
          />
          <label
            className="flex cursor-pointer items-center gap-1"
            title="Load the sjcos business tools into the Claude run. Off = code-only run (skips the tool-schema token cost)."
          >
            <input
              type="checkbox"
              checked={chat.claudeOpts.withMcp}
              disabled={chat.pending}
              onChange={(e) => chat.setClaudeOpts({ withMcp: e.target.checked })}
              className="size-3 accent-ai disabled:opacity-50"
            />
            <span>Tools</span>
          </label>
          <label
            className="flex cursor-pointer items-center gap-1"
            title="Express permission: let Claude actually SEND what this message asks for (bid packages, POs, invoices, documents, newsletter, one-off emails). One message only — resets after send; every send is audited on /engine/permissions."
          >
            <input
              type="checkbox"
              checked={allowSends}
              disabled={chat.pending}
              onChange={(e) => setAllowSends(e.target.checked)}
              className="size-3 accent-ai disabled:opacity-50"
            />
            <span className={allowSends ? "font-medium text-flag" : undefined}>Express permission (sends)</span>
          </label>
          {chat.contextTokens != null && <ContextMeter tokens={chat.contextTokens} />}
          {chat.claudeSessionId && !chat.pending && (
            <span className="flex items-center gap-1" title={`CLI session ${chat.claudeSessionId} — Claude remembers this thread's files and context. "Fresh" starts the next turn clean.`}>
              <span className="font-mono text-[10px] text-ink-4">session {chat.claudeSessionId.slice(0, 8)}</span>
              <button
                type="button"
                onClick={chat.freshSession}
                className="rounded border border-rule px-1 py-px text-[10px] text-ink-3 transition-colors hover:bg-paper-2"
              >
                Fresh
              </button>
            </span>
          )}
          <span className="hidden text-ink-4/70 min-[520px]:inline">
            ⇧Tab cycles · /model /effort /mode /mcp /session /stop
          </span>
        </div>
      )}

      {/* transient notice (slash commands / voice errors) */}
      {flash && <div className="border-t border-rule px-3 py-1 text-[11px] font-medium text-ai-2">{flash}</div>}

      {/* attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-rule px-3 py-1.5">
          {attachments.map((a, i) => (
            <span
              key={`${a.path}-${i}`}
              className="flex items-center gap-1 rounded border border-rule bg-card px-1.5 py-0.5 text-[11px] text-ink-2"
            >
              <Paperclip className="size-3 text-ink-4" strokeWidth={1.5} />
              <span className="max-w-[140px] truncate">{a.name}</span>
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

      {/* Mobile voice bar: a big thumb-zone mic (hands-free rounds) — the
          desktop composer keeps its compact button. */}
      <VoiceBar
        voice={voice}
        latest={chat.pending ? activityLines[activityLines.length - 1] : undefined}
        // Mobile: the first tap opens the session with Claude reading the queue
        // aloud, then listens. Later taps are plain talk / send / interrupt.
        onStart={() => voice.startWithBriefing(spokenQueue(priorities, { items: waiting, total: waiting.length }))}
      />

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitText(prompt);
        }}
        className="flex items-center gap-1.5 border-t border-rule px-3 py-2.5"
      >
        <Sparkles className="size-[18px] flex-none text-ai" strokeWidth={1.5} />
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
          disabled={chat.pending || uploading}
          aria-label="Attach files"
          title="Attach files"
          className="flex size-7 flex-none items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-paper-2 disabled:opacity-40"
        >
          <Paperclip className={`size-4 ${uploading ? "animate-pulse" : ""}`} strokeWidth={1.75} />
        </button>
        <VoiceButton compact onText={(t) => setPrompt((cur) => mergeTranscript(cur, t))} />
        <span className="hidden sm:contents">
          <VoiceRoundButton voice={voice} />
        </span>
        <input
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (chat.agent === "claude" && e.key === "Tab" && e.shiftKey) {
              e.preventDefault();
              cycleMode(1);
            }
          }}
          onPaste={(e) => {
            // Pasting a screenshot straight into the box attaches it.
            if (uploadFromTransfer(e.clipboardData)) e.preventDefault();
          }}
          placeholder={
            voice.voiceMode && voice.phase !== "idle"
              ? voicePlaceholder(voice.phase)
              : `Tell ${meta.label} what to do…`
          }
          className="min-w-0 flex-1 bg-transparent font-serif text-[15px] text-ink outline-none placeholder:text-ink-4"
        />
        <button
          type="submit"
          disabled={chat.pending || uploading || (!prompt.trim() && attachments.length === 0)}
          aria-label="Send"
          className="flex size-7 flex-none items-center justify-center rounded-md bg-ink text-paper transition-colors hover:bg-[#232a1e] disabled:opacity-40"
        >
          <ArrowUp className="size-4" strokeWidth={2} />
        </button>
      </form>
    </section>
  );

  if (!threadsRail) return chatSection;

  // Wide dock / popout: the thread list is its own always-visible column
  // beside the chat, T3-style — browse or start threads while a run works.
  return (
    <div className="flex h-full min-h-0 gap-2">
      <ThreadList
        variant="rail"
        className="w-44 flex-none"
        currentId={chat.conversationId}
        refreshKey={threadsRefreshKey}
        onOpen={openThread}
        onNew={newThread}
        onCurrentRemoved={newThread}
      />
      {chatSection}
    </div>
  );
}

/**
 * "What the agent is doing / did." Live: every line the run has logged so far
 * (Hermes tool calls, the answer taking shape, Claude's reasoning snippets,
 * ladder stages), monospaced, auto-scrolled to the newest, latest line
 * highlighted. Done: the same log folded under the reply as a collapsible so
 * the story stays available without cluttering the transcript.
 */
function ActivityLog({ text, done = false }: { text: string; done?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const lines = text.split(String.fromCharCode(10)).filter(Boolean);
  useEffect(() => {
    if (!done) ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [text, done]);
  if (!lines.length) return null;
  const body = (
    <div
      ref={ref}
      className={`space-y-0.5 overflow-y-auto border-l-2 border-rule pl-2.5 ${done ? "max-h-40" : "max-h-48"}`}
    >
      {lines.map((line, i) => (
        <div
          key={`${i}-${line}`}
          className={`break-words font-mono text-[11px] leading-snug ${
            !done && i === lines.length - 1 ? "text-ink-2" : "text-ink-4"
          }`}
        >
          {line}
        </div>
      ))}
    </div>
  );
  if (!done) return <div className="mt-1.5">{body}</div>;
  return (
    <details className="mt-1 group">
      <summary className="cursor-pointer select-none text-[10.5px] font-medium text-ink-4 hover:text-ink-3">
        What it did · {lines.length} step{lines.length === 1 ? "" : "s"}
      </summary>
      <div className="mt-1">{body}</div>
    </details>
  );
}

function voicePlaceholder(phase: string): string {
  switch (phase) {
    case "recording":
      return "Listening… just talk, it sends when you pause";
    case "transcribing":
      return "Got it…";
    case "waiting":
      return "Claude is thinking…";
    case "speaking":
      return "Claude is speaking — tap the mic to interrupt";
    default:
      return "Voice mode — tap the mic to talk";
  }
}

/** The mobile voice control: one large button in the thumb zone. Idle: tap to
 *  start a hands-free conversation. Then the ring shows listening (with live
 *  mic level), thinking, or Claude speaking; tap = send now / interrupt. The
 *  exit chip ends voice mode. Small screens only — desktop keeps the compact
 *  composer button. */
function VoiceBar({
  voice,
  latest,
  onStart,
}: {
  voice: ReturnType<typeof useVoiceRound>;
  latest?: string;
  /** Session opener (first tap while voice mode is off). */
  onStart: () => void;
}) {
  if (!voice.supported) return null;
  const p = voice.phase;
  const label = !voice.voiceMode
    ? "Talk to Claude"
    : p === "recording"
      ? "Listening…"
      : p === "transcribing"
        ? "Got it…"
        : p === "waiting"
          ? "Claude is thinking…"
          : p === "speaking"
            ? "Claude is speaking"
            : "Tap to talk";
  const ring =
    p === "recording"
      ? `0 0 0 ${6 + Math.round(voice.level * 26)}px rgba(179, 76, 56, 0.18)`
      : p === "speaking"
        ? "0 0 0 10px rgba(96, 122, 79, 0.18)"
        : "none";
  return (
    <div className="flex items-center justify-between gap-3 border-t border-rule bg-paper-2 px-4 py-3 sm:hidden">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink-2">{label}</div>
        <div className="truncate text-[11px] text-ink-4">
          {!voice.voiceMode
            ? "Claude reads your queue, then listens — hands-free"
            : p === "recording"
              ? "Pause to send · tap to send now"
              : p === "speaking"
                ? "Tap to interrupt"
                : latest || "Claude answers and delegates the work"}
        </div>
      </div>
      {voice.voiceMode && (
        <button
          type="button"
          onClick={() => voice.setVoiceMode(false)}
          aria-label="Exit voice mode"
          className="flex size-9 flex-none items-center justify-center rounded-full border border-rule text-ink-3"
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      )}
      <button
        type="button"
        onClick={voice.voiceMode ? voice.micTap : onStart}
        aria-label={label}
        style={{ boxShadow: ring }}
        className={`flex size-16 flex-none items-center justify-center rounded-full transition-[box-shadow,background-color] duration-150 ${
          p === "recording"
            ? "bg-flag text-paper"
            : p === "speaking"
              ? "bg-ai text-paper"
              : p === "transcribing" || p === "waiting"
                ? "bg-ai-soft text-ai-2"
                : "bg-ink text-paper"
        }`}
      >
        {p === "transcribing" || p === "waiting" ? (
          <Loader2 className="size-7 animate-spin" strokeWidth={1.75} />
        ) : p === "speaking" ? (
          <Volume2 className="size-7" strokeWidth={1.75} />
        ) : (
          <Mic className="size-7" strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}

/** Desktop voice control: one button whose icon tracks the round phase,
 *  plus an exit chip while voice mode is on. Renders nothing when either half
 *  of the pipeline (whisper STT / Piper TTS) is unavailable. */
function VoiceRoundButton({ voice }: { voice: ReturnType<typeof useVoiceRound> }) {
  if (!voice.supported) return null;

  if (!voice.voiceMode) {
    return (
      <button
        type="button"
        onClick={voice.micTap}
        aria-label="Start voice conversation"
        title="Voice conversation — hands-free, Claude answers out loud"
        className="flex size-7 flex-none items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-paper-2"
      >
        <AudioLines className="size-4" strokeWidth={1.75} />
      </button>
    );
  }

  const icon =
    voice.phase === "recording" ? (
      <Mic className="size-4 animate-pulse text-flag" strokeWidth={2} />
    ) : voice.phase === "transcribing" || voice.phase === "waiting" ? (
      <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
    ) : voice.phase === "speaking" ? (
      <Volume2 className="size-4 text-ai" strokeWidth={1.75} />
    ) : (
      <Mic className="size-4" strokeWidth={1.75} />
    );

  return (
    <span className="flex flex-none items-center gap-0.5">
      <button
        type="button"
        onClick={voice.micTap}
        aria-label={voice.phase === "recording" ? "Stop and send" : voice.phase === "speaking" ? "Interrupt and talk" : "Talk"}
        title={voice.phase === "recording" ? "Stop and send" : voice.phase === "speaking" ? "Interrupt and talk" : "Talk"}
        className="flex size-7 items-center justify-center rounded-md bg-ai-soft text-ai-2 transition-colors hover:bg-paper-2"
      >
        {icon}
      </button>
      <button
        type="button"
        onClick={() => voice.setVoiceMode(false)}
        aria-label="Exit voice mode"
        title="Exit voice mode"
        className="flex size-5 items-center justify-center rounded text-ink-4 transition-colors hover:bg-paper-2"
      >
        <X className="size-3" strokeWidth={2} />
      </button>
    </span>
  );
}

/** Live context meter: how full the CLI session's window is. */
function ContextMeter({ tokens }: { tokens: number }) {
  const pct = Math.min(100, Math.round((tokens / CLAUDE_CONTEXT_WINDOW) * 100));
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  return (
    <span
      className="flex items-center gap-1"
      title={`Context: ${tokens.toLocaleString()} tokens of ~${k(CLAUDE_CONTEXT_WINDOW)} (${pct}%)`}
    >
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-paper-2">
        <span
          className={`block h-full rounded-full ${pct > 85 ? "bg-flag" : "bg-ai"}`}
          style={{ width: `${Math.max(pct, 3)}%` }}
        />
      </span>
      <span className="font-mono text-[10px]">{k(tokens)} ctx</span>
    </span>
  );
}

/**
 * A question box from a blocked agent (the ask_owner MCP tool) — options,
 * multi-select, free-text "Other". Answering resumes the agent within ~2s.
 * Single-choice single-question boxes answer on click; anything richer gets
 * an explicit Answer button.
 */
function QuestionCard({
  interaction,
  onRespond,
  onDismiss,
}: {
  interaction: AgentInteraction;
  onRespond: (id: string, response: InteractionResponse) => void;
  onDismiss: (id: string) => void;
}) {
  const payload = interaction.payload as QuestionPayload;
  const questions: InteractionQuestion[] = Array.isArray(payload.questions) ? payload.questions : [];
  const [sel, setSel] = useState<string[][]>(() => questions.map(() => []));
  const [others, setOthers] = useState<string[]>(() => questions.map(() => ""));

  const respond = (finalSel: string[][]) =>
    onRespond(interaction.id, {
      kind: "question",
      answers: questions.map((q, i) => ({
        question: q.question,
        choices: finalSel[i] ?? [],
        other: others[i]?.trim() || undefined,
      })),
    });

  const toggle = (qi: number, label: string, multi: boolean) => {
    // The instant path: one question, single-select, nothing typed — click = answer.
    if (!multi && questions.length === 1 && !others[0]?.trim()) {
      respond([[label]]);
      return;
    }
    setSel((cur) =>
      cur.map((choices, i) => {
        if (i !== qi) return choices;
        if (!multi) return [label];
        return choices.includes(label) ? choices.filter((c) => c !== label) : [...choices, label];
      }),
    );
  };

  const answerable = questions.every((q, i) => (sel[i]?.length ?? 0) > 0 || others[i]?.trim());
  const needsButton = questions.length > 1 || questions.some((q) => q.multiSelect) || others.some((o) => o.trim());

  return (
    <div className="rounded-md border-[1.5px] border-ai bg-paper px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-ai-2">
        <CircleHelp className="size-3.5" strokeWidth={1.75} />
        {interaction.agent === "claude" ? "Claude asks" : `${interaction.agent} asks`}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onDismiss(interaction.id)}
          aria-label="Dismiss question"
          title="Dismiss — the agent is told to use its judgment"
          className="rounded p-0.5 text-ink-4 hover:bg-paper-2"
        >
          <X className="size-3" strokeWidth={2} />
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {questions.map((q, qi) => (
          <div key={qi}>
            {q.header && (
              <span className="mb-1 inline-block rounded bg-ai-soft px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wide text-ai-2">
                {q.header}
              </span>
            )}
            <div className="text-[13px] font-medium text-ink">{q.question}</div>
            <div className="mt-1.5 flex flex-col gap-1">
              {q.options.map((o) => {
                const picked = sel[qi]?.includes(o.label);
                return (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => toggle(qi, o.label, q.multiSelect ?? false)}
                    className={`rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                      picked ? "border-ai bg-ai-soft" : "border-rule bg-paper hover:bg-paper-2"
                    }`}
                  >
                    <span className="text-[12.5px] font-medium text-ink-2">
                      {q.multiSelect ? (picked ? "☑ " : "☐ ") : ""}
                      {o.label}
                    </span>
                    {o.description && <span className="block text-[11px] text-ink-4">{o.description}</span>}
                  </button>
                );
              })}
              {q.allowOther !== false && (
                <input
                  value={others[qi] ?? ""}
                  onChange={(e) =>
                    setOthers((cur) => cur.map((v, i) => (i === qi ? e.target.value : v)))
                  }
                  placeholder="Other — type your own answer…"
                  className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-4"
                />
              )}
            </div>
          </div>
        ))}
      </div>
      {needsButton && (
        <button
          type="button"
          disabled={!answerable}
          onClick={() => respond(sel)}
          className="mt-2 rounded-md bg-ink px-2.5 py-1 text-[11.5px] font-medium text-paper transition-colors hover:bg-[#232a1e] disabled:opacity-40"
        >
          Answer
        </button>
      )}
    </div>
  );
}

/**
 * A tool-use approval from a Claude run in "Ask me" mode — the CLI's
 * permission prompt rendered in-app. Allow resumes the tool call; Deny blocks
 * it (with an optional note Claude sees as the reason). No answer = the
 * bridge denies after its timeout (fails closed).
 */
function ApprovalCard({
  interaction,
  onRespond,
}: {
  interaction: AgentInteraction;
  onRespond: (id: string, response: InteractionResponse) => void;
}) {
  const p = interaction.payload as PermissionPayload;
  const [note, setNote] = useState("");
  return (
    <div className="rounded-md border-[1.5px] border-flag/60 bg-paper px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-flag">
        <ShieldQuestion className="size-3.5" strokeWidth={1.75} />
        Permission — {interaction.agent === "claude" ? "Claude" : interaction.agent} wants to
      </div>
      <div className="text-[13px] font-medium text-ink">{p.description || p.tool}</div>
      {p.input && p.input !== "{}" && (
        <details className="mt-1">
          <summary className="cursor-pointer select-none text-[10.5px] text-ink-4 hover:text-ink-3">
            {p.tool} — full input
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-paper-2 p-2 font-mono text-[10.5px] leading-snug text-ink-2">
            {p.input}
          </pre>
        </details>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onRespond(interaction.id, { kind: "permission", decision: "allow" })}
          className="rounded-md bg-ink px-2.5 py-1 text-[11.5px] font-medium text-paper transition-colors hover:bg-[#232a1e]"
        >
          Allow
        </button>
        <button
          type="button"
          onClick={() =>
            onRespond(interaction.id, { kind: "permission", decision: "deny", note: note.trim() || undefined })
          }
          className="rounded-md border border-rule px-2.5 py-1 text-[11.5px] font-medium text-flag transition-colors hover:bg-paper-2"
        >
          Deny
        </button>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Tell it why / what to do instead (sent on Deny)…"
          className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-2 py-1 text-[11.5px] text-ink outline-none placeholder:text-ink-4"
        />
      </div>
    </div>
  );
}

/** An agent's request_owner_permission (owner grant), decidable inline —
 *  same decision paths as /engine/permissions, just without leaving the chat. */
function GrantCard({ grant, onDone }: { grant: PendingGrant; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      if (approve) await approveGrant(grant.id);
      else await denyGrant(grant.id, note.trim() || undefined);
      onDone(grant.id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-md border-[1.5px] border-flag/60 bg-paper px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-flag">
        <ShieldQuestion className="size-3.5" strokeWidth={1.75} />
        Send permission — {grant.requestedBy} asks to
      </div>
      <div className="text-[13px] font-medium text-ink">
        {grant.label}
        {grant.targetId ? ` — ${grant.targetId}` : ""}
      </div>
      {grant.reason && <div className="mt-0.5 text-[12px] text-ink-3">{grant.reason}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(true)}
          className="rounded-md bg-ink px-2.5 py-1 text-[11.5px] font-medium text-paper transition-colors hover:bg-[#232a1e] disabled:opacity-40"
        >
          Approve send
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(false)}
          className="rounded-md border border-rule px-2.5 py-1 text-[11.5px] font-medium text-flag transition-colors hover:bg-paper-2 disabled:opacity-40"
        >
          Deny
        </button>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (kept with a denial)…"
          className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-2 py-1 text-[11.5px] text-ink outline-none placeholder:text-ink-4"
        />
      </div>
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
