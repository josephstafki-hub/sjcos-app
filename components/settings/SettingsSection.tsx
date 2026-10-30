"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
const links = [["Settings", "/settings"], ["Pricing", "/settings/pricing"], ["Overhead", "/settings/overhead"], ["Square payments", "/settings/payments"], ["QuickBooks", "/settings/accounting"]];
export function SettingsSection({ active, children }: { active: string; children: ReactNode }) {
  const router = useRouter();
  return <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 @4xl/page:grid-cols-[192px_minmax(0,1fr)] @4xl/page:px-6">
    <label className="flex items-center gap-2 text-label @4xl/page:hidden">Section
      <select aria-label="Settings section" value={active} onChange={(e) => router.push(e.target.value)} className="h-11 min-w-0 flex-1 rounded-md border border-rule bg-card px-3 text-body">{links.map(([label, href]) => <option key={href} value={href}>{label}</option>)}</select>
    </label>
    <nav aria-label="Settings" className="hidden flex-col gap-1 @4xl/page:flex">{links.map(([label, href]) => <Link key={href} href={href} aria-current={href === active ? "page" : undefined} className={`break-words rounded-md px-3 py-2 text-body ${href === active ? "bg-selected font-semibold text-ink" : "text-ink-3 hover:bg-hover"}`}>{label}</Link>)}</nav>
    <div className="min-w-0 max-w-2xl space-y-6">{children}</div>
  </div>;
}
