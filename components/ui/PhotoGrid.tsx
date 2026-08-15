"use client";

import { useMemo, useState } from "react";
import { Lightbox, type LightboxPhoto } from "./Lightbox";

// Clickable photo thumbnails that open the Lightbox viewer (zoom / pan /
// prev-next / download / filmstrip). Reusable across lead detail, project
// files, the client-portal tab, etc.
//
// Two ways to feed it:
//   • `photos` — full LightboxPhoto records (name, thumb, caption, …). Preferred.
//   • legacy `count` + `srcs` — bare URLs; tiles without a URL render as themed
//     placeholders (the showcase look from before real uploads existed).

export function PhotoGrid({
  count,
  label = "Photo",
  cols = 3,
  srcs,
  photos,
  className = "mt-2",
}: {
  count?: number;
  label?: string;
  cols?: number;
  /** Real image URLs (legacy). When given, tiles + viewer render actual photos. */
  srcs?: string[];
  /** Full photo records — drives tiles (thumb) and the viewer (src, caption). */
  photos?: LightboxPhoto[];
  className?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);

  const items: LightboxPhoto[] = useMemo(() => {
    if (photos) return photos;
    const n = count ?? srcs?.length ?? 0;
    return Array.from({ length: n }, (_, i) => ({
      id: String(i),
      src: srcs?.[i] ?? "",
      name: `${label} ${i + 1}`,
    }));
  }, [photos, count, srcs, label]);

  const total = items.length;
  if (total <= 0) return null;

  return (
    <>
      <div
        className={`${className} grid gap-1`}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {items.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(i)}
            aria-label={`${p.name} (${i + 1} of ${total})`}
            title={p.name}
            className="aspect-square overflow-hidden rounded-[3px] border border-rule bg-paper-3 transition-colors hover:border-accent hover:bg-paper-2"
          >
            {p.src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.thumb ?? p.src}
                alt={p.name}
                loading="lazy"
                className="size-full object-cover"
              />
            )}
          </button>
        ))}
      </div>

      {open !== null && items[open]?.src && (
        <Lightbox photos={items} index={open} onClose={() => setOpen(null)} onIndexChange={setOpen} />
      )}
      {open !== null && !items[open]?.src && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6"
          onClick={() => setOpen(null)}
        >
          <div className="flex aspect-[4/3] w-full max-w-[680px] items-center justify-center rounded-md border border-paper/15 bg-paper-3/95 font-mono text-[12px] uppercase tracking-[0.16em] text-ink-3">
            {items[open]?.name}
          </div>
        </div>
      )}
    </>
  );
}
