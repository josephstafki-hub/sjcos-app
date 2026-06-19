"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Home,
  Inbox,
  Sprout,
  FolderKanban,
  Calendar,
  type LucideIcon,
} from "lucide-react";
import { AI_NAME } from "@/lib/ai-name";
import { askQwen } from "@/lib/actions/ask";

type JumpRow = { icon: LucideIcon; title: string; href: string };

const JUMP: JumpRow[] = [
  { icon: Home, title: "Today", href: "/today" },
  { icon: Inbox, title: "Inbox", href: "/inbox" },
  { icon: Sprout, title: "Leads", href: "/leads" },
  { icon: FolderKanban, title: "Projects", href: "/projects" },
  { icon: Calendar, title: "Schedule", href: "/schedule" },
];

/**
 * Global Ask-{AI_NAME} command bar — the front door to the assistant. Mounted
 * once in Shell so Ctrl/⌘+K opens it from any page; type a question and Qwen
 * answers inline. Esc or a backdrop click closes it. (Page-context awareness —
 * passing the current page to Qwen — lands in a later session.)
 */
export function CommandBar({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        // ⌘J / Ctrl+J — open the assistant bar too.
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the input whenever the bar opens.
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
    startTransition(async () => {
      const r = await askQwen(q);
      if (r.ok) setAnswer(r.answer ?? "");
      else setError(r.error ?? "Couldn't reach the assistant.");
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
            placeholder={`Ask ${AI_NAME} anything…`}
            className="flex-1 bg-transparent font-serif text-[15px] text-ink outline-none placeholder:text-ink-4"
          />
          <span className="font-mono text-[11px] text-ink-3">{pending ? "…" : "↵ ask"}</span>
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
                <div className="rounded-md bg-ai-soft px-3 py-2 text-[13px] leading-relaxed text-ai-2">
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
          <span className="font-mono text-[10px] text-ink-3">↵ ASK · ESC CLOSE</span>
          <div className="flex-1" />
          <span className="rounded-full border border-ai bg-ai-soft px-2 py-0.5 font-mono text-[9px] text-ai-2">
            {AI_NAME}
          </span>
        </div>
      </div>
    </div>
  );
}
