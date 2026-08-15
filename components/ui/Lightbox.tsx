"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Maximize2, Minus, Plus, X } from "lucide-react";

/** One photo the viewer can show. `thumb` (a small `?w=` variant) drives the
 *  grid tile and filmstrip; `src` is what the stage shows; `downloadHref`
 *  defaults to `src` with `download=1` appended. */
export interface LightboxPhoto {
  id: string;
  src: string;
  thumb?: string;
  name: string;
  /** Second caption line — "Uploaded by Dana · Aug 14, 3:12pm". */
  caption?: string;
  downloadHref?: string;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 0.5;
const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function withDownload(src: string): string {
  return src.includes("?") ? `${src}&download=1` : `${src}?download=1`;
}

/**
 * Full-screen photo viewer. Prev/next (buttons, ← →, swipe), zoom (wheel,
 * double-click, +/− buttons, pinch), pan when zoomed, fit-to-screen reset,
 * filename + caption, download, a filmstrip, Esc to close. Rendered in a
 * portal so it escapes any overflow/transform ancestors. Preloads neighbors.
 */
export function Lightbox({
  photos,
  index,
  onClose,
  onIndexChange,
}: {
  photos: LightboxPhoto[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
}) {
  const count = photos.length;
  const photo = photos[index];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const filmRef = useRef<HTMLDivElement>(null);
  // Pointer bookkeeping for drag-to-pan, swipe, and pinch.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gesture = useRef<{
    startPan: { x: number; y: number };
    startPoint: { x: number; y: number };
    startDist: number;
    startZoom: number;
    moved: boolean;
  } | null>(null);

  const step = useCallback(
    (delta: number) => {
      if (count <= 1) return;
      onIndexChange((index + delta + count) % count);
    },
    [count, index, onIndexChange],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const clampPan = useCallback((p: { x: number; y: number }, z: number) => {
    const stage = stageRef.current;
    if (!stage || z <= 1) return { x: 0, y: 0 };
    // Allow panning up to the overflow on each side (approximation using the
    // stage box — the image is object-contained inside it).
    const maxX = (stage.clientWidth * (z - 1)) / 2;
    const maxY = (stage.clientHeight * (z - 1)) / 2;
    return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) };
  }, []);

  const setZoomClamped = useCallback(
    (next: number, around?: { x: number; y: number }) => {
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
      setZoom((prev) => {
        if (around && stageRef.current && z !== prev) {
          // Keep the point under the cursor fixed while zooming.
          const rect = stageRef.current.getBoundingClientRect();
          const cx = around.x - rect.left - rect.width / 2;
          const cy = around.y - rect.top - rect.height / 2;
          setPan((p) => {
            const scale = z / prev;
            return clampPan({ x: cx - (cx - p.x) * scale, y: cy - (cy - p.y) * scale }, z);
          });
        } else if (z === 1) {
          setPan({ x: 0, y: 0 });
        } else {
          setPan((p) => clampPan(p, z));
        }
        return z;
      });
    },
    [clampPan],
  );

  // New photo → fit to screen (render-phase sync, not an effect) …
  const [seenIndex, setSeenIndex] = useState(index);
  if (index !== seenIndex) {
    setSeenIndex(index);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setLoaded(false);
  }
  // … and scroll the filmstrip so the current tile is visible.
  useEffect(() => {
    const strip = filmRef.current;
    const tile = strip?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    tile?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  // Preload neighbors so prev/next feel instant.
  useEffect(() => {
    if (count <= 1) return;
    [index - 1, index + 1].forEach((i) => {
      const p = photos[(i + count) % count];
      if (p) {
        const img = new Image();
        img.src = p.src;
      }
    });
  }, [index, count, photos]);

  // Mount/unmount only: lock body scroll, move focus into the dialog, and put
  // it back where it was on close.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previouslyFocused = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  // Keyboard: Esc close, arrows step, +/- zoom, 0 fit, Tab stays inside.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "+" || e.key === "=") setZoomClamped(zoom + ZOOM_STEP);
      else if (e.key === "-" || e.key === "_") setZoomClamped(zoom - ZOOM_STEP);
      else if (e.key === "0") resetView();
      else if (e.key === "Tab" && rootRef.current) {
        const focusables = rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step, zoom, setZoomClamped, resetView]);

  // Wheel: zoom around the cursor (ctrl/trackpad pinch and plain wheel alike).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const delta = -e.deltaY * (e.ctrlKey ? 0.01 : 0.0025);
      setZoomClamped(zoom * (1 + delta), { x: e.clientX, y: e.clientY });
    }
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoom, setZoomClamped]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      gesture.current = {
        startPan: pan,
        startPoint: { x: e.clientX, y: e.clientY },
        startDist: dist,
        startZoom: zoom,
        moved: false,
      };
    } else if (pts.length === 1) {
      gesture.current = {
        startPan: pan,
        startPoint: { x: e.clientX, y: e.clientY },
        startDist: 0,
        startZoom: zoom,
        moved: false,
      };
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length >= 2 && g.startDist > 0) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      g.moved = true;
      setZoomClamped(g.startZoom * (dist / g.startDist), mid);
      return;
    }
    const dx = e.clientX - g.startPoint.x;
    const dy = e.clientY - g.startPoint.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) g.moved = true;
    if (zoom > 1) {
      setPan(clampPan({ x: g.startPan.x + dx, y: g.startPan.y + dy }, zoom));
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    const start = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return; // pinch partner still down
    if (g && start && zoom <= 1 && g.startDist === 0) {
      // Horizontal swipe steps photos when not zoomed.
      const dx = e.clientX - g.startPoint.x;
      const dy = e.clientY - g.startPoint.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    }
    // Leave `moved` readable for the click handler that fires right after.
    window.setTimeout(() => {
      gesture.current = null;
    }, 0);
  }

  function onDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (zoom > 1) resetView();
    else setZoomClamped(2.5, { x: e.clientX, y: e.clientY });
  }

  if (!photo) return null;
  const downloadHref = photo.downloadHref ?? withDownload(photo.src);

  const node = (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo viewer: ${photo.name}`}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex flex-col bg-ink/95 text-paper outline-none"
    >
      {/* Top bar */}
      <div className="flex flex-none items-center gap-2 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-paper">{photo.name}</div>
          {photo.caption && (
            <div className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-paper/60">
              {photo.caption}
            </div>
          )}
        </div>
        <span className="font-mono text-[11px] tabular-nums text-paper/60">
          {index + 1} / {count}
        </span>
        <div className="mx-2 hidden items-center gap-0.5 rounded-md border border-paper/15 sm:flex">
          <IconBtn label="Zoom out (−)" onClick={() => setZoomClamped(zoom - ZOOM_STEP)} disabled={zoom <= MIN_ZOOM}>
            <Minus className="size-4" strokeWidth={1.5} />
          </IconBtn>
          <button
            type="button"
            onClick={resetView}
            title="Fit to screen (0)"
            className="min-w-[46px] px-1 font-mono text-[11px] tabular-nums text-paper/80 hover:text-paper"
          >
            {Math.round(zoom * 100)}%
          </button>
          <IconBtn label="Zoom in (+)" onClick={() => setZoomClamped(zoom + ZOOM_STEP)} disabled={zoom >= MAX_ZOOM}>
            <Plus className="size-4" strokeWidth={1.5} />
          </IconBtn>
          <IconBtn label="Fit to screen (0)" onClick={resetView} disabled={zoom === 1}>
            <Maximize2 className="size-4" strokeWidth={1.5} />
          </IconBtn>
        </div>
        <a
          href={downloadHref}
          download={photo.name}
          title="Download original"
          className="flex size-8 items-center justify-center rounded-md text-paper/80 hover:bg-paper/10 hover:text-paper"
        >
          <Download className="size-4" strokeWidth={1.5} />
        </a>
        <IconBtn label="Close (Esc)" onClick={onClose}>
          <X className="size-5" strokeWidth={1.5} />
        </IconBtn>
      </div>

      {/* Stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {count > 1 && (
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous (←)"
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-ink/40 p-2 text-paper/80 hover:bg-ink/70 hover:text-paper"
          >
            <ChevronLeft className="size-7" strokeWidth={1.5} />
          </button>
        )}
        <div
          ref={stageRef}
          className={`flex size-full touch-none select-none items-center justify-center overflow-hidden px-12 ${
            zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onClick={(e) => {
            // Click on the empty stage (not the image) closes, unless it was a drag.
            if (e.target === e.currentTarget && !gesture.current?.moved) onClose();
          }}
        >
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.16em] text-paper/50">
              Loading…
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={photo.id}
            src={photo.src}
            alt={photo.name}
            draggable={false}
            onLoad={() => setLoaded(true)}
            className="max-h-full max-w-full object-contain transition-transform duration-75 ease-out"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              opacity: loaded ? 1 : 0,
            }}
          />
        </div>
        {count > 1 && (
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next (→)"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-ink/40 p-2 text-paper/80 hover:bg-ink/70 hover:text-paper"
          >
            <ChevronRight className="size-7" strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Filmstrip */}
      {count > 1 && (
        <div ref={filmRef} className="flex flex-none gap-1.5 overflow-x-auto px-4 py-2.5">
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              data-index={i}
              onClick={() => onIndexChange(i)}
              aria-label={`Show ${p.name}`}
              aria-current={i === index ? "true" : undefined}
              className={`size-14 flex-none overflow-hidden rounded border transition-opacity ${
                i === index ? "border-paper opacity-100" : "border-paper/20 opacity-55 hover:opacity-90"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb ?? p.src} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(node, document.body);
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-md text-paper/80 hover:bg-paper/10 hover:text-paper disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
