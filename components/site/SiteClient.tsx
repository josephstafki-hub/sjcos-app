"use client";

import { useState } from "react";
import { FileText, Plus, Sparkles } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { PageStatus, SiteData } from "@/lib/site";

const STATUS_TINT: Record<PageStatus, string> = {
  PUBLISHED: "text-ink-3",
  "AUTO-SYNC": "text-ai-2",
  LIVE: "text-money",
};

type EditMode = "Edit" | "Preview" | "Code";
type Viewport = "Desktop" | "Mobile";

/** Small-caps mono section label for the light rail. */
function RailLabel({ children }: { children: string }) {
  return (
    <div className="px-1 pb-1 pt-2 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
      {children}
    </div>
  );
}

export function SiteClient({ data }: { data: SiteData }) {
  const [selected, setSelected] = useState(data.selectedSlug);
  const [mode, setMode] = useState<EditMode>("Edit");
  const [viewport, setViewport] = useState<Viewport>("Desktop");
  const [headline, setHeadline] = useState(data.home.headline);

  const page = data.pages.find((p) => p.slug === selected);
  const isHome = selected === "home";
  const frameWidth = viewport === "Desktop" ? "max-w-[640px]" : "max-w-[380px]";

  return (
    <div className="flex h-full">
      {/* ─── Pages rail ───────────────────────────────────────────── */}
      <aside className="w-[260px] flex-none overflow-y-auto border-r border-rule bg-paper-2 p-3.5">
        <div className="flex items-center">
          <h2 className="flex-1 font-serif text-[15px] font-semibold text-ink">Pages</h2>
          <Plus className="size-3.5 text-ink-3" strokeWidth={1.5} />
        </div>

        <div className="mt-2.5 flex flex-col gap-0.5">
          {data.pages.map((p) => (
            <button
              key={p.slug}
              onClick={() => setSelected(p.slug)}
              className={[
                "flex items-center gap-1.5 rounded px-2 py-1.5 text-left transition-colors",
                p.slug === selected ? "bg-accent-soft" : "hover:bg-paper-3",
              ].join(" ")}
            >
              <FileText className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
              <span
                className={[
                  "flex-1 text-[12px]",
                  p.slug === selected ? "font-medium text-accent-2" : "text-ink-2",
                ].join(" ")}
              >
                {p.name}
              </span>
              <span className={`font-mono text-[9px] ${STATUS_TINT[p.status]}`}>{p.status}</span>
            </button>
          ))}
        </div>

        <div className="my-3 border-t border-rule" />

        <RailLabel>Auto-publish queue</RailLabel>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {data.queue.map((q) => (
            <Card key={q.title} kind={q.ai ? "ai" : "soft"} className="p-2">
              <div className={`text-[12px] font-semibold ${q.ai ? "text-ai-2" : "text-ink"}`}>
                {q.title}
              </div>
              <div className={`text-[10px] ${q.ai ? "text-ai-2" : "text-ink-3"}`}>{q.status}</div>
            </Card>
          ))}
        </div>

        <div className="my-3 border-t border-rule" />
        <Card kind="filled" className="p-2">
          <div className="text-[10px] text-ink-3">
            {data.syncNote.replace("Synced", "Synced to")}{" "}
            <span className="font-mono">{data.domain}</span>
          </div>
        </Card>
      </aside>

      {/* ─── Editor ───────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
          <div className="flex gap-1">
            {(["Edit", "Preview", "Code"] as EditMode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)}>
                <Chip kind={mode === m ? "solid" : "ghost"}>{m}</Chip>
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(["Desktop", "Mobile"] as Viewport[]).map((v) => (
              <button key={v} onClick={() => setViewport(v)}>
                <Chip kind={viewport === v ? "solid" : "ghost"}>{v}</Chip>
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <Chip kind="money">All changes saved</Chip>
          <button className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-ai-2">
            <Sparkles className="size-3" strokeWidth={1.5} />
            Improve copy
          </button>
          <button className="rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e]">
            Publish
          </button>
        </div>

        {/* Canvas */}
        <div className="flex flex-1 justify-center overflow-y-auto bg-paper-3 p-6">
          <div
            className={`h-fit w-full ${frameWidth} overflow-hidden rounded-lg border border-rule bg-paper shadow-card`}
          >
            {/* fake browser chrome */}
            <div className="flex items-center gap-1.5 border-b border-rule bg-paper-2 px-2.5 py-1.5">
              <span className="size-2 rounded-full bg-flag" />
              <span className="size-2 rounded-full bg-accent" />
              <span className="size-2 rounded-full bg-money" />
              <span className="ml-2 font-mono text-[9px] text-ink-3">
                {data.domain}/{isHome ? "" : selected}
              </span>
            </div>

            {mode === "Code" ? (
              <div className="p-8 text-center">
                <div className="font-serif text-[15px] font-semibold text-ink-2">Code view</div>
                <div className="mt-1 text-[12px] text-ink-3">This view arrives in a later phase.</div>
              </div>
            ) : isHome ? (
              <>
                {/* nav */}
                <div className="flex items-center gap-4 border-b border-rule-soft px-6 py-3">
                  <span className="font-serif text-[15px] font-semibold text-ink">SJ&nbsp;Carpentry</span>
                  <div className="flex-1" />
                  {["Work", "About", "Blog", "Contact"].map((n) => (
                    <span key={n} className="hidden text-[11px] text-ink-2 sm:inline">
                      {n}
                    </span>
                  ))}
                </div>
                {/* hero */}
                <div className="relative border-b border-rule-soft px-8 py-10">
                  <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3">
                    {data.home.eyebrow}
                  </div>
                  <h1
                    contentEditable={mode === "Edit"}
                    suppressContentEditableWarning
                    onInput={(e) => setHeadline(e.currentTarget.innerText)}
                    className={[
                      "mt-2 whitespace-pre-line font-serif text-[34px] font-medium leading-[1.05] text-ink outline-none",
                      mode === "Edit"
                        ? "cursor-text rounded-sm ring-accent/40 focus:ring-2"
                        : "",
                    ].join(" ")}
                  >
                    {headline}
                  </h1>
                  <p className="mt-2 max-w-[380px] text-[13px] text-ink-2">{data.home.sub}</p>
                  <div className="mt-3.5 flex gap-2">
                    <span className="rounded-md bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper">
                      Request a quote
                    </span>
                    <span className="rounded-md border border-rule px-2.5 py-1 text-[12px] text-ink-2">
                      See recent work →
                    </span>
                  </div>
                  {mode === "Edit" && (
                    <div className="absolute right-3 top-3 -rotate-2 font-mono text-[9px] text-accent-2">
                      ✎ headline editable — click
                    </div>
                  )}
                </div>
                {/* recent work */}
                <div className="px-8 py-6">
                  <div className="flex items-center gap-2">
                    <h3 className="flex-1 font-serif text-[15px] font-semibold text-ink">
                      Recent work
                    </h3>
                    <Chip kind="ai">Auto from completed jobs</Chip>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {data.home.recentWork.map((w) => (
                      <div key={w}>
                        <div className="aspect-[4/3] rounded border border-rule bg-paper-3" />
                        <div className="mt-1 text-[11px] text-ink-2">{w}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center">
                <div className="font-serif text-[18px] font-semibold text-ink">{page?.name}</div>
                <div className="mt-1 text-[12px] text-ink-3">
                  This page editor arrives in a later phase.
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
