"use client";
/**
 * Field-app primitives (plan §6.1): 56 px targets, 12 px gaps, design tokens only,
 * icon + word for every state, focus kept inside open sheets, Escape closes.
 * No next/* imports: this file is also bundled into the offline capture shell.
 */
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Tone = "primary" | "secondary" | "quiet" | "danger" | "accent";
const TONES: Record<Tone, string> = {
  primary: "bg-accent text-card border-2 border-accent hover:bg-accent-2",
  accent: "bg-ink text-paper border-2 border-ink hover:bg-ink-hover",
  secondary: "bg-card text-ink border-2 border-rule hover:bg-paper-2",
  quiet: "bg-transparent text-ink-2 border-2 border-transparent hover:bg-hover hover:text-ink",
  danger: "bg-card text-flag border-2 border-flag hover:bg-flag-soft",
};

export function Btn({ tone = "secondary", wide, size = 56, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; wide?: boolean; size?: 56 | 64 | 48 }) {
  const h = size === 64 ? "min-h-16" : size === 48 ? "min-h-12" : "min-h-14";
  return (
    <button type="button" {...rest}
      className={`${h} ${wide ? "w-full" : ""} inline-flex items-center justify-center gap-2 rounded-md px-4 text-[1em] font-semibold leading-tight transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-45 ${TONES[tone]} ${className}`}>
      {children}
    </button>
  );
}

export function LinkBtn({ href, tone = "secondary", wide, className = "", children }: { href: string; tone?: Tone; wide?: boolean; className?: string; children: ReactNode }) {
  return (
    <a href={href} className={`min-h-14 ${wide ? "w-full" : ""} inline-flex items-center justify-center gap-2 rounded-md px-4 text-[1em] font-semibold leading-tight no-underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${TONES[tone]} ${className}`}>
      {children}
    </a>
  );
}

/** ⚠ action banner (--flag on flag-soft) or status banner (--info on info-soft); never colour alone. */
export function Banner({ kind, children, actions, role }: { kind: "action" | "status" | "ok"; children: ReactNode; actions?: ReactNode; role?: "alert" | "status" }) {
  const tone = kind === "action" ? "border-flag bg-flag-soft text-ink" : kind === "ok" ? "border-ok bg-ok-soft text-ink" : "border-info bg-info-soft text-ink";
  return (
    <div role={role ?? (kind === "action" ? "alert" : "status")} className={`rounded-lg border-2 px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-start gap-2">
        {kind === "action" && <span aria-hidden className="font-bold text-flag">⚠</span>}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {actions && <div className="mt-3 flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

/** Bottom sheet on phone, right sheet from 1024 px (`side`), centred card otherwise.
 *  `dock` keeps it a lower-half bottom sheet on tablet portrait too (the keypad: the field it
 *  fills stays visible above it, §6). */
export function Sheet({ open, onClose, title, children, footer, side = false, dock = false, labelledBy }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; side?: boolean; dock?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const opener = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>("button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex='-1'])")].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); (opener.current as HTMLElement | null)?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className={`fixed inset-0 z-50 flex items-end justify-center lg:items-stretch lg:justify-end ${dock ? "bg-ink/20" : "bg-ink/40 md:items-center"}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? id}
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl border-2 border-rule bg-card shadow-modal ${dock ? "md:max-h-[58dvh] md:border-x-0 md:border-b-0 lg:max-h-none lg:max-w-[560px] lg:rounded-xl lg:border-2" : "md:max-w-[560px] md:rounded-xl"} ${side ? "lg:h-full lg:max-h-none lg:max-w-[480px] lg:rounded-none lg:border-y-0 lg:border-r-0" : ""}`}>
        {/* r4 C1: on short screens (320×700) the docked keypad tightens its chrome so both fraction rows sit above Save. */}
        <div className={`flex items-center gap-3 border-b-2 border-rule-soft px-4 py-2 ${dock ? "[@media(max-height:700px)]:py-1" : ""}`}>
          <h2 id={labelledBy ?? id} className="min-w-0 flex-1 font-serif text-[1.15em] font-semibold text-ink">{title}</h2>
          <Btn tone="quiet" onClick={onClose} aria-label="Close" className="px-3">Close</Btn>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 ${dock ? "[@media(max-height:700px)]:py-3" : ""}`}>{children}</div>
        {footer && <div className={`flex flex-wrap justify-end gap-3 border-t-2 border-rule-soft px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${dock ? "[@media(max-height:700px)]:py-2 [@media(max-height:700px)]:pb-[max(0.5rem,env(safe-area-inset-bottom))]" : ""}`}>{footer}</div>}
      </div>
    </div>
  );
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`font-mono text-[0.72em] font-semibold uppercase tracking-[0.14em] text-ink-3 ${className}`}>{children}</p>;
}

/** Text field ≥16 px so iOS never zooms; labelled for VoiceOver. */
export function TextInput({ label, value, onChange, multiline, type = "text", inputMode, placeholder, id, autoFocus, maxLength, describedBy }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; type?: string; inputMode?: "text" | "decimal" | "numeric" | "tel"; placeholder?: string; id?: string; autoFocus?: boolean; maxLength?: number; describedBy?: string }) {
  const auto = useId(); const fid = id ?? auto;
  const cls = "mt-1 block w-full rounded-md border-2 border-rule bg-card px-3 py-3 text-[max(16px,1em)] text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none focus-visible:outline-3 focus-visible:outline-focus";
  return (
    <label htmlFor={fid} className="block">
      <span className="text-[0.95em] font-semibold text-ink">{label}</span>
      {multiline
        ? <textarea id={fid} value={value} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={placeholder} className={cls} data-autofocus={autoFocus || undefined} maxLength={maxLength ?? 8000} aria-describedby={describedBy} />
        : <input id={fid} type={type} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${cls} min-h-14`} data-autofocus={autoFocus || undefined} maxLength={maxLength} aria-describedby={describedBy} />}
    </label>
  );
}

/** Big segmented choice — never a dropdown when ≤6 options (§6.6). */
export function Choice<T extends string | boolean>({ label, options, value, onPick, labels, columns }: { label?: string; options: readonly T[]; value: T | undefined | null; onPick: (v: T) => void; labels?: (v: T) => string; columns?: number }) {
  const gid = useId();
  return (
    <div role="radiogroup" aria-labelledby={label ? gid : undefined} className="min-w-0">
      {label && <p id={gid} className="mb-1 text-[0.95em] font-semibold text-ink">{label}</p>}
      <div className={`grid gap-3 ${columns === 2 ? "grid-cols-2" : "grid-cols-[repeat(auto-fit,minmax(min(9.5em,100%),1fr))]"}`}>
        {options.map((o) => {
          const on = value === o;
          return (
            <button key={String(o)} type="button" role="radio" aria-checked={on} onClick={() => onPick(o)}
              className={`min-h-14 rounded-md border-2 px-3 py-2 text-left text-[1em] font-semibold leading-tight focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${on ? "border-accent bg-accent-soft text-ink" : "border-rule bg-card text-ink-2 hover:bg-paper-2"}`}>
              <span aria-hidden className="mr-1.5 font-mono">{on ? "●" : "○"}</span>{labels ? labels(o) : String(o)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: { release(): Promise<void> } | null = null;
    let idle: ReturnType<typeof setTimeout> | null = null;
    const acquire = async () => { try { lock = await (navigator as unknown as { wakeLock: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock.request("screen"); } catch { lock = null; } };
    const bump = () => { if (idle) clearTimeout(idle); if (!lock) void acquire(); idle = setTimeout(() => { void lock?.release(); lock = null; }, 20 * 60 * 1000); };
    bump();
    const events = ["pointerdown", "keydown"] as const;
    for (const e of events) document.addEventListener(e, bump);
    const vis = () => { if (document.visibilityState === "visible") bump(); };
    document.addEventListener("visibilitychange", vis);
    return () => { for (const e of events) document.removeEventListener(e, bump); document.removeEventListener("visibilitychange", vis); if (idle) clearTimeout(idle); void lock?.release(); };
  }, [active]);
}
