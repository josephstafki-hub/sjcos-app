"use client";

import { useState } from "react";
import { Expand } from "lucide-react";
import { Lightbox } from "@/components/ui";
import type { MoodBoardData } from "@/lib/mood";

/** Review every published item at a readable size. Owner canvas coordinates
 *  must never crop the materials a client is about to approve. */
export function PortalMoodBoard({ board }: { board: MoodBoardData }) {
  const [active, setActive] = useState<number | null>(null);
  const items = [...board.items].sort((a, b) => a.z - b.z || a.id - b.id);
  const photos = items.filter((item) => item.imageUrl).map((item) => ({
    id: String(item.id), name: item.label || "Mood board image", src: item.imageUrl!, caption: [item.label, item.note, item.priceLabel].filter(Boolean).join(" · "),
  }));
  return (
    <div className="@container/board">
      <div className="grid grid-cols-1 gap-3 @sm/board:grid-cols-2 @3xl/board:grid-cols-3">
        {items.map((item) => (
          <article key={item.id} className="min-w-0 overflow-hidden rounded-lg border border-rule-soft bg-card shadow-card">
            {item.imageUrl ? (
              <button type="button" className="group relative block w-full bg-paper-2 focus-visible:outline-2 focus-visible:outline-focus"
                aria-label={`Enlarge ${item.label || "mood board image"}`}
                onClick={() => setActive(photos.findIndex((p) => p.src === item.imageUrl))}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.imageUrl} alt={item.label || "Mood board image"} className="h-56 w-full object-contain" loading="lazy" />
                <span className="absolute bottom-2 right-2 flex min-h-11 items-center gap-1.5 rounded-md bg-card px-3 text-label text-ink shadow-card"><Expand className="size-4" /> Enlarge</span>
              </button>
            ) : item.kind === "swatch" ? (
              <div className="h-28 border-b border-rule-soft" style={{ background: item.swatch || "var(--paper-3)" }} aria-label={item.label || "Color swatch"} />
            ) : null}
            <div className="space-y-1 p-3.5">
              {item.label && <p className="whitespace-pre-wrap break-words text-subheading font-semibold text-ink">{item.label}</p>}
              {item.note && item.note !== item.label && <p className="whitespace-pre-wrap break-words text-body text-ink-2">{item.note}</p>}
              {item.priceLabel && <p className="text-meta tabular-nums text-ink-3">{item.priceLabel}</p>}
            </div>
          </article>
        ))}
      </div>
      {active !== null && <Lightbox photos={photos} index={active} onClose={() => setActive(null)} onIndexChange={setActive} />}
    </div>
  );
}
