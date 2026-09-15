"use client";

// Site-wide toast popups. Mounted ONCE in app/layout.tsx via <ToastProvider>;
// anything client-side can raise one either through the useToast() hook or the
// plain `toast()` function (used by lib/run-action.ts, which has no component
// context). Toasts stack bottom-right, errors auto-dismiss after ~8s unless
// the message is long (> 200 chars), in which case they stay until closed so
// the owner can actually read what went wrong. Styling reuses the "flag" chip
// tokens (border-flag/40 bg-flag-soft text-flag) so it matches the rest of
// the app — no new dependencies.

import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type ToastKind = "error" | "success" | "info";

export interface ToastInput {
  /** Short line; defaults per kind ("Something went wrong" for errors). */
  title?: string;
  message: string;
  /** Raw detail (stack/API text) shown behind a "Details" disclosure. */
  details?: string;
  kind?: ToastKind;
  /** Override auto-dismiss: `true` = stays until closed; a number = ms. */
  sticky?: boolean | number;
}

export interface ToastItem extends Required<Pick<ToastInput, "message" | "kind">> {
  id: number;
  title: string;
  details?: string;
  /** ms until auto-dismiss; 0 = sticky. */
  ttl: number;
}

const ERROR_TTL_MS = 8_000;
const OTHER_TTL_MS = 5_000;
const STICKY_ABOVE_CHARS = 200;
const MAX_VISIBLE = 5;

const DEFAULT_TITLE: Record<ToastKind, string> = {
  error: "Something went wrong",
  success: "Done",
  info: "Heads up",
};

// ─── Module-level store (so toast() works outside React) ─────────────────────

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<() => void>();

function publish() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function snapshot() {
  return items;
}

const EMPTY: ToastItem[] = [];
function serverSnapshot() {
  return EMPTY;
}

/** Raise a toast from anywhere on the client. Returns the toast id. */
export function toast(input: ToastInput): number {
  const kind = input.kind ?? "info";
  const message = (input.message ?? "").trim() || DEFAULT_TITLE[kind];
  let ttl: number;
  if (input.sticky === true) ttl = 0;
  else if (typeof input.sticky === "number") ttl = input.sticky;
  else if (message.length > STICKY_ABOVE_CHARS || (input.details?.length ?? 0) > STICKY_ABOVE_CHARS) ttl = 0;
  else ttl = kind === "error" ? ERROR_TTL_MS : OTHER_TTL_MS;

  const item: ToastItem = {
    id: nextId++,
    kind,
    title: input.title?.trim() || DEFAULT_TITLE[kind],
    message,
    details: input.details?.trim() || undefined,
    ttl,
  };
  // Collapse an identical error already on screen (e.g. a double-click) into
  // one card rather than stacking duplicates.
  const dup = items.find((t) => t.kind === item.kind && t.message === item.message && t.title === item.title);
  if (dup) return dup.id;
  items = [...items, item].slice(-MAX_VISIBLE);
  publish();
  return item.id;
}

export function dismissToast(id: number): void {
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  publish();
}

/** Convenience for the common case. */
export function toastError(message: string, details?: string, title?: string): number {
  return toast({ kind: "error", message, details, title });
}

// ─── Provider + hook ─────────────────────────────────────────────────────────

interface ToastApi {
  toast: typeof toast;
  error: typeof toastError;
  dismiss: typeof dismissToast;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Access the toast API. Works without the provider too (falls back to the
 *  module store), so a component rendered outside the root layout — e.g. the
 *  global error page — can still raise one. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return useMemo<ToastApi>(() => ctx ?? { toast, error: toastError, dismiss: dismissToast }, [ctx]);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const api = useMemo<ToastApi>(() => ({ toast, error: toastError, dismiss: dismissToast }), []);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

// ─── Viewport ────────────────────────────────────────────────────────────────

const KIND_CLASSES: Record<ToastKind, string> = {
  error: "border-flag/40 bg-flag-soft text-flag",
  success: "border-money/40 bg-money-soft text-money",
  info: "border-accent/40 bg-accent-soft text-accent-2",
};

export function ToastViewport() {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (list.length === 0) return null;
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed bottom-[max(16px,env(safe-area-inset-bottom))] right-[max(16px,env(safe-area-inset-right))] z-[1000] flex w-[min(400px,calc(100vw-32px))] flex-col items-stretch gap-2"
    >
      {list.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const close = useCallback(() => dismissToast(item.id), [item.id]);

  useEffect(() => {
    if (item.ttl <= 0) return;
    const h = window.setTimeout(close, item.ttl);
    return () => window.clearTimeout(h);
  }, [item.ttl, close]);

  return (
    <div
      role={item.kind === "error" ? "alert" : "status"}
      className={[
        "pointer-events-auto rounded-md border px-3 py-2.5 shadow-pill",
        "flex items-start gap-2",
        KIND_CLASSES[item.kind],
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] opacity-80">{item.title}</div>
        <div className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-snug text-ink">{item.message}</div>
        {item.details && item.details !== item.message && (
          <details className="mt-1.5">
            <summary className="cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.08em] opacity-80">
              Details
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-current/20 bg-paper/60 px-2 py-1.5 font-mono text-[10.5px] leading-snug text-ink-2">
              {item.details}
            </pre>
          </details>
        )}
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="-mr-1 -mt-0.5 flex-none rounded p-1 opacity-70 hover:bg-paper/60 hover:opacity-100"
      >
        <X className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
