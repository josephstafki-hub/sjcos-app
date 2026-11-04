"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui";
import { MORE_SETTINGS, SETTINGS_CATEGORIES } from "./settings-nav";

/** Settings sub-pages: the same menu as /settings itself (sections + More settings). */
export function SettingsSection({ active, children }: { active: string; children: ReactNode }) {
  const router = useRouter();
  const item = (href: string, title: string) => (
    <Link key={href} href={href} aria-current={href === active ? "page" : undefined}
      className={`whitespace-normal break-words rounded px-2.5 py-1.5 text-body transition-colors ${href === active ? "bg-accent-soft font-medium text-accent-2" : "text-ink-2 hover:bg-paper-3"}`}>
      {title}
    </Link>
  );
  return (
    <div className="flex min-h-full flex-col @4xl/page:flex-row">
      <aside className="flex-none border-b border-rule bg-paper-2 p-3.5 @4xl/page:w-52 @4xl/page:border-b-0 @4xl/page:border-r">
        <Eyebrow muted>Settings</Eyebrow>
        <label className="mt-2 flex items-center gap-2 text-label @4xl/page:hidden">Section
          <select aria-label="Settings section" value={active} onChange={(e) => router.push(e.target.value)} className="h-11 min-w-0 flex-1 rounded-md border border-rule bg-card px-2 text-body">
            {SETTINGS_CATEGORIES.map((c) => <option key={c.id} value={`/settings?section=${c.id}`}>{c.title}</option>)}
            {MORE_SETTINGS.map((m) => <option key={m.href} value={m.href}>{m.title}</option>)}
          </select>
        </label>
        <nav aria-label="Settings" className="mt-2 hidden flex-col gap-0.5 @4xl/page:flex">
          {SETTINGS_CATEGORIES.map((c) => item(`/settings?section=${c.id}`, c.title))}
        </nav>
        <div className="mt-4 hidden @4xl/page:block">
          <Eyebrow muted>More settings</Eyebrow>
          <nav aria-label="More settings" className="mt-2 flex flex-col gap-0.5">{MORE_SETTINGS.map((m) => item(m.href, m.title))}</nav>
        </div>
      </aside>
      <section className="min-w-0 flex-1 px-4 py-6 @4xl/page:px-6"><div className="max-w-2xl space-y-6">{children}</div></section>
    </div>
  );
}
