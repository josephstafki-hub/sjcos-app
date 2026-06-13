import Link from "next/link";
import { Search, Bell, Sparkles } from "lucide-react";

type TopbarProps = {
  /** Small-caps mono breadcrumb, e.g. "PROJECTS › HENDERSON KITCHEN". */
  breadcrumb?: string;
};

export function Topbar({ breadcrumb = "TODAY" }: TopbarProps) {
  return (
    <div className="flex h-[50px] flex-none items-center gap-3 border-b border-rule bg-paper px-[18px]">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        {breadcrumb}
      </div>

      <div className="flex-1" />

      <Link
        href="/search"
        className="flex w-[280px] items-center gap-1.5 rounded-md border border-rule-soft bg-card px-2.5 py-1"
      >
        <Search className="size-3 text-ink-3" strokeWidth={1.5} />
        <span className="flex-1 text-[12px] text-ink-4">Find a lead, project, file…</span>
        <span className="font-mono text-[9px] text-ink-4">⌘K</span>
      </Link>

      <Link href="/notifications" className="relative" aria-label="Notifications">
        <Bell className="size-4 text-ink-2" strokeWidth={1.5} />
        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-flag" />
      </Link>

      <Link
        href="/ai"
        className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2"
      >
        <Sparkles className="size-3" strokeWidth={1.5} />
        Ask
      </Link>
    </div>
  );
}
