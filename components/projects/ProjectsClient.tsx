"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { ProjectGroup } from "@/lib/projects";

const DOT: Record<string, string> = {
  accent: "bg-accent",
  ai: "bg-ai",
  ghost: "bg-ink-4",
};

type Filter = "all" | "active" | "pre_construction" | "closeout" | "warranty";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All open" },
  { key: "active", label: "On site" },
  { key: "pre_construction", label: "Pre-con · design" },
  { key: "closeout", label: "Closeout" },
  { key: "warranty", label: "Warranty" },
];

/** Projects list with working status filters over the grouped data. */
export function ProjectsClient({ groups }: { groups: ProjectGroup[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = filter === "all" ? groups : groups.filter((g) => g.key === filter);

  return (
    <>
      <div className="mb-4 flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className="focus:outline-none">
            <Chip kind={filter === f.key ? "solid" : "ghost"}>{f.label}</Chip>
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="py-10 text-center text-[13px] text-ink-3">No projects in this view.</p>
      )}

      {shown.map((g) => (
        <section key={g.key} className="mb-6">
          <div className="mb-2 flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${DOT[g.dot]}`} />
            <h2 className="font-serif text-[16px] font-semibold text-ink">{g.title}</h2>
            <span className="text-[11px] text-ink-3">{g.items.length}</span>
          </div>

          <div className="flex flex-col gap-2">
            {g.items.map((p) => (
              <Link key={p.slug} href={`/projects/${p.slug}`}>
                <Card className="flex items-center gap-3 p-3.5 transition-colors hover:bg-paper-2">
                  <div className="size-10 flex-none rounded border-[1.5px] border-accent bg-accent-soft" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-serif text-[16px] font-semibold text-ink">{p.name}</span>
                      <Chip kind={g.chip} dot>
                        {p.stage}
                      </Chip>
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-3">{p.sub}</div>
                  </div>
                  <div className="hidden w-[220px] sm:block">
                    <div className="mb-1 flex items-center">
                      <span className="flex-1 font-mono text-[11px] text-ink-3">{p.billed}% billed</span>
                      <span className="font-mono text-[12px] text-ink-2">{p.value}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-paper-3">
                      <div className={`h-full ${g.bar}`} style={{ width: `${p.billed}%` }} />
                    </div>
                  </div>
                  <ChevronRight className="size-3.5 flex-none text-ink-3" strokeWidth={1.5} />
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
