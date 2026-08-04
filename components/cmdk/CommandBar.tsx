"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Sparkles,
  Home,
  Inbox,
  Sprout,
  FolderKanban,
  Calendar,
  Paperclip,
  X,
  type LucideIcon,
} from "lucide-react";
import { pollAgentRun } from "@/lib/actions/dev-agents";
import { newConversationAction, sendMessageAction } from "@/lib/actions/ai-chat";
import { useChatAttachments } from "@/components/ai/useChatAttachments";
import {
  getSnapshot,
  saveSnapshot,
  setPendingRun,
  setConversationRef,
  clearSnapshot,
} from "@/components/cmdk/commandBarStore";
import type { ChatMessage } from "@/lib/ai-chat";
import { AGENT_META, AGENT_ORDER, type DevAgent } from "@/lib/dev-agents-meta";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type JumpRow = { icon: LucideIcon; title: string; href: string };

const JUMP: JumpRow[] = [
  { icon: Home, title: "Today", href: "/today" },
  { icon: Inbox, title: "Inbox", href: "/inbox" },
  { icon: Sprout, title: "Leads", href: "/leads" },
  { icon: FolderKanban, title: "Projects", href: "/projects" },
  { icon: Calendar, title: "Schedule", href: "/schedule" },
];

/**
 * Ask command bar. Pick Claude / Qwen / Hermes. Qwen & Hermes turn into a real
 * multi-turn conversation against the host page's `aiContext` (same persisted
 * ai_conversations thread the /ai window uses, so it survives a page reload
 * and follow-ups keep context) — the turn itself runs in the background and
 * is polled, so a slow tool-heavy Hermes reply can't hold the request open
 * long enough to take the page down. Claude is the async edit-agent, so it
 * starts a conversation with the CURRENT route as context and opens the /ai
 * Ask window to watch the run.
 *
 * Two render modes:
 *  - popup (default): hidden until ⌘/Ctrl+K, floats over the page in a modal.
 *  - embedded: always visible, laid out inline in the page (Home, and
 *    individual Leads / Projects / Warranty). ⌘/Ctrl+K focuses it instead of
 *    toggling a modal, since the bar is already on screen.
 *
 * The thread is kept per page in commandBarStore, so navigating away and back
 * returns to the conversation you left — including one that was still running
 * when you left (the run finishes server-side either way; we re-poll its id and
 * the answer lands late). Each embedded page gets its own thread; the popup
 * follows you across routes on one. A hard refresh drops the lot by design.
 */
export function CommandBar({
  defaultOpen = false,
  aiContext,
  embedded = false,
  agents = AGENT_ORDER,
}: {
  defaultOpen?: boolean;
  aiContext?: string;
  embedded?: boolean;
  /** Which agent tabs to offer — defaults to all (Claude/Qwen/Hermes). */
  agents?: DevAgent[];
}) {
  const [open, setOpen] = useState(embedded ? true : defaultOpen);
  const [agent, setAgent] = useState<DevAgent>(agents[0] ?? "claude");
  const [prompt, setPrompt] = useState("");
  // Qwen/Hermes turns persist as a real ai_conversations thread (so this is a
  // conversation, not a one-shot Q&A) — messages + the id of that thread.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  // Files staged for the next turn. Claude reads them off disk by path;
  // Qwen/Hermes get their text inlined server-side (lib/actions/ai-chat.ts).
  const {
    attachments,
    setAttachments,
    uploading,
    fileInputRef,
    uploadFiles,
    uploadFromTransfer,
    removeAttachment,
  } = useChatAttachments(setError);
  // Plain state, deliberately not useTransition: a turn can run for minutes,
  // React keeps a transition pending for its whole await chain, and every later
  // transition — including the App Router's own soft navigation — is entangled
  // behind it. That's what made clicking another page do nothing until the
  // agent answered.
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const meta = AGENT_META[agent];

  // Which thread this bar is showing. Embedded bars are per page (the slug is
  // in the pathname, so every project/lead keeps its own); the popup is one
  // thread that follows you across routes, since it isn't "on" a page.
  const storeKey = embedded ? `page:${pathname}` : "popup";
  // Which key the state below currently belongs to. State, not a ref, so the
  // mirror effect can't save the outgoing page's thread under the incoming
  // page's key: on a key change it reads the stale value for one pass and skips.
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  // Marks how long this bar is showing `storeKey`. Cleared when it stops
  // (unmount, or a move to another page); any poll loop still running holds the
  // token it started under and checks it, so an orphan stops on its own.
  const liveRef = useRef({ alive: true });

  // Appending is id-keyed rather than positional: a run's message id is derived
  // from its run id, so a resumed poll can't double-post an answer.
  const appendOnce = (list: ChatMessage[], msg: ChatMessage) =>
    list.some((m) => m.id === msg.id) ? list : [...list, msg];

  // Poll a backgrounded Qwen/Hermes turn (same dev_agent_runs row Claude runs
  // use) until it lands, streaming its "thinking" status in the meantime.
  // 480 * 2s = 16min — past the failStaleRuns() backstop (lib/dev-agents.ts)
  // so a real Hermes turn always resolves itself before we give up on it.
  //
  // `live` is the caller's claim on this bar. Once it's dead the loop is
  // orphaned — its setStates would land on a dead fiber (silent no-ops) and it
  // would keep hitting the server every 2s for up to 16 minutes — so it stops
  // and leaves pendingRunId set for the next mount to pick the run back up.
  const pollTurn = async (runId: string, live: { alive: boolean }) => {
    for (let i = 0; i < 480; i++) {
      await sleep(2000);
      if (!live.alive) return;
      const p = await pollAgentRun(runId);
      if (!live.alive) return;
      if (!p.ok) {
        setPendingRun(storeKey, null);
        setActivity("");
        setMessages((m) =>
          appendOnce(m, { id: `err-${runId}`, role: "assistant", body: `⚠️ ${p.error}`, costUsd: null, createdAt: "", subjectWorkItemId: null }),
        );
        return;
      }
      if (p.status === "done") {
        setPendingRun(storeKey, null);
        setActivity("");
        setMessages((m) =>
          appendOnce(m, { id: `run-${runId}`, role: "assistant", body: p.answer, costUsd: p.costUsd, createdAt: "", subjectWorkItemId: null }),
        );
        return;
      }
      setActivity(p.activity ?? "");
    }
    // Gave up on it — don't leave a run behind for the next mount to resume.
    setPendingRun(storeKey, null);
  };

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [pending]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (embedded) inputRef.current?.focus();
        else setOpen((o) => !o);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        // Jump to the full Ask page (⌘K stays the inline quick-ask popup).
        e.preventDefault();
        setOpen(false);
        router.push("/ai");
      } else if (e.key === "Escape" && !embedded) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, embedded]);

  useEffect(() => {
    if (open && !embedded) inputRef.current?.focus();
  }, [open, embedded]);

  // Restore this page's thread, and resume a turn that was mid-flight when we
  // left. Keyed on storeKey rather than mount so it also handles React reusing
  // this instance between two slugs (/projects/a → /projects/b renders the same
  // component at the same position, which would otherwise carry A's chat into B).
  useEffect(() => {
    const live = { alive: true };
    liveRef.current = live;
    const snap = getSnapshot(storeKey);
    // A thread whose agent this page doesn't offer can't be shown — its tab
    // isn't rendered, so the selection would be invisible and sends would go
    // somewhere Joe can't see. Start clean instead.
    const usable = snap && agents.includes(snap.agent) ? snap : undefined;
    // Restoring is a plain state swap, and one sync transition puts it all in a
    // single commit: the thread paints with `pending` already settled, so a page
    // with a saved chat never flashes "…is thinking" on the way in.
    //
    // `pending` starts true only when there's a turn to resume — the poll below
    // then carries it, so the "thinking…" line and the disabled controls come
    // back as if the turn never paused. The poll itself is awaited outside any
    // transition; parking one for the run's whole duration is what used to
    // block navigating off the page (see the `pending` declaration).
    const runId = usable?.pendingRunId;
    startTransition(() => {
      setAgent(usable?.agent ?? agents[0] ?? "claude");
      setConversationId(usable?.conversationId ?? null);
      setMessages(usable?.messages ?? []);
      setPrompt(usable?.prompt ?? "");
      setAttachments(usable?.attachments ?? []);
      setActivity("");
      setError("");
      setElapsed(0);
      setPending(Boolean(runId));
      setHydratedKey(storeKey);
    });
    if (runId) {
      startTransition(() => {
        void pollTurn(runId, live).finally(() => {
          if (live.alive) setPending(false);
        });
      });
    }
    return () => {
      live.alive = false;
    };
    // Only storeKey: `pollTurn` is redefined every render and `agents` can be a
    // fresh array literal from the host page — either would re-run this (wiping
    // the live thread) on every render. `setAttachments` is a plain useState
    // setter and is stable, so it isn't why the disable is here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey]);

  // Mirror the visible state back to the store on every change, so navigating
  // away needs no unmount hook to race with.
  useEffect(() => {
    if (hydratedKey !== storeKey) return;
    saveSnapshot(storeKey, { agent, conversationId, messages, prompt, attachments });
  }, [hydratedKey, storeKey, agent, conversationId, messages, prompt, attachments]);

  if (!open && !embedded) return null;

  const close = () => {
    if (!embedded) setOpen(false);
  };

  // Drop the thread and start over. Evicts the stored snapshot too, or the
  // chat would simply come back on the next visit — and with it any
  // pendingRunId, which the mirror doesn't own and would otherwise resurrect a
  // "thinking…" poll into the empty thread.
  //
  // The un-sent draft survives on purpose — both halves of it, the typed text
  // and the staged files. Clear is aimed at the conversation above the box, and
  // silently eating a half-written question (or a photo you just picked) is the
  // kind of thing you only notice after it's gone. Nothing is destroyed
  // server-side either — the conversation stays in ai_conversations and is
  // still reachable from the /ai rail, which is why this is "Clear", not
  // "Delete".
  const clearChat = () => {
    if (pending) return;
    clearSnapshot(storeKey);
    setConversationId(null);
    setMessages([]);
    setActivity("");
    setError("");
  };

  const ask = () => {
    const q = prompt.trim();
    // Attachment-only sends are allowed (the server titles the thread off the
    // first filename when there's no text). Block while an upload is still in
    // flight, or the turn would silently go without the file.
    const files = attachments;
    if ((!q && !files.length) || pending || uploading) return;
    setError("");

    // Claude runs the same way as Qwen/Hermes here — inline, polled via the
    // shared dev_agent_runs row — instead of handing off to /ai. It still
    // edits code same as the full Ask window; it just answers in place.
    // Prefer the page's rich record brief; otherwise at least tell the agent
    // which route the user is on so answers aren't context-blind.
    const ctx =
      aiContext ??
      (pathname
        ? `The user is viewing the ${pathname} page of SJC OS. No structured record context was provided for this page.`
        : undefined);
    const bodyNote = files.length ? `${q}${q ? "\n\n" : ""}📎 ${files.map((f) => f.name).join(", ")}` : q;
    setPrompt("");
    setAttachments([]);
    setElapsed(0);
    setActivity("");
    setMessages((m) => [
      ...m,
      { id: `u-${Date.now()}`, role: "user", body: bodyNote, costUsd: null, createdAt: "", subjectWorkItemId: null },
    ]);

    // Plain async work, not a transition — see the `pending` declaration.
    // Navigating away mid-turn is fine: the run finishes server-side, this
    // bar's thread is kept in the store, and the answer lands when you return.
    const live = liveRef.current;
    void (async () => {
      setPending(true);
      try {
        let convId = conversationId;
        if (!convId) {
          convId = await newConversationAction(agent);
          // Store write as well as state, for the same reason as the runId
          // below: if Joe left while the thread was being opened, only the
          // store write lands — and without it the next turn here would fork a
          // second conversation instead of continuing this one.
          setConversationId(convId);
          setConversationRef(storeKey, convId);
        }
        // 4th arg (claudeOptions) is undefined — this bar has no run controls,
        // so startClaudeRun applies CLAUDE_DEFAULTS.
        const r = await sendMessageAction(convId, q, ctx, undefined, files);
        // Record the run before anything else, straight into the store rather
        // than via state: if Joe navigated while the turn was starting, this
        // bar is already gone and setState is a no-op, but the store write
        // still lands and the next visit picks the run back up.
        if (r.ok && r.kind === "pending") setPendingRun(storeKey, r.runId);
        if (!live.alive) return;
        if (!r.ok) {
          // Re-stage the files: retyping a prompt is cheap, re-picking uploads
          // isn't, and the turn never reached the model. Prepend rather than
          // replace — anything staged while the turn was in flight is still live.
          setAttachments((cur) => [...files, ...cur]);
          setMessages((m) => [
            ...m,
            { id: `err-${Date.now()}`, role: "assistant", body: `⚠️ ${r.error}`, costUsd: null, createdAt: "", subjectWorkItemId: null },
          ]);
        } else if (r.kind === "answer") {
          setMessages((m) => [...m, r.message]);
        } else {
          await pollTurn(r.runId, live);
        }
      } finally {
        if (live.alive) setPending(false);
      }
    })();
  };

  const jump = (href: string) => {
    close();
    router.push(href);
  };

  const panel = (
    // Wrapper carries the drop target so both render modes below get it from
    // one place. `dragging` only tracks files — dragging selected text over
    // the box shouldn't light it up.
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // Crossing a child fires dragleave on the wrapper too; ignore those.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        if (uploadFromTransfer(e.dataTransfer)) e.preventDefault();
      }}
      className={dragging ? "ring-2 ring-inset ring-ai" : undefined}
    >
        {/* agent selector */}
        <div className="flex items-center gap-2 border-b border-rule px-[18px] py-2">
          <div className="flex rounded-md border border-rule bg-paper-2 p-0.5">
            {agents.map((a) => (
              <button
                key={a}
                onClick={() => {
                  // Switching agent abandons the thread (each one keeps its own
                  // conversation), so clear it out of the store as well — the
                  // mirror re-saves under the new agent on the next render.
                  // Staged files survive the switch: they're paths on disk, not
                  // bound to an agent, and switching is exactly what you do when
                  // you attach a photo and remember Hermes can't see images.
                  if (pending) return;
                  clearSnapshot(storeKey);
                  setAgent(a);
                  setConversationId(null);
                  setMessages([]);
                  setActivity("");
                  setError("");
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
            {agent === "claude" ? `Edits code · runs here (context: ${pathname})` : meta.note}
          </span>
          <div className="flex-1" />
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              disabled={pending}
              aria-label="Clear chat"
              title="Clear chat"
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-paper disabled:opacity-40"
            >
              <X className="size-3" strokeWidth={2} /> Clear
            </button>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
          className="flex items-center gap-2.5 border-b border-rule px-[18px] py-3"
        >
          <Sparkles className="size-[18px] flex-none text-ai" strokeWidth={1.5} />
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onPaste={(e) => {
              // Pasting a screenshot straight into the box attaches it.
              if (uploadFromTransfer(e.clipboardData)) e.preventDefault();
            }}
            placeholder={`Ask ${meta.label} anything…`}
            className="flex-1 bg-transparent font-serif text-[15px] text-ink outline-none placeholder:text-ink-4"
          />
          <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => uploadFiles(e.target.files)} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending || uploading}
            aria-label="Attach files"
            title="Attach files"
            className="flex size-6 flex-none items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-paper-2 disabled:opacity-40"
          >
            <Paperclip className={`size-4 ${uploading ? "animate-pulse" : ""}`} strokeWidth={1.75} />
          </button>
          <span className="font-mono text-[11px] text-ink-3">
            {pending ? "…" : agent === "claude" ? "↵ launch" : "↵ ask"}
          </span>
        </form>

        {/* staged attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-rule px-[18px] py-2">
            {attachments.map((a, i) => (
              <span
                key={`${a.path}-${i}`}
                className="flex items-center gap-1 rounded border border-rule bg-paper-2 px-1.5 py-0.5 text-[11px] text-ink-2"
              >
                <Paperclip className="size-3 text-ink-4" strokeWidth={1.5} />
                <span className="max-w-[160px] truncate">{a.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => removeAttachment(i)}
                  className="rounded p-0.5 hover:bg-paper"
                >
                  <X className="size-3 text-ink-4" strokeWidth={1.75} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {error && (
            <div className="px-[18px] py-2 text-[13px] text-flag">{error}</div>
          )}

          {messages.length > 0 && (
            <div className="flex flex-col gap-2.5 px-[18px] py-2">
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
                    {meta.label} is thinking{elapsed > 0 ? ` · ${elapsed}s` : "…"}
                  </div>
                  {activity && (
                    <div className="mt-1 font-mono text-[11px] text-ink-4">{activity}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {!messages.length && !pending && !error && (
            <>
              <div className="px-[18px] pb-1 pt-2.5 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
                Jump to
              </div>
              {JUMP.map((r) => {
                const Icon = r.icon;
                return (
                  <button
                    key={r.href}
                    onClick={() => jump(r.href)}
                    className="flex w-full items-center gap-2.5 px-[18px] py-2 text-left transition-colors hover:bg-paper-2"
                  >
                    <Icon className="size-3.5 flex-none text-ink-2" strokeWidth={1.5} />
                    <span className="flex-1 text-[13px] text-ink">{r.title}</span>
                    <span className="font-mono text-[10px] text-ink-3">→</span>
                  </button>
                );
              })}
            </>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-rule bg-paper-2 px-[18px] py-2">
          <span className="font-mono text-[10px] text-ink-3">
            {embedded
              ? agent === "claude"
                ? "↵ LAUNCH"
                : "↵ ASK"
              : agent === "claude"
                ? "↵ LAUNCH · ESC CLOSE"
                : "↵ ASK · ESC CLOSE"}
          </span>
          <div className="flex-1" />
          <span className="rounded-full border border-ai bg-ai-soft px-2 py-0.5 font-mono text-[9px] text-ai-2">
            {meta.label}
          </span>
        </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="overflow-hidden rounded-[10px] border-[1.5px] border-ai bg-paper shadow-card">
        {panel}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Ask command bar">
      <button
        aria-label="Close command bar"
        onClick={close}
        className="absolute inset-0 cursor-default bg-ink/45 backdrop-blur-[2px]"
      />
      <div className="absolute left-1/2 top-[110px] w-[620px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-[10px] border-[1.5px] border-ink bg-paper shadow-[0_24px_60px_rgba(0,0,0,0.3)]">
        {panel}
      </div>
    </div>
  );
}
