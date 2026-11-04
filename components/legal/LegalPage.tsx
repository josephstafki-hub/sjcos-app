import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/shell/Logo";

/** Public legal pages (/eula, /privacy). No Shell, no session: proxy.ts lists
 *  them as public so Intuit's app review, the carriers' SMS review, and anyone
 *  handed the link can read them signed out. Text is the copy Joe sent his web
 *  developer on 2026-10-02 — change it here and there together. */
export function LegalPage({ title, effective, children }: { title: string; effective: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper px-4 py-10 sm:py-14">
      <main className="mx-auto w-full max-w-3xl">
        <div className="mb-8">
          <Link href="/" className="inline-flex" aria-label="SJC OS home">
            <Logo />
          </Link>
        </div>
        <h1 className="font-serif text-display font-medium leading-tight text-accent-2">{title}</h1>
        <p className="mt-1.5 text-body text-ink-3">Effective {effective}</p>
        <article className="legal mt-6 rounded-lg border border-rule bg-card px-4 py-2 text-subheading leading-[1.65] text-ink-2 shadow-sm sm:px-8">
          {children}
        </article>
        <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-label text-ink-3">
          <Link href="/privacy" className="inline-flex min-h-11 items-center hover:text-ink">Privacy Policy</Link>
          <Link href="/eula" className="inline-flex min-h-11 items-center hover:text-ink">End-User License Agreement</Link>
          <Link href="/login" className="inline-flex min-h-11 items-center hover:text-ink">Sign in</Link>
        </nav>
      </main>
    </div>
  );
}
