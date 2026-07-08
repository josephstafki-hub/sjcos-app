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
  type LucideIcon,
} from "lucide-react";
import { askAgent } from "@/lib/actions/dev-agents";
import { newConversationAction, sendMessageAction } from "@/lib/actions/ai-chat";
import { AGENT_META, AGENT_ORDER, type DevAgent } from "@/lib/dev-agents-meta";

type JumpRow = { icon: LucideIcon; title: string; href: string };

const JUMP: JumpRow[] = [
  { icon: Home, title: "Today", href: "/today" },
  { icon: Inbox, title: "Inbox", href: "/inbox" },
  { icon: Sprout, title: "Leads", href: "/leads" },
  { icon: FolderKanban, title: "Projects", href: "/projects" },
  { icon: Calendar, title: "Schedule", href: "/schedule" },
];

/**
 * Global Ask command bar (⌘/Ctrl+K from any page). Pick Claude / Qwen / Hermes.
 * Qwen & Hermes answer inline against the host page's `aiContext`; Claude is the
 * async edit-agent, so it starts a conversation with the CURRENT route as
 * context and opens the /ai Ask window to watch the run. ⌘K answers are a quick
 * scratch pad — only Claude (which needs /ai) persists.
 */
export function CommandBar({
  defaultOpen = false,
  aiContext,
}: {
  defaultOpen?: boolean;
  aiContext?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [agent, setAgent] = useState<DevAgent>("qwen");
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const meta = AGENT_META[agent];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        // Jump to the full Ask page (⌘K stays the inline quick-ask popup).
        e.preventDefault();
        setOpen(false);
        router.push("/ai");
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const close = () => setOpen(false);

  const ask = () => {
    const q = prompt.trim();
    if (!q || pending) return;
    setError("");
    setAnswer("");

    if (agent === "claude") {
      // Launch the edit-agent: persist a thread with the current page as
      // context, then hand off to /ai where the run streams in.
      startTransition(async () => {
        try {
          const convId = await newConversationAction("claude");
          const ctx = pathname && pathname !== "/ai" ? pathname : undefined;
          await sendMessageAction(convId, q, ctx);
          close();
          router.push(`/ai?c=${convId}`);
        } catch (e) {
          setError((e as Error).message);
        }
      });
      return;
    }

    // Prefer the page's rich record brief; otherwise at least tell the agent
    // which route the user is on so answers aren't context-blind.
    const ctx =
      aiContext ??
      (pathname
        ? `The user is viewing the ${pathname} page of SJC OS. No structured record context was provided for this page.`
        : undefined);
    startTransition(async () => {
      const r = await askAgent(agent, q, ctx);
      if (r.ok && "answer" in r) setAnswer(r.answer);
      else if (!r.ok) setError(r.error);
    });
  };

  const jump = (href: string) => {
    close();
    router.push(href);
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Ask command bar">
      <button
        aria-label="Close command bar"
        onClick={close}
        className="absolute inset-0 cursor-default bg-ink/45 backdrop-blur-[2px]"
      />
      <div className="absolute left-1/2 top-[110px] w-[620px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-[10px] border-[1.5px] border-ink bg-paper shadow-[0_24px_60px_rgba(0,0,0,0.3)]">
        {/* agent selector */}
        <div className="flex items-center gap-2 border-b border-rule px-[18px] py-2">
          <div className="flex rounded-md border border-rule bg-paper-2 p-0.5">
            {AGENT_ORDER.map((a) => (
              <button
                key={a}
                onClick={() => {
                  setAgent(a);
                  setAnswer("");
                  setError("");
                  inputRef.current?.focus();
                }}
                className={`rounded px-2.5 py-0.5 text-[11.5px] font-medium transition-colors ${
                  a === agent ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper"
                }`}
              >
                {AGENT_META[a].label}
              </button>
            ))}
          </div>
          <span className="truncate text-[11px] text-ink-4">
            {agent === "claude" ? `Edits code · opens in Ask (context: ${pathname})` : meta.note}
          </span>
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
          {(pending || answer || error) && (
            <div className="px-[18px] py-2">
              {pending ? (
                <div className="space-y-1.5" aria-hidden>
                  <div className="h-3 w-[88%] animate-pulse rounded bg-ai/15" />
                  <div className="h-3 w-[64%] animate-pulse rounded bg-ai/15" />
                </div>
              ) : error ? (
                <div className="text-[13px] text-flag">{error}</div>
              ) : (
                <div className="whitespace-pre-wrap rounded-md bg-ai-soft px-3 py-2 text-[13px] leading-relaxed text-ai-2">
                  {answer}
                </div>
              )}
            </div>
          )}

          {!answer && !pending && !error && (
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
            {agent === "claude" ? "↵ LAUNCH · ESC CLOSE" : "↵ ASK · ESC CLOSE"}
          </span>
          <div className="flex-1" />
          <span className="rounded-full border border-ai bg-ai-soft px-2 py-0.5 font-mono text-[9px] text-ai-2">
            {meta.label}
          </span>
        </div>
      </div>
    </div>
  );
}
