"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Plus,
  History,
  Paperclip,
  X,
  Pencil,
  Archive,
  Trash2,
  MessageSquare,
  Mic,
  AudioLines,
  Volume2,
  Loader2,
  ArrowUp,
} from "lucide-react";
import { VoiceButton } from "@/components/ui";
import { mergeTranscript } from "@/lib/append-transcript";
import { useVoiceRound } from "@/lib/use-voice-round";
import {
  listConversationsAction,
  renameConversationAction,
  archiveConversationAction,
  deleteConversationAction,
} from "@/lib/actions/ai-chat";
import { useChatAttachments } from "./useChatAttachments";
import type { ConversationSummary } from "@/lib/ai-chat";
import {
  AGENT_META,
  AGENT_ORDER,
  CLAUDE_MODEL_OPTIONS,
  CLAUDE_MODE_OPTIONS,
  CLAUDE_MODE_VALUES,
  CLAUDE_EFFORT_OPTIONS,
  type ClaudeModel,
  type ClaudeEffort,
  type PanelAgent,
} from "@/lib/dev-agents-meta";
import { doItDirective, prepDirective } from "@/lib/today-directives";
import { queueNarration } from "@/lib/operator-narration";
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
}: {
  registerHandOff: (fn: (p: TodayPriority, kind: "do" | "prep") => void) => void;
  onRunStart: (run: ActiveRun) => void;
  onRunEnd: () => void;
  showQueueCards: boolean;
}) {
  const { priorities, waiting, refresh } = useTodayQueue();
  const [prompt, setPrompt] = useState("");
  const [flash, setFlash] = useState("");
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [threads, setThreads] = useState<ConversationSummary[]>([]);
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
    send: async (text) => submitText(text),
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
    onAnswer: (id, body) => voice.notifyAnswer(id, body),
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

  //   /model opus · /effort high · /mode plan   (returns true if it handled it)
  const handleSlash = (raw: string): boolean => {
    const m = raw.match(/^\/(model|effort|mode)\s+(\S+)/i);
    if (!m) return false;
    const cmd = m[1].toLowerCase();
    const val = m[2].toLowerCase();
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
    if (chat.pending || uploading) return;
    if (chat.agent === "claude" && q.startsWith("/") && handleSlash(q)) {
      setPrompt("");
      return;
    }
    const files = attachments;
    if (!q && !files.length) return;
    const display = files.length ? `${q}${q ? "\n\n" : ""}📎 ${files.map((f) => f.name).join(", ")}` : q;
    setPrompt("");
    setAttachments([]);
    chat.submit({ directive: q, display, attachments: files });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ─── Thread history drawer ─────────────────────────────────────────────────

  const openThreads = async () => {
    setThreadsOpen(true);
    setThreads(await listConversationsAction(chat.agent));
  };

  const renameThread = async (id: string, current: string) => {
    const next = window.prompt("Rename conversation", current);
    if (next && next.trim()) {
      await renameConversationAction(id, next.trim());
      setThreads(await listConversationsAction(chat.agent));
    }
  };

  const archiveThread = async (id: string) => {
    await archiveConversationAction(id, true);
    if (id === chat.conversationId) chat.newChat();
    setThreads(await listConversationsAction(chat.agent));
  };

  const deleteThread = async (id: string) => {
    if (!window.confirm("Delete this conversation permanently?")) return;
    await deleteConversationAction(id);
    if (id === chat.conversationId) chat.newChat();
    setThreads(await listConversationsAction(chat.agent));
  };

  const activityLines = chat.activity ? chat.activity.split("\n").filter(Boolean).slice(-4) : [];
  const route = getPanelPageRoute();
  const starters = startersForRoute(route, chat.agent);

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[10px] border-[1.5px] border-ai bg-paper shadow-card">
      {/* Header: agent picker + history + New chat */}
      <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
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
        {route && (
          <span className="hidden truncate font-mono text-[10.5px] text-ink-4 min-[460px]:inline" title="The page the app view is showing — turns are grounded in it">
            {route}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => (threadsOpen ? setThreadsOpen(false) : void openThreads())}
          disabled={chat.pending}
          aria-label="Chat history"
          title="Chat history"
          className="rounded-md p-1 text-ink-3 transition-colors hover:bg-paper disabled:opacity-40"
        >
          <History className="size-3.5" strokeWidth={1.75} />
        </button>
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

      {/* Thread history drawer — overlays the transcript */}
      {threadsOpen && (
        <div className="absolute inset-x-0 top-[41px] bottom-0 z-10 flex flex-col bg-paper">
          <div className="flex items-center justify-between border-b border-rule px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
              {meta.label} chats
            </span>
            <button
              onClick={() => setThreadsOpen(false)}
              aria-label="Close history"
              className="rounded p-0.5 text-ink-3 hover:bg-paper-2"
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {threads.length === 0 ? (
              <p className="px-2 py-3 text-[11.5px] text-ink-4">No {meta.label} chats yet.</p>
            ) : (
              threads.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-1 rounded-md px-2 py-1.5 ${
                    c.id === chat.conversationId ? "bg-card" : "hover:bg-card/60"
                  }`}
                >
                  <MessageSquare className="size-3 flex-none text-ink-4" strokeWidth={1.5} />
                  <button
                    onClick={() => {
                      setThreadsOpen(false);
                      void chat.openConversation(c.id);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink-2"
                    title={c.title}
                  >
                    {c.title}
                  </button>
                  <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => void renameThread(c.id, c.title)} aria-label="Rename" className="rounded p-0.5 hover:bg-paper-2">
                      <Pencil className="size-3 text-ink-4" strokeWidth={1.5} />
                    </button>
                    <button onClick={() => void archiveThread(c.id)} aria-label="Archive" className="rounded p-0.5 hover:bg-paper-2">
                      <Archive className="size-3 text-ink-4" strokeWidth={1.5} />
                    </button>
                    <button onClick={() => void deleteThread(c.id)} aria-label="Delete" className="rounded p-0.5 hover:bg-paper-2">
                      <Trash2 className="size-3 text-flag" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Scroll area: narration → starters/cards → transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        <div className="whitespace-pre-wrap rounded-md bg-ai-soft px-3 py-2 text-[12.5px] leading-relaxed text-ai-2">
          {narration}
        </div>

        {showQueueCards && (
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

        {chat.messages.length === 0 && (
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
          <div className="mt-4 flex flex-col gap-2.5 border-t border-rule pt-3">
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
              return (
                <div key={m.id}>
                  {typeof m.costUsd === "number" && Number.isFinite(m.costUsd) && (
                    <div className="mb-0.5 text-[10.5px] font-medium text-ink-4">
                      ${m.costUsd.toFixed(2)}
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
                </div>
              );
            })}
            {chat.pending && (
              <div className="text-[12px]">
                <div className="text-ai-2">
                  {chat.agent === "claude" && chat.claudeOpts.mode === "plan"
                    ? "Claude is planning"
                    : `${meta.label} is working`}
                  {chat.elapsed > 0 ? ` · ${chat.elapsed}s` : "…"}
                </div>
                {activityLines.length > 0 && (
                  <div className="mt-1.5 space-y-0.5 border-l-2 border-rule pl-2.5">
                    {activityLines.map((line, i) => (
                      <div
                        key={`${i}-${line}`}
                        className={`truncate font-mono text-[11px] ${
                          i === activityLines.length - 1 ? "text-ink-2" : "text-ink-4"
                        }`}
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {chat.error && <div className="mt-3 text-[13px] text-flag">{chat.error}</div>}
      </div>

      {/* Claude run controls */}
      {chat.agent === "claude" && (
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
          <span className="hidden text-ink-4/70 min-[520px]:inline">⇧Tab cycles · /model /effort /mode</span>
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
        <VoiceRoundButton voice={voice} />
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
}

function voicePlaceholder(phase: string): string {
  switch (phase) {
    case "recording":
      return "Listening… tap the mic to send";
    case "transcribing":
      return "Transcribing…";
    case "waiting":
      return "Waiting for the answer…";
    case "speaking":
      return "Speaking — tap the mic to interrupt";
    default:
      return "Voice mode — tap the mic to talk";
  }
}

/** Push-to-talk round control: one button whose icon tracks the round phase,
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
        title="Voice conversation — push to talk, spoken answers"
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
