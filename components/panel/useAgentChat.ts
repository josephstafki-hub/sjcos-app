"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import {
  answerInteractionAction,
  dismissInteractionAction,
  pollAgentRun,
  stopAgentRun,
  type PendingGrant,
} from "@/lib/actions/dev-agents";
import {
  loadConversationAction,
  newConversationAction,
  resetClaudeSessionAction,
  sendMessageAction,
  voiceTurnAction,
} from "@/lib/actions/ai-chat";
import type { AgentInteraction, InteractionResponse } from "@/lib/agent-interactions";
import type { ChatMessage } from "@/lib/ai-chat";
import {
  CLAUDE_DEFAULTS,
  type ChatAttachment,
  type ClaudeOptions,
  type PanelAgent,
} from "@/lib/dev-agents-meta";
import { postPanelMessage } from "./panelBus";
import { readPanelState, writePanelState } from "./panelStore";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Wall clock for run bookkeeping. Wrapped so calls inside the poll loop
 *  aren't mistaken for render-time impurity by the React compiler lint. */
const nowMs = () => Date.now();

/** What run is live and which entity it's about — shared with whatever wants
 *  to follow the run (workbench focus, app-view navigation, chips). */
export interface ActiveRun {
  runId: string;
  agent: PanelAgent;
  subjectId: string | null; // work_items uuid OR synthetic "lead:slug" etc.
  startedAt: number;
}

/** One turn to run. `directive` is what the model sees; `display` (default:
 *  directive) is what the transcript shows — hand-offs send a long prompt but
 *  show "✦ Have Hermes do it — …". Setting `agent` forces the turn onto that
 *  agent, abandoning the current thread if it belongs to a different one. */
export interface PanelSend {
  directive: string;
  display?: string;
  agent?: PanelAgent;
  subjectId?: string;
  notice?: string;
  attachments?: ChatAttachment[];
  /** Express permission: mint a run-scoped owner grant so Claude may perform
   *  the client-facing sends this message asks for (lib/owner-grants.ts). The
   *  Ask window's per-message checkbox. Not part of claudeOpts on purpose:
   *  those persist in panelStore, and this must never outlive the message. */
  allowSends?: boolean;
  /** Voice-mode turn: goes to the Claude concierge (speak-first, delegates
   *  work in the background) instead of the typed router. */
  voice?: boolean;
}

export interface UseAgentChatOptions {
  /** Read at send time, not captured — the panel outlives page navigation and
   *  must ground each turn in the page the app view is on *now*. */
  getPageContext: () => string | undefined;
  onRunStart?: (run: ActiveRun) => void;
  onRunEnd?: () => void;
  /** After any settled turn (answer or error) — e.g. refresh the today queue. */
  onSettled?: () => Promise<void> | void;
  /** A real (non-error) assistant answer landed. `spoken` marks the
   *  concierge's own voice reply (already plain speech); a finished delegated
   *  run's answer arrives with spoken=false — speak it via /api/tts {runId}. */
  onAnswer?: (id: string, body: string, spoken: boolean) => void;
  /** The send itself failed before a run existed — e.g. re-stage attachments. */
  onSendError?: (spec: PanelSend) => void;
}

/**
 * The one chat engine behind the universal panel — the send/poll loop that
 * previously existed as four near-identical copies (OperatorChat, AssistantChat,
 * CommandBar, TodayFeed). Extracted from OperatorChat, the richest copy.
 *
 * Hard-won rules carried over — keep them when touching this file:
 *  1. `pending` is plain state, deliberately NOT useTransition: a turn can run
 *     for minutes, React keeps a transition pending for its whole await chain,
 *     and every later transition — including the App Router's own soft
 *     navigation — is entangled behind it.
 *  2. `liveRef` claim tokens: a poll loop holds the token it started under, so
 *     unmounting/switching threads stops it instead of letting it setState on a
 *     dead fiber and hit the server every 2s for another 16 minutes. The run
 *     finishes server-side regardless and resumes on return.
 *  3. Thread ids are written to panelStore directly inside the async send, not
 *     mirrored from React state — a conversation created after the user
 *     navigated away must still be remembered or the next mount forks a second
 *     conversation.
 *  4. Reopening a thread re-polls its `pendingRunId` (from the DB) and re-fires
 *     onRunStart so run-followers re-focus after a remount or re-dock.
 *  5. The poll ceiling is 1440 × 2s — sized just past failStaleTasks()'s
 *     45-minute ladder backstop so the client outlives the reapers, never the
 *     reverse.
 */
export function useAgentChat({
  getPageContext,
  onRunStart,
  onRunEnd,
  onSettled,
  onAnswer,
  onSendError,
}: UseAgentChatOptions) {
  const [agent, setAgent] = useState<PanelAgent>(PANEL_DEFAULT_AGENT);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [claudeOpts, setClaudeOptsState] = useState<ClaudeOptions>(CLAUDE_DEFAULTS);
  /** What each finished run did — keyed by the reply message id, so the
   *  transcript can keep a collapsible "what it did" under the answer. Client
   *  memory only (the row keeps the canonical copy). */
  const [logs, setLogs] = useState<Record<string, string>>({});
  // ── Interactive-run state (all fed by the poll) ────────────────────────────
  /** Question boxes / tool approvals the live run is blocked on. */
  const [interactions, setInteractions] = useState<AgentInteraction[]>([]);
  /** request_owner_permission rows Joe can approve/deny inline. */
  const [grants, setGrants] = useState<PendingGrant[]>([]);
  /** Live context size (tokens) of the Claude session, null when unknown. */
  const [contextTokens, setContextTokens] = useState<number | null>(null);
  /** The run currently being polled — the ⏹ Stop target. */
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  /** The thread's resumable CLI session (shown as a chip; "Fresh" clears it). */
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);

  const liveRef = useRef({ alive: true });
  const claim = () => {
    liveRef.current.alive = false;
    liveRef.current = { alive: true };
    return liveRef.current;
  };

  // Callbacks live in refs so the long-lived poll loop always calls the latest
  // render's handlers instead of the ones captured when the loop started.
  // Assigned in an effect (not render) per the react-hooks/refs rule.
  const cbRef = useRef({ getPageContext, onRunStart, onRunEnd, onSettled, onAnswer, onSendError });
  useEffect(() => {
    cbRef.current = { getPageContext, onRunStart, onRunEnd, onSettled, onAnswer, onSendError };
  });

  const settle = async () => {
    setInteractions([]);
    setGrants([]);
    setActiveRunId(null);
    cbRef.current.onRunEnd?.();
    await cbRef.current.onSettled?.();
  };

  const pollTurn = async (
    runId: string,
    subjectId: string | undefined,
    live: { alive: boolean },
  ) => {
    // 1440 × 2s = 48 min — past failStaleTasks()'s 45-minute ladder backstop
    // (a multi-round Hermes ladder with a Claude takeover is the long case),
    // so the client outlives every server reaper, never the reverse.
    for (let i = 0; i < 1440; i++) {
      await sleep(2000);
      if (!live.alive) return;
      const p = await pollAgentRun(runId);
      if (!live.alive) return;
      if (!p.ok) {
        setActivity("");
        setMessages((m) => [
          ...m,
          { id: `err-${runId}`, role: "assistant", body: `⚠️ ${p.error}`, costUsd: null, createdAt: "", subjectWorkItemId: subjectId ?? null, agent: null, attachments: null },
        ]);
        postPanelMessage({ type: "run", phase: "end", runId, agent, subjectId: subjectId ?? null }, { local: true });
        await settle();
        return;
      }
      if (p.status === "done") {
        setActivity("");
        setInteractions([]);
        setGrants([]);
        if (p.contextTokens != null) setContextTokens(p.contextTokens);
        if (p.sessionId) setClaudeSessionId(p.sessionId);
        if (p.activity) setLogs((l) => ({ ...l, [`run-${runId}`]: p.activity! }));
        setMessages((m) => [
          ...m,
          { id: `run-${runId}`, role: "assistant", body: p.answer, costUsd: p.costUsd, createdAt: "", subjectWorkItemId: subjectId ?? null, agent: p.agent ?? null, attachments: null, tokenUsage: p.tokenUsage ?? null },
        ]);
        postPanelMessage({ type: "run", phase: "end", runId, agent, subjectId: subjectId ?? null }, { local: true });
        if (!p.answer.startsWith("⚠️")) cbRef.current.onAnswer?.(runId, p.answer, false);
        // An orchestrator hand-off (e.g. Qwen's held proposal escalated to the
        // Hermes ladder) starts a follow-on run in the same thread — keep
        // following it so its answer lands live rather than on next reopen.
        if (p.nextRunId) {
          await cbRef.current.onSettled?.();
          setElapsed(0);
          startRun({ runId: p.nextRunId, agent: "hermes", subjectId: subjectId ?? null, startedAt: nowMs() });
          await pollTurn(p.nextRunId, subjectId, live);
          return;
        }
        await settle();
        return;
      }
      setActivity(p.activity ?? "");
      setInteractions(p.interactions);
      setGrants(p.grants);
      if (p.contextTokens != null) setContextTokens(p.contextTokens);
    }
    await settle();
  };

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [pending]);

  const startRun = (run: ActiveRun) => {
    setActiveRunId(run.runId);
    cbRef.current.onRunStart?.(run);
    postPanelMessage({ type: "run", phase: "start", runId: run.runId, agent: run.agent, subjectId: run.subjectId }, { local: true });
  };

  /** Reopen a thread: transcript from the DB (which is what shows a reply that
   *  landed while the panel was elsewhere), and a still-running turn resumes
   *  its poll and its run focus. */
  const openConversation = async (id: string) => {
    const live = claim();
    setPending(true);
    setError("");
    setNotice("");
    setActivity("");
    // Switching away from a live run: its question boxes/grants/stop target
    // belong to the abandoned thread, not the one being opened. The run keeps
    // going server-side; reopening that thread resumes its poll (pendingRunId).
    setInteractions([]);
    setGrants([]);
    setActiveRunId(null);
    try {
      const detail = await loadConversationAction(id);
      if (!live.alive) return;
      if (!detail) {
        writePanelState({ conversationId: null });
        setConversationId(null);
        setMessages([]);
        return;
      }
      setAgent(detail.agent);
      setConversationId(detail.id);
      setMessages(detail.messages);
      setClaudeSessionId(detail.claudeSessionId);
      setContextTokens(null);
      writePanelState({ conversationId: detail.id, agent: detail.agent });
      if (detail.pendingRunId) {
        // A hand-off tags its user turn with the card it's about; carry that
        // through so the resumed run still refreshes followers on the right
        // entity.
        const subjectId = detail.messages[detail.messages.length - 1]?.subjectWorkItemId ?? undefined;
        setElapsed(0);
        startRun({
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

  // On mount: adopt persisted prefs, then reopen whatever thread the panel had
  // going. Prefs are adopted in an effect (not initial state) because the store
  // is localStorage-backed and reading it during render would desync hydration.
  useEffect(() => {
    const st = readPanelState();
    // Old /ai deep links (?c=<conversation id>) now land on the panel: the
    // redirect keeps the param, and it wins over the remembered thread once.
    let deepLink: string | null = null;
    try {
      deepLink = new URLSearchParams(window.location.search).get("c");
    } catch {
      /* no location — fine */
    }
    startTransition(() => {
      setClaudeOptsState(st.claude);
      const open = deepLink ?? st.conversationId;
      if (open) {
        void openConversation(open);
      } else if (st.agent !== PANEL_DEFAULT_AGENT) {
        setAgent(st.agent);
      }
    });
    return () => {
      liveRef.current.alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetView = () => {
    setMessages([]);
    setActivity("");
    setError("");
    setNotice("");
    setInteractions([]);
    setGrants([]);
    setActiveRunId(null);
    setContextTokens(null);
    setClaudeSessionId(null);
  };

  /** Start a fresh thread. Allowed mid-run on purpose: claim() abandons the
   *  poll (the run finishes server-side and its reply lands in its own thread,
   *  marked live in the thread list), and pending is cleared here because the
   *  abandoned loop's finally sees a dead claim and won't. */
  const newChat = () => {
    claim();
    writePanelState({ conversationId: null });
    setConversationId(null);
    setPending(false);
    resetView();
    cbRef.current.onRunEnd?.();
  };

  /** Rail click: each agent keeps its own thread, so switching abandons the
   *  current one — drop the claim and the memory of it too. */
  const selectAgent = (a: PanelAgent) => {
    if (pending) return;
    claim();
    writePanelState({ conversationId: null, agent: a });
    setAgent(a);
    setConversationId(null);
    resetView();
  };

  const setClaudeOpts = (patch: Partial<ClaudeOptions>) => {
    setClaudeOptsState((prev) => {
      const next = { ...prev, ...patch };
      writePanelState({ claude: next });
      return next;
    });
  };

  // ── Interactive-run controls ───────────────────────────────────────────────

  /** ⏹ Stop the live run. The poll loop keeps going: it sees the settled row
   *  ("⏹ Stopped by Joe.") land as the run's error/answer within a tick. */
  const stop = () => {
    if (!activeRunId) return;
    void stopAgentRun(activeRunId);
  };

  /** Answer a question box / permission prompt; the blocked agent resumes
   *  within ~2s. Optimistically cleared — the next poll re-adds anything
   *  genuinely still pending. */
  const respond = (id: string, response: InteractionResponse) => {
    setInteractions((cur) => cur.filter((i) => i.id !== id));
    void answerInteractionAction(id, response);
  };

  /** Dismiss a question without answering (agent is told to use judgment). */
  const dismiss = (id: string) => {
    setInteractions((cur) => cur.filter((i) => i.id !== id));
    void dismissInteractionAction(id);
  };

  /** Drop a grant card locally once Joe decided it (approve/deny happens via
   *  lib/actions/owner-grants.ts in the component). */
  const dropGrant = (id: string) => setGrants((cur) => cur.filter((g) => g.id !== id));

  /** Fresh CLI session for this thread: next Claude turn starts clean. */
  const freshSession = () => {
    if (!conversationId) return;
    setClaudeSessionId(null);
    setContextTokens(null);
    void resetClaudeSessionAction(conversationId);
  };

  const pushUser = (body: string, subjectId?: string) =>
    setMessages((m) => [
      ...m,
      { id: `u-${Date.now()}`, role: "user", body, costUsd: null, createdAt: "", subjectWorkItemId: subjectId ?? null, agent: null, attachments: null },
    ]);

  /** Run a turn as plain async work rather than a transition — see rule 1.
   *  Navigating away mid-turn is fine: the run finishes server-side and the
   *  reply is in the thread on return. */
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

  /** The one entry point for turns — free text, hand-offs, starters. */
  const submit = (spec: PanelSend) => {
    if (pending) return;
    if (!spec.directive.trim() && !spec.attachments?.length) return;
    const from = agent;
    const target = spec.agent ?? from;
    const switching = target !== from;
    setError("");
    setNotice(spec.notice ?? "");
    setElapsed(0);
    setActivity("");
    runTurn(async (live) => {
      let convId = switching ? null : conversationId;
      if (switching) {
        setAgent(target);
        setMessages([]);
      }
      pushUser(spec.display ?? spec.directive, spec.subjectId);
      if (!convId) {
        convId = await newConversationAction(target);
        if (!live.alive) {
          // Created after the panel went away — still remember it (rule 3).
          writePanelState({ conversationId: convId, agent: target });
          return;
        }
        writePanelState({ conversationId: convId, agent: target });
        setConversationId(convId);
      }
      if (spec.voice) {
        // Voice: Claude answers out loud right away; any OS work runs as a
        // delegated background run in this thread that we then follow.
        const v = await voiceTurnAction(convId, spec.directive, cbRef.current.getPageContext());
        if (!live.alive) return;
        if (!v.ok) {
          setMessages((m) => [
            ...m,
            { id: `err-${Date.now()}`, role: "assistant", body: `⚠️ ${v.error}`, costUsd: null, createdAt: "", subjectWorkItemId: null, agent: null, attachments: null },
          ]);
          await settle();
          return;
        }
        setMessages((m) => [
          ...m,
          { id: v.ackMessageId, role: "assistant", body: `🗣 ${v.speak}`, costUsd: null, createdAt: "", subjectWorkItemId: null, agent: "concierge", attachments: null },
        ]);
        cbRef.current.onAnswer?.(v.ackMessageId, v.speak, true);
        if (!v.runId) {
          await settle();
          return;
        }
        setNotice(`${v.delegatedTo === "qwen" ? "Qwen" : "Hermes"} is on it — Claude will report back.`);
        startRun({ runId: v.runId, agent: v.delegatedTo ?? "hermes", subjectId: null, startedAt: Date.now() });
        await pollTurn(v.runId, undefined, live);
        return;
      }
      const r = await sendMessageAction(
        convId,
        spec.directive,
        cbRef.current.getPageContext(),
        target === "claude" || target === "auto" ? claudeOpts : undefined,
        spec.attachments,
        spec.subjectId,
        spec.allowSends,
      );
      if (!live.alive) return;
      if (!r.ok) {
        setMessages((m) => [
          ...m,
          { id: `err-${Date.now()}`, role: "assistant", body: `⚠️ ${r.error}`, costUsd: null, createdAt: "", subjectWorkItemId: spec.subjectId ?? null, agent: null, attachments: null },
        ]);
        cbRef.current.onSendError?.(spec);
        await settle();
        return;
      }
      if (r.kind === "answer") {
        // Rare synchronous path — no run row to poll.
        setMessages((m) => [...m, { ...r.message, subjectWorkItemId: spec.subjectId ?? r.message.subjectWorkItemId }]);
        if (!r.message.body.startsWith("⚠️")) cbRef.current.onAnswer?.(r.message.id, r.message.body, false);
        await settle();
        return;
      }
      startRun({ runId: r.runId, agent: target, subjectId: spec.subjectId ?? null, startedAt: Date.now() });
      await pollTurn(r.runId, spec.subjectId, live);
    });
  };

  return {
    agent,
    selectAgent,
    conversationId,
    messages,
    logs,
    activity,
    elapsed,
    error,
    notice,
    pending,
    claudeOpts,
    setClaudeOpts,
    submit,
    newChat,
    openConversation,
    // Interactive-run surface (question boxes, approvals, stop, context).
    interactions,
    grants,
    contextTokens,
    activeRunId,
    claudeSessionId,
    stop,
    respond,
    dismiss,
    dropGrant,
    freshSession,
  };
}

/** Deterministic first-render agent; the persisted choice is adopted in an
 *  effect (hydration safety — see mount effect). Auto = the router decides
 *  per message (Hermes stays the workhorse for OS work). */
const PANEL_DEFAULT_AGENT: PanelAgent = "auto";
