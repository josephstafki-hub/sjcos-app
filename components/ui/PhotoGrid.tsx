"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

// Clickable photo thumbnails that open a lightbox overlay (prev / next / esc).
// The app has no real image URLs yet, so tiles render as themed placeholders;
// the lightbox enlarges the same tile with a caption. Reusable across lead
// detail, project files, etc. — pass a `count` (and optional `label`/`cols`).

export function PhotoGrid({
  count,
  label = "Photo",
  cols = 3,
}: {
  count: number;
  label?: string;
  cols?: number;
}) {
  const [open, setOpen] = useState<number | null>(null);

  const close = useCallback(() => setOpen(null), []);
  const step = useCallback(
    (delta: number) => setOpen((cur) => (cur === null ? cur : (cur + delta + count) % count)),
    [count],
  );

  useEffect(() => {
    if (open === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, step]);

  if (count <= 0) return null;

  return (
    <>
      <div
        className="mt-2 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: count }).map((_, i) => (
          <button
            key={i}
            onClick={() => setOpen(i)}
            aria-label={`${label} ${i + 1} of ${count}`}
            className="aspect-square rounded-[3px] border border-rule bg-paper-3 transition-colors hover:border-accent hover:bg-paper-2"
          />
        ))}
      </div>

      {open !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6"
          onClick={close}
        >
          <button
            onClick={close}
            aria-label="Close"
            className="absolute right-5 top-5 text-paper/80 hover:text-paper"
          >
            <X className="size-6" strokeWidth={1.5} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            aria-label="Previous"
            className="absolute left-4 text-paper/70 hover:text-paper"
          >
            <ChevronLeft className="size-8" strokeWidth={1.5} />
          </button>

          <figure
            className="flex w-full max-w-[680px] flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-paper/15 bg-paper-3/95 font-mono text-[12px] uppercase tracking-[0.16em] text-ink-3">
              {label} {open + 1}
            </div>
            <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper/70">
              {label} {open + 1} of {count}
            </figcaption>
          </figure>

          <button
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            aria-label="Next"
            className="absolute right-4 text-paper/70 hover:text-paper"
          >
            <ChevronRight className="size-8" strokeWidth={1.5} />
          </button>
        </div>
      )}
    </>
  );
}
