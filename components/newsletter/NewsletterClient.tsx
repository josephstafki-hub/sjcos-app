"use client";

import { useState } from "react";
import { Plus, Sparkles, ArrowRight } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { NewsletterData } from "@/lib/newsletter";

type ViewMode = "Edit" | "Preview" | "Audience";

/** Small-caps mono section label for the light rail. */
function RailLabel({ children }: { children: string }) {
  return (
    <div className="px-1 pb-1 pt-2 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
      {children}
    </div>
  );
}

export function NewsletterClient({ data }: { data: NewsletterData }) {
  const [selected, setSelected] = useState(data.selectedSlug);
  const [mode, setMode] = useState<ViewMode>("Edit");
  const c = data.content;

  return (
    <div className="flex h-full">
      {/* ─── Issues rail ──────────────────────────────────────────── */}
      <aside className="w-[260px] flex-none overflow-y-auto border-r border-rule bg-paper-2 p-3.5">
        <div className="flex items-center">
          <h2 className="flex-1 font-serif text-[15px] font-semibold text-ink">Issues</h2>
          <Plus className="size-3.5 text-ink-3" strokeWidth={1.5} />
        </div>
        <div className="mt-2.5 flex flex-col gap-0.5">
          {data.issues.map((it) => (
            <button
              key={it.slug}
              onClick={() => setSelected(it.slug)}
              className={[
                "flex items-center gap-1.5 rounded px-2 py-1.5 text-left transition-colors",
                it.slug === selected ? "bg-accent-soft" : "hover:bg-paper-3",
              ].join(" ")}
            >
              <span
                className={[
                  "flex-1 text-[12px]",
                  it.slug === selected ? "font-medium text-accent-2" : "text-ink-2",
                ].join(" ")}
              >
                {it.name}
              </span>
              <span
                className={`font-mono text-[9px] ${it.status === "DRAFT" ? "text-accent-2" : "text-ink-4"}`}
              >
                {it.status}
              </span>
            </button>
          ))}
        </div>

        <div className="my-3 border-t border-rule" />
        <RailLabel>Audience</RailLabel>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {data.audience.map((a) => (
            <div key={a.label} className="flex items-center">
              <span className="flex-1 text-[12px] text-ink-2">{a.label}</span>
              <span className="font-mono text-[11px] text-ink-3">{a.value}</span>
            </div>
          ))}
        </div>

        <div className="my-3 border-t border-rule" />
        <RailLabel>Latest performance</RailLabel>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {data.performance.map((p) => (
            <div key={p.label} className="flex items-center">
              <span className="flex-1 text-[12px] text-ink-2">{p.label}</span>
              <span className={`font-mono text-[11px] ${p.good ? "text-money" : "text-ink-3"}`}>
                {p.value}
              </span>
            </div>
          ))}
        </div>
      </aside>

      {/* ─── Editor ───────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
          <div className="flex gap-1">
            {(["Edit", "Preview", "Audience"] as ViewMode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)}>
                <Chip kind={mode === m ? "solid" : "ghost"}>{m}</Chip>
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2">
            <Sparkles className="size-3" strokeWidth={1.5} />
            Draft from this month&apos;s jobs
          </button>
          <button className="rounded-md border border-ink-4 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2">
            Save
          </button>
          <button className="rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]">
            Send Tues 8am
          </button>
        </div>

        <div className="flex flex-1 justify-center overflow-y-auto bg-paper-3 p-7">
          {mode === "Audience" ? (
            <Card className="h-fit w-full max-w-[580px] p-8 text-center">
              <div className="font-serif text-[16px] font-semibold text-ink-2">Audience view</div>
              <div className="mt-1 text-[12px] text-ink-3">
                Segment + send-list tools arrive in a later phase.
              </div>
            </Card>
          ) : (
            <div className="h-fit w-full max-w-[580px] overflow-hidden rounded-lg border border-rule bg-paper shadow-card">
              {/* masthead */}
              <div className="border-b border-rule-soft px-9 py-8 text-center">
                <div className="font-serif text-[20px] font-semibold text-accent-2">SJ Carpentry</div>
                <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
                  {c.masthead}
                </div>
              </div>
              {/* body */}
              <div className="px-9 py-8">
                <h1 className="font-serif text-[28px] font-medium leading-tight text-ink">
                  {c.headline}
                </h1>
                <div className="mt-1.5 text-[11px] text-ink-3">{c.byline}</div>
                <div className="my-5 border-t border-dashed border-rule" />
                <div className="aspect-video rounded border border-rule bg-paper-3" />
                {c.body.map((p, i) => (
                  <p key={i} className="mt-3.5 text-[13.5px] leading-relaxed text-ink">
                    {p}
                  </p>
                ))}
                <button className="mt-4 rounded-md border border-rule px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:bg-paper-2">
                  Continue reading →
                </button>
                <div className="my-6 border-t border-dashed border-rule" />
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
                  Also this month
                </div>
                <div className="mt-2.5 flex flex-col gap-2">
                  {c.alsoThisMonth.map((item) => (
                    <div key={item} className="flex items-center gap-2">
                      <span className="flex-1 text-[13.5px] text-ink">{item}</span>
                      <ArrowRight className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
