"use client";

import { useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  Copy,
  Crop,
  ExternalLink,
  Pencil,
  RotateCw,
  Undo2,
  X,
} from "lucide-react";
import type { MoodItem } from "@/lib/mood";

/** Layout bounds — must match the server clamps in lib/actions/mood.ts. */
const MIN_W = 0.08;
const MAX_W = 0.6;
const MIN_H = 0.06;
const MAX_H = 0.9;
const MAX_XY = 0.98;
const MAX_ZOOM = 4;

/** Arrow-key nudge, in board fractions. Shift moves in bigger steps. */
const NUDGE = 0.005;
const NUDGE_FAST = 0.025;
/** Shift while rotating snaps to this many degrees. */
const ROT_SNAP = 15;

interface Pos {
  x: number;
  y: number;
  w: number;
  /** null = auto — the card is as tall as its content makes it. */
  h: number | null;
  rot: number;
  /** Crop focal point (0..1 across the hidden overflow) and zoom (1..MAX_ZOOM).
   *  0.5/0.5/1 is the untouched centre-cover crop. */
  cropX: number;
  cropY: number;
  zoom: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const COLS = 4;
const ROWS = 3;

/** Where an unplaced item lands: a tidy 4-across grid, deterministic by rank so
 *  a board looks the same on every render until someone drags something. Not
 *  persisted — an item only gets real coordinates once it's actually moved.
 *
 *  The grid is capped at COLS×ROWS and then cascades by a small offset: the
 *  board clips (overflow-hidden), so simply letting rows run would park item 13+
 *  below the bottom edge where it can't be seen or dragged back. */
function autoPos(i: number): Pos {
  const slot = i % (COLS * ROWS);
  const off = Math.floor(i / (COLS * ROWS)) * 0.02;
  return {
    x: clamp(0.04 + (slot % COLS) * 0.24 + off, 0, MAX_XY),
    y: clamp(0.05 + Math.floor(slot / COLS) * 0.3 + off, 0, MAX_XY),
    w: 0.21,
    h: null,
    rot: 0,
    cropX: 0.5,
    cropY: 0.5,
    zoom: 1,
  };
}

function posOf(item: MoodItem, rank: number): Pos {
  const crop = { cropX: item.cropX, cropY: item.cropY, zoom: item.zoom };
  if (item.x === null || item.y === null || item.w === null) {
    return { ...autoPos(rank), rot: item.rot, ...crop };
  }
  return { x: item.x, y: item.y, w: item.w, h: item.h, rot: item.rot, ...crop };
}

const isUnplaced = (i: MoodItem) => i.x === null || i.y === null || i.w === null;
const same = (a: Pos, b: Pos) =>
  Math.abs(a.x - b.x) < 0.001 &&
  Math.abs(a.y - b.y) < 0.001 &&
  Math.abs(a.w - b.w) < 0.001 &&
  Math.abs((a.h ?? -1) - (b.h ?? -1)) < 0.001 &&
  Math.abs(a.rot - b.rot) < 0.1 &&
  Math.abs(a.cropX - b.cropX) < 0.001 &&
  Math.abs(a.cropY - b.cropY) < 0.001 &&
  Math.abs(a.zoom - b.zoom) < 0.001;

export interface MoodPatch {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number | null;
  rot: number;
  cropX: number;
  cropY: number;
  zoom: number;
}

/** The eight Photoshop-style transform handles. sx/sy say which edge the handle
 *  drives (-1 = left/top, 1 = right/bottom, 0 = that axis stays put); the
 *  opposite edge is the anchor and holds still while you drag. */
const HANDLES: { sx: -1 | 0 | 1; sy: -1 | 0 | 1; cursor: string; pos: string }[] = [
  { sx: -1, sy: -1, cursor: "nwse-resize", pos: "-left-1 -top-1" },
  { sx: 1, sy: -1, cursor: "nesw-resize", pos: "-right-1 -top-1" },
  { sx: -1, sy: 1, cursor: "nesw-resize", pos: "-left-1 -bottom-1" },
  { sx: 1, sy: 1, cursor: "nwse-resize", pos: "-right-1 -bottom-1" },
  { sx: 0, sy: -1, cursor: "ns-resize", pos: "left-1/2 -top-1 -translate-x-1/2" },
  { sx: 0, sy: 1, cursor: "ns-resize", pos: "left-1/2 -bottom-1 -translate-x-1/2" },
  { sx: -1, sy: 0, cursor: "ew-resize", pos: "-left-1 top-1/2 -translate-y-1/2" },
  { sx: 1, sy: 0, cursor: "ew-resize", pos: "-right-1 top-1/2 -translate-y-1/2" },
];

/** The mood board canvas — free-form transform over a fixed-aspect surface.
 *
 *  Positions are normalized fractions of the board, so a board looks the same at
 *  any window width. Drag/resize/rotate use pointer capture (mouse + touch, no
 *  dependency); moves are local-only and persist once on pointerup, so there's
 *  no per-frame server chatter.
 *
 *  `overrides` is why a drag doesn't snap back: every action here calls
 *  revalidatePath, and the fresh server props would otherwise re-render the item
 *  at its old spot for the moment before the write lands. An override is never
 *  cleared — once the save lands it holds the same value the props do, so it
 *  converges instead of needing teardown. (If a save fails, the item keeps
 *  showing where you dropped it until reload; the error surfaces above.)
 *
 *  Height is opt-in: an item with h === null keeps the pre-transform behaviour
 *  (as tall as its image's natural aspect). Sizing it via a handle gives it a
 *  real height, and from then on the image is cover-fit — a free resize crops
 *  the picture instead of stretching it. Crop mode (the crop button) then picks
 *  WHICH part shows: drag pans the image inside the frame, the slider zooms. */
export function MoodCanvas({
  items,
  pending,
  bgColor,
  onMove,
  onRemove,
  onEditNote,
  onLayer,
  onDuplicate,
}: {
  items: MoodItem[];
  pending: boolean;
  bgColor: string;
  onMove: (pos: MoodPatch) => void;
  onRemove: (id: number) => void;
  onEditNote: (item: MoodItem) => void;
  onLayer: (id: number, dir: "front" | "back") => void;
  onDuplicate: (id: number) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [overrides, setOverrides] = useState<Map<number, Pos>>(new Map());
  /** Item currently under the pointer, or the last one touched — sits on top
   *  until the server's z-order catches up. */
  const [front, setFront] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  /** Item in crop mode: drag pans the image inside its frame, slider zooms. */
  const [cropping, setCropping] = useState<number | null>(null);
  const [broken, setBroken] = useState<Set<number>>(new Set());
  /** Nudges accumulate here while an arrow key is held and flush on keyup, so
   *  holding an arrow down is one save rather than one per repeat event. */
  const nudged = useRef<MoodPatch | null>(null);
  /** Zoom-slider changes debounce into one save; the pending patch is kept so
   *  leaving crop mode can flush it instead of losing the last tick. */
  const cropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cropPending = useRef<MoodPatch | null>(null);

  const ordered = [...items].sort((a, b) => a.z - b.z);

  // `selected` is deliberately not reconciled against `items` — a deleted id is
  // inert on its own. Every read resolves it through `items` (the key handler
  // bails when the lookup misses, and the border check compares ids), so a stale
  // selection simply matches nothing instead of needing an effect to clear it.

  /** Auto-layout slots go by creation order among the items that have never been
   *  placed — NOT by index into the z-sorted list. Dragging any item bumps its
   *  sort_order, and removing one closes a gap; either would otherwise reshuffle
   *  every unplaced item to a different slot on the next render. */
  const autoRank = new Map<number, number>();
  items
    .filter(isUnplaced)
    .sort((a, b) => a.id - b.id)
    .forEach((item, i) => autoRank.set(item.id, i));

  const posFor = (item: MoodItem) =>
    overrides.get(item.id) ?? posOf(item, autoRank.get(item.id) ?? 0);

  /** Shared pointer-capture loop for drag, resize, rotate and crop-pan. `apply`
   *  turns the raw pixel delta into a new position — pixels rather than board
   *  fractions because resize has to un-rotate the delta and rotate needs real
   *  angles, and the board is not square so the two axes aren't interchangeable. */
  function startGesture(
    e: React.PointerEvent,
    item: MoodItem,
    start: Pos,
    apply: (ctx: {
      start: Pos;
      dx: number;
      dy: number;
      rect: DOMRect;
      card: DOMRect;
      shift: boolean;
      clientX: number;
      clientY: number;
    }) => Pos,
  ) {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const cardEl = (e.currentTarget as HTMLElement).closest("[data-pin]") as HTMLElement | null;
    if (!cardEl) return;
    const card = cardEl.getBoundingClientRect();
    const originX = e.clientX;
    const originY = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    // Touching a different card ends the current crop session (flushing any
    // unsaved zoom) so two items can't both look "in crop" at once.
    if (cropping !== null && cropping !== item.id) endCrop();
    setActive(item.id);
    setFront(item.id);
    setSelected(item.id);

    let latest = start;
    const move = (ev: PointerEvent) => {
      latest = apply({
        start,
        dx: ev.clientX - originX,
        dy: ev.clientY - originY,
        rect,
        card,
        shift: ev.shiftKey,
        clientX: ev.clientX,
        clientY: ev.clientY,
      });
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

  /** Photoshop-style handle resize. Corners scale proportionally (Shift for a
   *  free stretch); edges move just that edge. The opposite edge/corner stays
   *  anchored: the size change shifts the centre by half the delta along the
   *  handle's axes, rotated back into board space so it also holds for a card
   *  that isn't square to the board. */
  function startResize(e: React.PointerEvent, item: MoodItem, pos: Pos, sx: number, sy: number) {
    e.preventDefault();
    e.stopPropagation();
    const board = boardRef.current;
    const cardEl = (e.currentTarget as HTMLElement).closest("[data-pin]") as HTMLElement | null;
    if (!board || !cardEl) return;
    // An auto-height card has no h yet — measure what it is on screen right now
    // so the first drag continues from there instead of jumping to a default.
    const startH = pos.h ?? cardEl.offsetHeight / board.getBoundingClientRect().height;
    startGesture(e, item, { ...pos, h: startH }, ({ start, dx, dy, rect, shift }) => {
      const W = start.w * rect.width;
      const H = (start.h as number) * rect.height;
      const X = start.x * rect.width;
      const Y = start.y * rect.height;
      // Un-rotate the pointer delta into the card's own axes, or a rotated card
      // resizes along the wrong diagonal.
      const rad = (start.rot * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const ldx = dx * cos + dy * sin;
      const ldy = -dx * sin + dy * cos;

      let newW = W;
      let newH = H;
      if (sx !== 0 && sy !== 0 && !shift) {
        // Proportional corner: whichever axis the pointer moved further drives
        // the scale, clamped so neither dimension leaves its bounds.
        const kx = (W + sx * ldx) / W;
        const ky = (H + sy * ldy) / H;
        const k = clamp(
          Math.abs(kx - 1) >= Math.abs(ky - 1) ? kx : ky,
          Math.max((MIN_W * rect.width) / W, (MIN_H * rect.height) / H),
          Math.min((MAX_W * rect.width) / W, (MAX_H * rect.height) / H),
        );
        newW = W * k;
        newH = H * k;
      } else {
        if (sx !== 0) newW = clamp(W + sx * ldx, MIN_W * rect.width, MAX_W * rect.width);
        if (sy !== 0) newH = clamp(H + sy * ldy, MIN_H * rect.height, MAX_H * rect.height);
      }

      // Keep the opposite edge anchored: the centre moves by half the size
      // change along the dragged sides, in board space.
      const lcx = (sx * (newW - W)) / 2;
      const lcy = (sy * (newH - H)) / 2;
      const cX = X + W / 2 + lcx * cos - lcy * sin;
      const cY = Y + H / 2 + lcx * sin + lcy * cos;
      return {
        ...start,
        x: clamp((cX - newW / 2) / rect.width, 0, MAX_XY),
        y: clamp((cY - newH / 2) / rect.height, 0, MAX_XY),
        w: newW / rect.width,
        h: newH / rect.height,
      };
    });
  }

  /** Enter crop mode. Cropping only means anything inside a fixed frame, so an
   *  auto-height card gets its measured height persisted first. */
  function startCrop(item: MoodItem, cardEl: HTMLElement | null) {
    const board = boardRef.current;
    const pos = posFor(item);
    const h =
      pos.h ??
      (board && cardEl ? cardEl.offsetHeight / board.getBoundingClientRect().height : 0.2);
    const next = { ...pos, h };
    setOverrides((m) => new Map(m).set(item.id, next));
    setSelected(item.id);
    setFront(item.id);
    setCropping(item.id);
    if (pos.h === null) onMove({ id: item.id, ...next });
  }

  /** Crop changes from the zoom slider: show immediately, save 400ms after the
   *  last tick so a smooth drag is one write, not fifty. */
  function setCrop(item: MoodItem, next: Pos) {
    setOverrides((m) => new Map(m).set(item.id, next));
    cropPending.current = { id: item.id, ...next };
    if (cropTimer.current) clearTimeout(cropTimer.current);
    cropTimer.current = setTimeout(() => {
      if (cropPending.current) onMove(cropPending.current);
      cropPending.current = null;
    }, 400);
  }

  function endCrop() {
    if (cropTimer.current) {
      clearTimeout(cropTimer.current);
      cropTimer.current = null;
    }
    if (cropPending.current) {
      onMove(cropPending.current);
      cropPending.current = null;
    }
    setCropping(null);
  }

  /** Arrow keys nudge the selected item; Delete removes it. */
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && cropping !== null) {
      endCrop();
      return;
    }
    if (selected === null) return;
    const item = items.find((i) => i.id === selected);
    if (!item) return;

    if (e.key === "Escape") {
      setSelected(null);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove(selected);
      return;
    }

    const step = e.shiftKey ? NUDGE_FAST : NUDGE;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();

    const cur = posFor(item);
    const next: Pos = {
      ...cur,
      x: clamp(cur.x + d[0], 0, MAX_XY),
      y: clamp(cur.y + d[1], 0, MAX_XY),
    };
    setOverrides((m) => new Map(m).set(item.id, next));
    setFront(item.id);
    nudged.current = { id: item.id, ...next };
  }

  /** Flush a held nudge once the key comes up. */
  function onKeyUp() {
    if (nudged.current) {
      onMove(nudged.current);
      nudged.current = null;
    }
  }

  return (
    // `isolate` keeps the items' z-index inside this board. The last-touched item
    // sits at z-1000 and `front` is never cleared, so without a stacking context
    // here it would paint over the z-50 modals for the rest of the session
    // (clipped to the board rect, but still on top of the picker).
    <div
      ref={boardRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      // Clicking bare board deselects, so the arrow keys stop steering a card
      // the owner has visually moved on from.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          setSelected(null);
          if (cropping !== null) endCrop();
        }
      }}
      className="relative isolate aspect-[16/10] w-full touch-none select-none overflow-hidden rounded-lg border border-rule outline-none focus-visible:border-accent"
      style={{
        backgroundColor: bgColor || "var(--color-paper-2)",
        // A coloured board drops the dotted paper — the dots read as noise over
        // a chosen background, and the colour IS the surface at that point.
        backgroundImage: bgColor
          ? undefined
          : "radial-gradient(circle, var(--color-rule) 1px, transparent 1px)",
        backgroundSize: bgColor ? undefined : "22px 22px",
      }}
    >
      {ordered.map((item, i) => {
        const pos = posFor(item);
        const isActive = active === item.id;
        const isSelected = selected === item.id;
        const isCropping = cropping === item.id;
        const showImage = item.imageUrl && !broken.has(item.id);
        const caption = item.label || item.note;
        const fixedH = pos.h !== null;
        const isText = item.kind === "text";
        const isSwatch = item.kind === "swatch";
        // How far the image's own edges sit past the frame, as translate() of
        // the zoomed element: object-position already pans the cover overflow,
        // this pans the zoom overflow; both track the same focal point so one
        // drag sweeps the whole hidden area.
        const cropShift = (axis: number) => (-((pos.zoom - 1) / pos.zoom) * axis * 100).toFixed(3);

        return (
          <div
            key={item.id}
            data-pin
            onPointerDown={(e) => {
              // Let the hover controls and the handles do their own thing.
              if ((e.target as HTMLElement).closest("button, a, [data-handle]")) return;
              e.preventDefault();
              if (isCropping) {
                // Crop pan: drag moves the image inside the fixed frame. The
                // mapping needs the real overflow, so measure the natural image
                // against the frame at gesture start.
                const cardEl = e.currentTarget as HTMLElement;
                const img = cardEl.querySelector("img");
                const box = cardEl.querySelector("[data-img-box]") as HTMLElement | null;
                if (!img || !box || !img.naturalWidth || !img.naturalHeight) return;
                // offsetWidth/Height are layout sizes — a rotated card's
                // bounding rect would be the wrong (axis-aligned) box.
                const cw = box.offsetWidth;
                const ch = box.offsetHeight;
                const s = Math.max((pos.zoom * cw) / img.naturalWidth, (pos.zoom * ch) / img.naturalHeight);
                const overX = img.naturalWidth * s - cw;
                const overY = img.naturalHeight * s - ch;
                startGesture(e, item, pos, ({ start, dx, dy }) => {
                  const rad = (start.rot * Math.PI) / 180;
                  const ldx = dx * Math.cos(rad) + dy * Math.sin(rad);
                  const ldy = -dx * Math.sin(rad) + dy * Math.cos(rad);
                  return {
                    ...start,
                    cropX: overX > 1 ? clamp(start.cropX - ldx / overX, 0, 1) : start.cropX,
                    cropY: overY > 1 ? clamp(start.cropY - ldy / overY, 0, 1) : start.cropY,
                  };
                });
                return;
              }
              startGesture(e, item, pos, ({ start, dx, dy, rect }) => ({
                ...start,
                x: clamp(start.x + dx / rect.width, 0, MAX_XY),
                y: clamp(start.y + dy / rect.height, 0, MAX_XY),
              }));
            }}
            className={`group absolute flex flex-col rounded-md border shadow-sm ${
              isText ? "bg-paper/95" : "bg-card"
            } ${
              isCropping
                ? "cursor-move border-accent ring-1 ring-accent"
                : isActive
                  ? "cursor-grabbing border-accent shadow-lg"
                  : isSelected
                    ? "cursor-grab border-accent"
                    : "cursor-grab border-rule hover:border-ink-3"
            }`}
            style={{
              left: `${pos.x * 100}%`,
              top: `${pos.y * 100}%`,
              width: `${pos.w * 100}%`,
              height: fixedH ? `${(pos.h as number) * 100}%` : undefined,
              transform: pos.rot ? `rotate(${pos.rot}deg)` : undefined,
              zIndex: front === item.id ? 1000 : i + 1,
            }}
          >
            {isSwatch ? (
              <div
                className={`w-full rounded-t-md ${fixedH ? "min-h-0 flex-1" : "aspect-square"}`}
                style={{ background: item.swatch || "var(--color-paper-3)" }}
              />
            ) : isText ? (
              <div
                className={`flex items-center justify-center rounded-md px-2.5 py-2 text-center ${
                  fixedH ? "min-h-0 flex-1 overflow-hidden" : ""
                }`}
              >
                <span className="font-serif text-[13px] leading-snug text-ink">{item.label}</span>
              </div>
            ) : showImage ? (
              <div
                data-img-box
                className={`w-full overflow-hidden rounded-t-md ${fixedH ? "min-h-0 flex-1" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl as string}
                  alt={caption || "Mood board item"}
                  draggable={false}
                  onError={() => setBroken((cur) => new Set(cur).add(item.id))}
                  className="block"
                  style={{
                    width: `${pos.zoom * 100}%`,
                    height: fixedH ? `${pos.zoom * 100}%` : "auto",
                    maxWidth: "none",
                    objectFit: "cover",
                    objectPosition: `${pos.cropX * 100}% ${pos.cropY * 100}%`,
                    transform:
                      pos.zoom !== 1
                        ? `translate(${cropShift(pos.cropX)}%, ${cropShift(pos.cropY)}%)`
                        : undefined,
                  }}
                />
              </div>
            ) : (
              <div
                className={`flex items-center justify-center rounded-t-md bg-paper-3 px-2 text-center ${
                  fixedH ? "min-h-0 flex-1" : "aspect-[4/3]"
                }`}
              >
                <span className="line-clamp-3 text-[11px] leading-snug text-ink-2">
                  {caption || "No image"}
                </span>
              </div>
            )}

            {!isText && (caption || item.priceLabel) && (
              <div className="flex shrink-0 flex-col gap-0.5 border-t border-rule px-1.5 py-1">
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

            {!isCropping && (
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
                  disabled={pending}
                  onClick={() => onLayer(item.id, "back")}
                  title="Send to back"
                  className="rounded border border-rule bg-card/90 p-0.5 text-ink-3 hover:text-ink disabled:opacity-50"
                >
                  <ArrowDownToLine className="size-3" strokeWidth={1.75} />
                </button>
                <button
                  disabled={pending}
                  onClick={() => onLayer(item.id, "front")}
                  title="Bring to front"
                  className="rounded border border-rule bg-card/90 p-0.5 text-ink-3 hover:text-ink disabled:opacity-50"
                >
                  <ArrowUpToLine className="size-3" strokeWidth={1.75} />
                </button>
                <button
                  disabled={pending}
                  onClick={() => onDuplicate(item.id)}
                  title="Duplicate"
                  className="rounded border border-rule bg-card/90 p-0.5 text-ink-3 hover:text-ink disabled:opacity-50"
                >
                  <Copy className="size-3" strokeWidth={1.75} />
                </button>
                {showImage && !isSwatch && (
                  <button
                    onClick={(e) =>
                      startCrop(item, (e.currentTarget as HTMLElement).closest("[data-pin]"))
                    }
                    title="Crop — drag to pan, slider to zoom"
                    className="rounded border border-rule bg-card/90 p-0.5 text-ink-3 hover:text-ink"
                  >
                    <Crop className="size-3" strokeWidth={1.75} />
                  </button>
                )}
                <button
                  onClick={() => onEditNote(item)}
                  title="Edit"
                  className="rounded border border-rule bg-card/90 p-0.5 text-ink-3 hover:text-ink"
                >
                  <Pencil className="size-3" strokeWidth={1.75} />
                </button>
                {/* Never disabled on `pending` — removal is optimistic in the
                    parent, and gating it on unrelated in-flight saves is what
                    made the X look permanently greyed out. */}
                <button
                  onClick={() => onRemove(item.id)}
                  title="Remove"
                  className="rounded border border-rule bg-card/90 p-0.5 text-ink-3 hover:text-flag"
                >
                  <X className="size-3" strokeWidth={1.75} />
                </button>
              </div>
            )}

            {/* Crop mode bar: zoom slider, reset, done. data-handle keeps the
                card's pan gesture from starting on it. */}
            {isCropping && (
              <div
                data-handle
                className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 rounded-b-md border-t border-rule bg-card/95 px-2 py-1"
              >
                <input
                  type="range"
                  min={1}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={pos.zoom}
                  onChange={(e) => setCrop(item, { ...pos, zoom: Number(e.currentTarget.value) })}
                  title="Zoom"
                  className="h-1 min-w-0 flex-1 cursor-pointer accent-[#4a5c3a]"
                />
                <button
                  onClick={() => setCrop(item, { ...pos, cropX: 0.5, cropY: 0.5, zoom: 1 })}
                  title="Reset crop"
                  className="rounded border border-rule bg-card/90 p-0.5 text-ink-3 hover:text-ink"
                >
                  <Undo2 className="size-3" strokeWidth={1.75} />
                </button>
                <button
                  onClick={endCrop}
                  title="Done cropping"
                  className="rounded border border-ink bg-ink p-0.5 text-paper"
                >
                  <Check className="size-3" strokeWidth={2} />
                </button>
              </div>
            )}

            {/* Rotate — grab the stem above the card and swing it. Shift snaps
                to 15°. Double-click sets it back to square. */}
            {!isCropping && (
              <div
                data-handle
                title="Rotate (hold Shift to snap, double-click to reset)"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (pos.rot === 0) return;
                  const next = { ...pos, rot: 0 };
                  setOverrides((m) => new Map(m).set(item.id, next));
                  onMove({ id: item.id, ...next });
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  startGesture(e, item, pos, ({ start, card, shift, clientX, clientY }) => {
                    // The card rect is the axis-aligned bounding box of the
                    // rotated element, but its centre is still the true centre —
                    // which is the pivot, since transform-origin is the default.
                    const cx = card.left + card.width / 2;
                    const cy = card.top + card.height / 2;
                    const deg = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
                    // The stem sits above centre, i.e. at -90°, so subtracting
                    // that makes "pointer straight up" mean zero rotation.
                    const raw = deg + 90;
                    return { ...start, rot: shift ? Math.round(raw / ROT_SNAP) * ROT_SNAP : Math.round(raw) };
                  });
                }}
                className="absolute -top-5 left-1/2 flex size-4 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border border-ink-3 bg-card text-ink-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <RotateCw className="size-2.5" strokeWidth={2} />
              </div>
            )}

            {/* Transform handles — corners scale proportionally (Shift for a
                free stretch), edges push just that edge; a sized image crops to
                its frame rather than stretching. */}
            {!isCropping &&
              HANDLES.map((h) => (
                <div
                  key={`${h.sx},${h.sy}`}
                  data-handle
                  title={
                    h.sx !== 0 && h.sy !== 0
                      ? "Resize (Shift for free stretch)"
                      : "Resize this edge"
                  }
                  onPointerDown={(e) => startResize(e, item, pos, h.sx, h.sy)}
                  style={{ cursor: h.cursor }}
                  className={`absolute size-2.5 rounded-sm border border-ink-3 bg-card opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${h.pos}`}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
