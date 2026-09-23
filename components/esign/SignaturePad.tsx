"use client";

// Hand-drawn signature pad. Finger, Apple Pencil or mouse — pointer events with
// capture, so a stroke that wanders off the box still finishes cleanly and the
// page never scrolls mid-signature (touch-action: none). Strokes are kept as
// CSS-pixel points and re-rendered on resize/rotate, so turning the iPad
// doesn't wipe the ink. toDataUrl() exports a PNG trimmed to the ink bounds at
// 2× so it prints crisply on the executed copy.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

export interface SignaturePadHandle {
  clear(): void;
  isEmpty(): boolean;
  /** PNG data URL of the drawn strokes, trimmed to their bounds — null if empty. */
  toDataUrl(): string | null;
}

type Pt = { x: number; y: number };

const INK = "#1f2419";
const STROKE = 2.6;
/** Less ink than this (total path length, CSS px) is a stray tap, not a signature. */
const MIN_INK = 40;

function drawStroke(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = STROKE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, STROKE / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  // Quadratic through midpoints: smooth without lagging behind the pen.
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function inkLength(strokes: Pt[][]): number {
  let n = 0;
  for (const s of strokes) {
    for (let i = 1; i < s.length; i++) n += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
  }
  return n;
}

export const SignaturePad = forwardRef<
  SignaturePadHandle,
  {
    height?: number;
    className?: string;
    placeholder?: string;
    /** Fires when the pad goes from empty → inked or back (on clear). */
    onChange?: (empty: boolean) => void;
  }
>(function SignaturePad({ height = 220, className = "", placeholder = "Sign here", onChange }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pt[][]>([]);
  const current = useRef<Pt[] | null>(null);
  const [empty, setEmpty] = useState(true);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width / dpr, c.height / dpr);
    for (const s of strokes.current) drawStroke(ctx, s);
    if (current.current) drawStroke(ctx, current.current);
  }, []);

  // Size the bitmap to the CSS box × DPR; redraw so a rotate/resize keeps the ink.
  useEffect(() => {
    const wrap = wrapRef.current;
    const c = canvasRef.current;
    if (!wrap || !c) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      c.width = Math.round(w * dpr);
      c.height = Math.round(height * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${height}px`;
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [height, redraw]);

  const markInked = useCallback(() => {
    if (empty) {
      setEmpty(false);
      onChange?.(false);
    }
  }, [empty, onChange]);

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        strokes.current = [];
        current.current = null;
        redraw();
        setEmpty(true);
        onChange?.(true);
      },
      isEmpty() {
        return strokes.current.length === 0 || inkLength(strokes.current) < MIN_INK;
      },
      toDataUrl() {
        if (strokes.current.length === 0 || inkLength(strokes.current) < MIN_INK) return null;
        const pad = 10;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const s of strokes.current) {
          for (const p of s) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
        }
        const w = Math.max(1, Math.ceil(maxX - minX + pad * 2));
        const h = Math.max(1, Math.ceil(maxY - minY + pad * 2));
        const scale = 2;
        const out = document.createElement("canvas");
        out.width = w * scale;
        out.height = h * scale;
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.scale(scale, scale);
        ctx.translate(pad - minX, pad - minY);
        for (const s of strokes.current) drawStroke(ctx, s);
        return out.toDataURL("image/png");
      },
    }),
    [redraw, onChange],
  );

  const pointAt = (e: ReactPointerEvent<HTMLCanvasElement>, ev?: PointerEvent): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    const src = ev ?? e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  };

  function onDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    current.current = [pointAt(e)];
    redraw();
  }

  function onMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!current.current) return;
    e.preventDefault();
    // Coalesced events give every sample between frames — noticeably smoother
    // curves with a Pencil or a fast finger than one point per animation frame.
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const batch = native.getCoalescedEvents?.() ?? [];
    if (batch.length > 0) for (const ev of batch) current.current.push(pointAt(e, ev));
    else current.current.push(pointAt(e));
    redraw();
  }

  function onUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!current.current) return;
    e.preventDefault();
    strokes.current.push(current.current);
    current.current = null;
    redraw();
    markInked();
  }

  return (
    <div
      ref={wrapRef}
      className={`relative w-full select-none overflow-hidden rounded-lg border border-rule bg-card ${className}`}
      style={{ height, WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
    >
      {/* Baseline + the little × where a pen would start — paper-form cues. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-5 border-b border-dashed border-ink-4"
        style={{ top: Math.round(height * 0.72) }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-5 font-serif text-[18px] text-ink-4"
        style={{ top: Math.round(height * 0.72) - 24 }}
      >
        ×
      </div>
      {empty && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center font-serif text-[18px] italic text-ink-4"
        >
          {placeholder}
        </div>
      )}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Signature pad"
        className="absolute inset-0 block cursor-crosshair"
        style={{ touchAction: "none" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
});
