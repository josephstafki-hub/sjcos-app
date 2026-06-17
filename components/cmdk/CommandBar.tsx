"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Plus,
  FileText,
  Mail,
  DollarSign,
  FolderKanban,
  UserRound,
  type LucideIcon,
} from "lucide-react";

type CmdRow = {
  icon: LucideIcon;
  title: string;
  sub: string;
  kbd: string;
  href?: string;
  ai?: boolean;
};

const ACTIONS: CmdRow[] = [
  { icon: Plus, title: "Create new lead", sub: "…from a text, voicemail, or paste", kbd: "N L", href: "/leads" },
  { icon: FileText, title: "Generate Scope of Work", sub: "from current project notes", kbd: "G S", href: "/ai" },
  { icon: Mail, title: "Draft client status email", sub: "this week's update for Henderson", kbd: "D S", href: "/ai" },
  { icon: DollarSign, title: "Send demand letter — Reyes", sub: "day 15 unpaid · draft ready", kbd: "↵", href: "/projects/reyes" },
];

const JUMP: CmdRow[] = [
  { icon: FolderKanban, title: "Henderson kitchen", sub: "Active · Tile this afternoon", kbd: "→", href: "/projects/henderson" },
  { icon: UserRound, title: "Maria Chen · Phase 1", sub: "Awaiting your reply", kbd: "→", href: "/leads/maria-chen" },
];

function Group({ label }: { label: string }) {
  return (
    <div className="px-[18px] pb-1 pt-2.5 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
      {label}
    </div>
  );
}

function Row({ row, onPick }: { row: CmdRow; onPick: (href?: string) => void }) {
  const Icon = row.icon;
  return (
    <button
      onClick={() => onPick(row.href)}
      className={[
        "flex w-full items-center gap-2.5 px-[18px] py-2 text-left transition-colors",
        row.ai ? "bg-ai-soft hover:bg-ai-soft" : "hover:bg-paper-2",
      ].join(" ")}
    >
      <Icon className={`size-3.5 flex-none ${row.ai ? "text-ai-2" : "text-ink-2"}`} strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] ${row.ai ? "font-semibold text-ai-2" : "text-ink"}`}>
          {row.title}
        </div>
        <div className="text-[11px] text-ink-3">{row.sub}</div>
      </div>
      <span className="rounded bg-paper-3 px-1.5 py-px font-mono text-[10px] text-ink-3">{row.kbd}</span>
    </button>
  );
}

/**
 * Global command bar — the front door to Claude. Mounted once in Shell so
 * Ctrl/⌘+K opens it from any page; Esc or a backdrop click closes it.
 */
export function CommandBar({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        // ⌘J / Ctrl+J — Ask Claude (per spec keyboard table)
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

  if (!open) return null;

  const pick = (href?: string) => {
    setOpen(false);
    if (href) router.push(href);
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Command bar">
      {/* dim */}
      <button
        aria-label="Close command bar"
        onClick={() => setOpen(false)}
        className="absolute inset-0 cursor-default bg-ink/45 backdrop-blur-[2px]"
      />
      {/* panel */}
      <div className="absolute left-1/2 top-[110px] w-[620px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-[10px] border-[1.5px] border-ink bg-paper shadow-[0_24px_60px_rgba(0,0,0,0.3)]">
        <div className="flex items-center gap-2.5 border-b border-rule px-[18px] py-3">
          <Sparkles className="size-[18px] flex-none text-ai" strokeWidth={1.5} />
          <span className="flex-1 font-serif text-[15px] text-ink">
            What does Henderson tile install need from me today?
          </span>
          <span className="font-mono text-[11px] text-ink-3">↵ ask</span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          <Group label="Claude — context aware" />
          <Row
            row={{
              icon: Sparkles,
              title: "Ask Claude with the current page as context",
              sub: "2 active jobs · today's schedule loaded",
              kbd: "↵",
              href: "/ai",
              ai: true,
            }}
            onPick={pick}
          />
          <div className="mx-3 my-1.5 border-t border-rule" />
          <Group label="Actions" />
          {ACTIONS.map((r) => (
            <Row key={r.title} row={r} onPick={pick} />
          ))}
          <div className="mx-3 my-1.5 border-t border-rule" />
          <Group label="Jump to" />
          {JUMP.map((r) => (
            <Row key={r.title} row={r} onPick={pick} />
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-rule bg-paper-2 px-[18px] py-2">
          <span className="font-mono text-[10px] text-ink-3">
            ↑↓ NAV · ↵ RUN · TAB CYCLE MODE · ESC CLOSE
          </span>
          <div className="flex-1" />
          <span className="rounded-full border border-ai bg-ai-soft px-2 py-0.5 font-mono text-[9px] text-ai-2">
            Claude
          </span>
          <span className="rounded-full border border-ink-4 px-2 py-0.5 font-mono text-[9px] text-ink-3">
            Actions
          </span>
          <span className="rounded-full border border-ink-4 px-2 py-0.5 font-mono text-[9px] text-ink-3">
            Jump
          </span>
        </div>
      </div>
    </div>
  );
}
