"use client";
/**
 * Client view (plan §6.3, §6.4): rendered INSTEAD of the visitor screens, from an
 * allowlisted summary only (no status bar, sync, progress, prices, flags, menus or
 * internal notes are mounted). 20 px body, 56 px controls. Initials acknowledge what
 * was discussed — never a contract or a price. Hand back needs a 2-second hold with
 * progress and cancel-on-release, or the visitor PIN. Browser Back stays here.
 */
import { useEffect, useRef, useState } from "react";
import { SignaturePad, type SignaturePadHandle } from "@/components/esign/SignaturePad";
import { clientSummary, handBackAllowed, type ClientSummary } from "@/lib/consult/client-summary";
import { W, fill } from "@/lib/consult/ui/words";
import { Btn, TextInput } from "./primitives";

const clock = () => performance.now();
function dataUrlToBlob(url: string): Blob {
  const [head, data] = url.split(","); const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
  const bin = atob(data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function ClientView({ summary, pamphlet = false, hasInitials, onInitials, onHandBack, verifyPin }: {
  summary: ClientSummary; pamphlet?: boolean; hasInitials: boolean; onInitials: (png: Blob) => Promise<void>; onHandBack: () => void; verifyPin: (pin: string) => Promise<boolean>;
}) {
  const s = clientSummary(summary); // allowlist: nothing else reaches this view
  const pad = useRef<SignaturePadHandle>(null);
  const [empty, setEmpty] = useState(true);
  const [saved, setSaved] = useState(hasInitials);
  const [saving, setSaving] = useState(false);
  const [held, setHeld] = useState(0);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState(""); const [pinErr, setPinErr] = useState(false);
  const start = useRef<number | null>(null); const raf = useRef<number | null>(null);

  // Back trap: the client can't navigate into visitor screens.
  useEffect(() => {
    history.pushState({ consultClient: true }, "");
    const pop = () => history.pushState({ consultClient: true }, "");
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  const tick = () => {
    if (start.current === null) return;
    const ms = clock() - start.current; setHeld(ms);
    if (handBackAllowed(ms, false)) { start.current = null; setHeld(0); onHandBack(); return; }
    raf.current = requestAnimationFrame(tick);
  };
  const begin = () => { if (start.current !== null) return; start.current = clock(); raf.current = requestAnimationFrame(tick); };
  const cancel = () => { start.current = null; if (raf.current) cancelAnimationFrame(raf.current); setHeld(0); };
  useEffect(() => () => { start.current = null; if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const ack = async () => {
    const url = pad.current?.toDataUrl(); if (!url) return;
    setSaving(true);
    try { await onInitials(dataUrlToBlob(url)); setSaved(true); } finally { setSaving(false); }
  };
  const pct = Math.min(100, Math.round((held / 2000) * 100));

  return (
    <main className="consult-client min-h-dvh bg-paper text-[20px] text-ink" aria-label={W.whatWeWentOver}>
      <div className="mx-auto grid max-w-[1180px] gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-10 lg:py-10">
        <section className="min-w-0">
          <h1 className="font-serif text-[1.5em] font-semibold leading-tight text-ink">{pamphlet ? "Renovate Right receipt" : W.whatWeWentOver}</h1>
          <p className="mt-1 text-ink-2">{s.client_name}{s.visit_date ? ` · ${s.visit_date}` : ""}</p>
          {pamphlet ? <p className="mt-5">I received the Renovate Right pamphlet about lead-safe renovation work.</p> : <>
          <ul className="mt-5 grid gap-4">
            {s.rooms.map((r, i) => (
              <li key={i}>
                <p className="font-mono text-[0.7em] font-semibold uppercase tracking-[0.14em] text-accent">{r.name}</p>
                <p>{r.work.length ? r.work.join(" · ") : "Measured and looked over"}</p>
              </li>
            ))}
          </ul>
          {s.still_to_decide.length > 0 && <div className="mt-5"><p className="font-mono text-[0.7em] font-semibold uppercase tracking-[0.14em] text-accent">{W.stillToDecide}</p><p>{s.still_to_decide.join(" · ")}</p></div>}
          {s.open_questions.length > 0 && <div className="mt-5"><p className="font-mono text-[0.7em] font-semibold uppercase tracking-[0.14em] text-accent">{W.openQuestions}</p><ul className="list-disc pl-6">{s.open_questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}
          <div className="mt-5"><p className="font-mono text-[0.7em] font-semibold uppercase tracking-[0.14em] text-accent">{W.nextStep}</p><p>{s.formal_estimate_date ? fill(W.nextFormal, { date: s.formal_estimate_date }) : "formal estimate"}</p></div>
          <p className="mt-5 text-[0.85em] text-ink-2">This is what we talked about today. It is not a contract or a price.</p></>}
        </section>
        <section className="grid content-start gap-4">
          {saved ? <p role="status" className="rounded-lg border-2 border-ok bg-ok-soft px-4 py-3 font-semibold">✓ {W.initialsSaved.replace(" ✓", "")}</p> : <>
            <p className="font-semibold">{W.initials}</p>
            <SignaturePad ref={pad} height={180} placeholder={W.initials} onChange={setEmpty} />
            <div className="flex gap-3"><Btn onClick={() => { pad.current?.clear(); setEmpty(true); }} disabled={empty}>{W.clearInitials}</Btn></div>
            <Btn tone="primary" wide onClick={() => void ack()} disabled={empty || saving}>{W.thisIsWhat}</Btn>
          </>}
          <div className="mt-2 grid gap-3">
            <button type="button" aria-describedby="hold-help"
              onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); begin(); }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
              onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); begin(); } }} onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") cancel(); }}
              onContextMenu={(e) => e.preventDefault()}
              className="relative min-h-14 w-full touch-none select-none overflow-hidden rounded-md border-2 border-ink bg-card px-4 font-semibold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus">
              <span aria-hidden className="absolute inset-y-0 left-0 bg-accent-soft" style={{ width: `${pct}%` }} />
              <span className="relative">{W.handBackHold}</span>
            </button>
            <span id="hold-help" className="sr-only">Press and hold for two seconds. Letting go cancels.</span>
            <div role="progressbar" aria-label="Hand back hold" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="sr-only" />
            {!pinMode ? <Btn wide onClick={() => setPinMode(true)}>{W.usePin}</Btn> : (
              <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); const ok = await verifyPin(pin); setPinErr(!ok); if (ok && handBackAllowed(0, true)) onHandBack(); }}>
                <TextInput label={W.handBackPin} value={pin} onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 8))} type="password" inputMode="numeric" autoFocus />
                {pinErr && <p role="alert" className="font-semibold text-flag">! That PIN doesn&apos;t match.</p>}
                <Btn tone="accent" wide type="submit" disabled={!/^\d{4,8}$/.test(pin)}>{W.handBackHold.split(" — ")[0]}</Btn>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
