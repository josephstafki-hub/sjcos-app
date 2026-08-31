import Link from "next/link";
import { LibraryBig } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { Card, Chip, Field } from "@/components/ui";
import { ToolPalette } from "@/components/floor/ToolPalette";
import { getFloorData } from "@/lib/floor";

export default async function FloorPlanPage() {
  const data = await getFloorData();

  return (
    <Shell breadcrumb={`FLOOR PLAN › ${data.title.toUpperCase()}`}>
      <div className="flex h-full">
        {/* ─── Tool palette ───────────────────────────────────────── */}
        <ToolPalette tools={data.tools} />

        {/* ─── Canvas ─────────────────────────────────────────────── */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-paper px-4 py-2.5">
            <div className="flex gap-1">
              <Chip kind="solid">Plan</Chip>
              <Chip kind="ghost">3D</Chip>
              <Chip kind="ghost">Selections layer</Chip>
            </div>
            <div className="flex-1" />
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip kind="ghost">Snap 1&quot;</Chip>
              <Chip kind="ghost">Scale 1/4&quot;</Chip>
              <Chip kind="ghost">100%</Chip>
              <Link
                href="/catalog"
                className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-paper-2"
              >
                <LibraryBig className="size-3" strokeWidth={1.5} />
                Browse catalog
              </Link>
            </div>
          </div>

          <div className="relative flex-1 overflow-hidden bg-paper-2">
            {/* grid */}
            <svg className="absolute inset-0 size-full opacity-40" aria-hidden>
              <defs>
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--rule)" strokeWidth="0.6" />
                </pattern>
                <pattern id="grid-major" width="80" height="80" patternUnits="userSpaceOnUse">
                  <path d="M 80 0 L 0 0 0 80" fill="none" stroke="var(--rule)" strokeWidth="1.1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
              <rect width="100%" height="100%" fill="url(#grid-major)" />
            </svg>

            {/* kitchen plan */}
            <svg
              className="absolute left-20 top-12 overflow-visible"
              width="540"
              height="380"
              aria-label="Henderson kitchen floor plan"
            >
              <path
                d="M 20 20 L 480 20 L 480 200 L 380 200 L 380 320 L 20 320 Z"
                fill="var(--paper)"
                stroke="var(--ink)"
                strokeWidth="2.5"
              />
              {/* door swing */}
              <path d="M 20 100 L 20 160" stroke="var(--paper)" strokeWidth="5" />
              <path d="M 20 100 A 60 60 0 0 1 80 160" fill="none" stroke="var(--ink-3)" strokeWidth="1" />
              {/* window */}
              <rect x="200" y="14" width="120" height="12" fill="var(--paper-3)" stroke="var(--ink)" strokeWidth="1.5" />
              {/* cabinet runs */}
              <rect x="20" y="20" width="460" height="42" fill="rgba(196,106,59,0.15)" stroke="var(--accent)" strokeWidth="1.25" strokeDasharray="3 2" />
              <rect x="438" y="20" width="42" height="180" fill="rgba(196,106,59,0.15)" stroke="var(--accent)" strokeWidth="1.25" strokeDasharray="3 2" />
              <rect x="20" y="278" width="360" height="42" fill="rgba(196,106,59,0.15)" stroke="var(--accent)" strokeWidth="1.25" strokeDasharray="3 2" />
              {/* island */}
              <rect x="120" y="140" width="240" height="80" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2" />
              <text x="240" y="186" textAnchor="middle" fontFamily="var(--font-serif, serif)" fontSize="13" fill="var(--ink-2)">
                island · 8&apos; × 2&apos;8&quot;
              </text>
              {/* range + fridge */}
              <rect x="220" y="22" width="60" height="38" fill="var(--paper-3)" stroke="var(--ink-2)" strokeWidth="1.5" />
              <text x="250" y="46" textAnchor="middle" fontSize="11" fill="var(--ink-2)">RANGE</text>
              <rect x="380" y="22" width="58" height="40" fill="var(--paper-3)" stroke="var(--ink-2)" strokeWidth="1.5" />
              <text x="409" y="46" textAnchor="middle" fontSize="11" fill="var(--ink-2)">FRIDGE</text>
              {/* dimensions */}
              <text x="250" y="6" textAnchor="middle" fontFamily="monospace" fontSize="10" fill="var(--ink-3)">16&apos; 4&quot;</text>
              {/* selection handles on island */}
              <rect x="115" y="135" width="250" height="90" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="6 3" />
              {[[115, 135], [365, 135], [115, 225], [365, 225]].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" fill="var(--accent)" />
              ))}
            </svg>

            <div className="absolute right-6 top-3 max-w-[170px] rotate-2 font-mono text-[9px] text-accent-2">
              → cabinet runs · auto-pulled from selections
            </div>
          </div>
        </section>

        {/* ─── Inspector / catalog ────────────────────────────────── */}
        <aside className="w-[280px] flex-none overflow-y-auto border-l border-rule bg-paper p-3.5">
          <div className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
            Selected
          </div>
          <h2 className="mt-1.5 font-serif text-[15px] font-semibold text-ink">
            {data.selected.name}
          </h2>
          <div className="text-[11px] text-ink-3">Type: {data.selected.type}</div>

          <div className="my-3 border-t border-rule" />
          <div className="flex flex-col gap-2">
            {data.selected.fields.map((f) => (
              <Field key={f.label} label={f.label} value={f.value} />
            ))}
          </div>

          <div className="my-3 border-t border-rule" />
          <div className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
            {data.catalogLabel}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-1.5">
                <div className="aspect-[4/3] rounded-sm bg-paper-3" />
                <div className="mt-1 text-[10px] text-ink-3">Base 4-door · {30 + i * 6}&quot;</div>
              </Card>
            ))}
          </div>
          <Link
            href="/catalog"
            className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-paper-2"
          >
            <LibraryBig className="size-3" strokeWidth={1.5} />
            Browse the full catalog
          </Link>
        </aside>
      </div>
    </Shell>
  );
}
