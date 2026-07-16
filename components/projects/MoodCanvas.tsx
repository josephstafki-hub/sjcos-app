"use client";

import { useRef, useState } from "react";
import { ExternalLink, Pencil, X } from "lucide-react";
import type { MoodItem } from "@/lib/mood";

/** Layout bounds — must match the server clamps in lib/actions/mood.ts. */
const MIN_W = 0.08;
const MAX_W = 0.6;
const MAX_XY = 0.98;

interface Pos {
  x: number;
  y: number;
  w: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const COLS = 4;
const ROWS = 3;

/** Where an unplaced pin lands: a tidy 4-across grid, deterministic by rank so
 *  a board looks the same on every render until someone drags something. Not
 *  persisted — a pin only gets real coordinates once it's actually moved.
 *
 *  The grid is capped at COLS×ROWS and then cascades by a small offset: the
 *  board clips (overflow-hidden), so simply letting rows run would park pin 13+
 *  below the bottom edge where it can't be seen or dragged back. */
function autoPos(i: number): Pos {
  const slot = i % (COLS * ROWS);
  const off = Math.floor(i / (COLS * ROWS)) * 0.02;
  return {
    x: clamp(0.04 + (slot % COLS) * 0.24 + off, 0, MAX_XY),
    y: clamp(0.05 + Math.floor(slot / COLS) * 0.3 + off, 0, MAX_XY),
    w: 0.21,
  };
}

function posOf(item: MoodItem, rank: number): Pos {
  if (item.x === null || item.y === null || item.w === null) return autoPos(rank);
  return { x: item.x, y: item.y, w: item.w };
}

const isUnplaced = (i: MoodItem) => i.x === null || i.y === null || i.w === null;
const same = (a: Pos, b: Pos) =>
  Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001 && Math.abs(a.w - b.w) < 0.001;

/** The mood board canvas — free-form drag/resize over a fixed-aspect surface.
 *
 *  Positions are normalized fractions of the board, so a board looks the same at
 *  any window width. Drag/resize uses pointer capture (mouse + touch, no
 *  dependency); moves are local-only and persist once on pointerup, so there's
 *  no per-frame server chatter.
 *
 *  `overrides` is why a drag doesn't snap back: every action here calls
 *  revalidatePath, and the fresh server props would otherwise re-render the pin
 *  at its old spot for the moment before the write lands. An override is never
 *  cleared — once the save lands it holds the same value the props do, so it
 *  converges instead of needing teardown. (If a save fails, the pin keeps
 *  showing where you dropped it until reload; the error surfaces above.) */
export function MoodCanvas({
  items,
  pending,
  onMove,
  onRemove,
  onEditNote,
}: {
  items: MoodItem[];
  pending: boolean;
  onMove: (pos: { id: number; x: number; y: number; w: number }) => void;
  onRemove: (id: number) => void;
  onEditNote: (item: MoodItem) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [overrides, setOverrides] = useState<Map<number, Pos>>(new Map());
  /** Pin currently under the pointer, or the last one touched — sits on top
   *  until the server's z-order catches up. */
  const [front, setFront] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [broken, setBroken] = useState<Set<number>>(new Set());

  const ordered = [...items].sort((a, b) => a.z - b.z);

  /** Auto-layout slots go by creation order among the pins that have never been
   *  placed — NOT by index into the z-sorted list. Dragging any pin bumps its
   *  sort_order, and removing one closes a gap; either would otherwise reshuffle
   *  every unplaced pin to a different slot on the next render. */
  const autoRank = new Map<number, number>();
  items
    .filter(isUnplaced)
    .sort((a, b) => a.id - b.id)
    .forEach((item, i) => autoRank.set(item.id, i));

  /** Shared pointer-capture loop for both drag and resize. `apply` turns the
   *  pointer delta (in board fractions) into a new position. */
  function startGesture(
    e: React.PointerEvent,
    item: MoodItem,
    start: Pos,
    apply: (start: Pos, dx: number, dy: number) => Pos,
  ) {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const originX = e.clientX;
    const originY = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    setActive(item.id);
    setFront(item.id);

    let latest = start;
    const move = (ev: PointerEvent) => {
      latest = apply(start, (ev.clientX - originX) / rect.width, (ev.clientY - originY) / rect.height);
      setOverrides((cur) => new Map(cur).set(item.id, latest));
    };
    const end = (ev: PointerEvent) => {
      // Detach first: releasePointerCapture throws if the capture is already
      // gone (a pointercancel can beat us to it), and a throw here would
      // otherwise leave the listeners attached and re-fire this on stray events.
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId);
      setActive(null);
      if (!same(latest, start)) onMove({ id: item.id, ...latest });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }

  return (
    // `isolate` keeps the pins' z-index inside this board. The last-touched pin
    // sits at z-1000 and `front` is never cleared, so without a stacking context
    // here it would paint over the z-50 modals for the rest of the session
    // (clipped to the board rect, but still on top of the picker).
    <div
      ref={boardRef}
      className="relative isolate aspect-[16/10] w-full touch-none select-none overflow-hidden rounded-lg border border-rule bg-paper-2"
      style={{
        backgroundImage: "radial-gradient(circle, var(--color-rule) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      {ordered.map((item, i) => {
        const pos = overrides.get(item.id) ?? posOf(item, autoRank.get(item.id) ?? 0);
        const isActive = active === item.id;
        const showImage = item.imageUrl && !broken.has(item.id);
        const caption = item.label || item.note;
        return (
          <div
            key={item.id}
            onPointerDown={(e) => {
              // Let the hover controls and the resize handle do their own thing.
              if ((e.target as HTMLElement).closest("button, a, [data-handle]")) return;
              e.preventDefault();
              startGesture(e, item, pos, (s, dx, dy) => ({
                x: clamp(s.x + dx, 0, MAX_XY),
                y: clamp(s.y + dy, 0, MAX_XY),
                w: s.w,
              }));
            }}
            className={`group absolute cursor-grab rounded-md border bg-card shadow-sm ${
              isActive ? "cursor-grabbing border-accent shadow-lg" : "border-rule hover:border-ink-3"
            }`}
            style={{
              left: `${pos.x * 100}%`,
              top: `${pos.y * 100}%`,
              width: `${pos.w * 100}%`,
              zIndex: front === item.id ? 1000 : i + 1,
            }}
          >
            {showImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl as string}
                alt={caption || "Mood board item"}
                draggable={false}
                onError={() => setBroken((cur) => new Set(cur).add(item.id))}
                className="w-full rounded-t-md object-cover"
              />
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-t-md bg-paper-3 px-2 text-center">
                <span className="line-clamp-3 text-[11px] leading-snug text-ink-2">
                  {caption || "No image"}
                </span>
              </div>
            )}

            {(caption || item.priceLabel) && (
              <div className="flex flex-col gap-0.5 border-t border-rule px-1.5 py-1">
                {caption && (
                  <span className="line-clamp-2 text-[10px] leading-snug text-ink-2">{caption}</span>
                )}
                {item.priceLabel && (
                  <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-ink-3">
                    {item.priceLabel}
                  </span>
                )}
              </div>
            )}

            <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open product page"
                  className="rounded border border-rule bg-card/90 p-0.5 text-ink-3 hover:text-ink"
                >
                  <ExternalLink className="size-3" strokeWidth={1.75} />
                </a>
              )}
              <button
                onClick={() => onEditNote(item)}
                title="Note"
                className="rounded border border-rule bg-card/90 p-0.5 text-ink-3 hover:text-ink"
              >
                <Pencil className="size-3" strokeWidth={1.75} />
              </button>
              <button
                disabled={pending}
                onClick={() => onRemove(item.id)}
                title="Remove"
                className="rounded border border-rule bg-card/90 p-0.5 text-ink-3 hover:text-flag disabled:opacity-50"
              >
                <X className="size-3" strokeWidth={1.75} />
              </button>
            </div>

            <div
              data-handle
              title="Resize"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                startGesture(e, item, pos, (s, dx) => ({ ...s, w: clamp(s.w + dx, MIN_W, MAX_W) }));
              }}
              className="absolute -bottom-1 -right-1 size-3 cursor-se-resize rounded-sm border border-ink-3 bg-card opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            />
          </div>
        );
      })}
    </div>
  );
}
