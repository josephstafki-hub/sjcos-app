"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Sparkles,
  Home,
  Inbox,
  Sprout,
  FolderKanban,
  Calendar,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { pollAgentRun } from "@/lib/actions/dev-agents";
import { newConversationAction, sendMessageAction } from "@/lib/actions/ai-chat";
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
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const meta = AGENT_META[agent];

  // Poll a backgrounded Qwen/Hermes turn (same dev_agent_runs row Claude runs
  // use) until it lands, streaming its "thinking" status in the meantime.
  // 480 * 2s = 16min — past the failStaleRuns() backstop (lib/dev-agents.ts)
  // so a real Hermes turn always resolves itself before we give up on it.
  const pollTurn = async (runId: string) => {
    for (let i = 0; i < 480; i++) {
      await sleep(2000);
      const p = await pollAgentRun(runId);
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

  if (!open && !embedded) return null;

  const close = () => {
    if (!embedded) setOpen(false);
  };

  const newChat = () => {
    if (pending) return;
    setConversationId(null);
    setMessages([]);
    setActivity("");
    setError("");
  };

  const ask = () => {
    const q = prompt.trim();
    if (!q || pending) return;
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
    setPrompt("");
    setElapsed(0);
    setActivity("");
    setMessages((m) => [
      ...m,
      { id: `u-${Date.now()}`, role: "user", body: q, costUsd: null, createdAt: "", subjectWorkItemId: null },
    ]);

    startTransition(async () => {
      let convId = conversationId;
      if (!convId) {
        convId = await newConversationAction(agent);
        setConversationId(convId);
      }
      const r = await sendMessageAction(convId, q, ctx);
      if (!r.ok) {
        setMessages((m) => [
          ...m,
          { id: `err-${Date.now()}`, role: "assistant", body: `⚠️ ${r.error}`, costUsd: null, createdAt: "", subjectWorkItemId: null },
        ]);
      } else if (r.kind === "answer") {
        setMessages((m) => [...m, r.message]);
      } else {
        await pollTurn(r.runId);
      }
    });
  };

  const jump = (href: string) => {
    close();
    router.push(href);
  };

  const panel = (
    <>
        {/* agent selector */}
        <div className="flex items-center gap-2 border-b border-rule px-[18px] py-2">
          <div className="flex rounded-md border border-rule bg-paper-2 p-0.5">
            {agents.map((a) => (
              <button
                key={a}
                onClick={() => {
                  if (pending) return;
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
            placeholder={`Ask ${meta.label} anything…`}
            className="flex-1 bg-transparent font-serif text-[15px] text-ink outline-none placeholder:text-ink-4"
          />
          <span className="font-mono text-[11px] text-ink-3">
            {pending ? "…" : agent === "claude" ? "↵ launch" : "↵ ask"}
          </span>
        </form>

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
    </>
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
