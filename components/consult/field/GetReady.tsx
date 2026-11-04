"use client";
/**
 * Get ready (plan §5.2): Checking · Ready offline ✓ · A check failed · No signal.
 * Uses the shared CoverageMark `ready` set (✓ Done · ○ Not yet · ! Problem). Each
 * problem names the check and its §5.7 reason. Ready offline only when the first five
 * pass. Microphone is Phase 2 (no audio in Phase 1) and is not listed.
 * Tablet: same card centered at 560 px.
 */
import { useState, type ReactNode } from "react";
import { CoverageMark } from "@/components/ui/CoverageMark";
import type { ReadyCheck, CheckResult } from "@/lib/consult/readiness";
import type { ReadyResult } from "@/lib/consult/ui/controller";
import { READY_LABEL, READY_ROWS, W, fill, plainWords, quantitiesLine, readyReason } from "@/lib/consult/ui/words";
import { Banner, Btn, LinkBtn, TextInput } from "./primitives";
import { completeCountsLine } from "@/lib/consult/completeness";

export function centralTime(iso: string | number | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit" }) {
  if (iso === null || iso === undefined) return "";
  const d = new Date(iso); if (!Number.isFinite(+d)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", ...opts }).format(d).replace(" AM", " am").replace(" PM", " pm");
}

/** `‹ Visits · title` head (§6.2). `right` is the ⋯ menu on screens without the status bar. */
export function ScreenHead({ title, back = "/consult/", right }: { title: string; back?: string | null; right?: ReactNode }) {
  return (
    <div className={`flex min-h-14 items-center gap-3 border-b-2 border-rule-soft ${right ? "pl-4 pr-1" : "px-4"}`}>
      {back && <a href={back} className="inline-flex min-h-14 items-center pr-2 font-semibold text-accent no-underline focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-focus">‹ {W.visits}</a>}
      <p className="min-w-0 flex-1 truncate text-right text-[0.95em] text-ink-2">{title}</p>
      {right}
    </div>
  );
}

/** A reason reads as its own sentence under the row: capital first, full stop last (r2 N9). */
const asSentence = (t: string) => { const x = t.trim(); return x ? `${x[0].toUpperCase()}${x.slice(1)}${/[.!?]$/.test(x) ? "" : "."}` : x; };

function Rows({ checks, result }: { checks: Partial<Record<ReadyCheck, CheckResult>>; result: ReadyResult }) {
  return (
    <ul className="mt-4 grid gap-1" aria-label="Checks">
      {READY_ROWS.map((key) => {
        const c = checks[key];
        const state = c?.state === "done" || (result === "ready") ? "done" : c?.state === "problem" ? "problem" : "not_yet";
        return (
          <li key={key} className="grid min-h-12 grid-cols-[auto_1fr] items-start gap-3 py-1.5">
            <CoverageMark variant="ready" state={state} />
            <span className={`min-w-0 ${state === "problem" ? "font-semibold text-flag" : "text-ink"}`}>
              {READY_LABEL[key]}{c?.state === "checking" && <span className="text-ink-3"> · checking…</span>}
              {state === "problem" && c?.reason && <span className="mt-0.5 block font-normal text-ink">{asSentence(readyReason(key, c.reason))}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * PIN for offline unlock: 6 to 12 digits, checked here before anything is sent, and the
 * same rule the device key uses. A refused PIN (`pin_invalid`) shows the same inline
 * "! Use 6 to 12 digits." under the field; the field stays so it can be corrected.
 */
function PinChoice({ enrolled, onGo, busy, refused }: { enrolled: boolean; onGo: (pin: string) => void; busy: boolean; refused?: boolean }) {
  const [pin, setPin] = useState(""); const [again, setAgain] = useState(""); const [err, setErr] = useState<string | null>(refused ? W.pinShort : null);
  const go = () => {
    if (!/^\d{6,12}$/.test(pin)) { setErr(W.pinShort); return; }
    if (!enrolled && pin !== again) { setErr(W.pinMismatch); return; }
    setErr(null); onGo(pin);
  };
  const short = err === W.pinShort;
  return (
    <form className="mt-5 grid gap-3" onSubmit={(e) => { e.preventDefault(); go(); }} noValidate>
      <TextInput label={enrolled ? W.pinEnter : W.pinChoose} value={pin} onChange={(v) => { setPin(v.replace(/\D/g, "").slice(0, 12)); if (short) setErr(null); }} type="password" inputMode="numeric" describedBy={short ? "pin-help pin-err" : "pin-help"} />
      <p id="pin-help" className="-mt-1 text-[0.9em] text-ink-2">{W.pinChooseHelp}</p>
      {short && <p id="pin-err" role="alert" className="-mt-1 font-semibold text-flag">! {W.pinShort}</p>}
      {!enrolled && <TextInput label={W.pinConfirm} value={again} onChange={(v) => { setAgain(v.replace(/\D/g, "").slice(0, 12)); if (err === W.pinMismatch) setErr(null); }} type="password" inputMode="numeric" describedBy={err === W.pinMismatch ? "pin-mismatch" : undefined} />}
      {err && !short && <p id="pin-mismatch" role="alert" className="-mt-1 font-semibold text-flag">! {err}</p>}
      <Btn tone="primary" wide type="submit" disabled={busy}>{W.getReady}</Btn>
    </form>
  );
}

export function GetReadyCard({ title, result, checks, enrolled, expires, code, readyCode, userName, onGetReady, onStart, started, busy, more }: {
  title: string; result: ReadyResult; checks: Partial<Record<ReadyCheck, CheckResult>>; enrolled: boolean; expires: number | null; code?: string | null; readyCode?: string | null; userName: string;
  onGetReady: (pin: string) => void; onStart?: () => void; started?: boolean; busy?: boolean; more?: ReactNode;
}) {
  const [pin, setPin] = useState<string | null>(null);
  const run = (p: string) => { setPin(p); onGetReady(p); };
  const signinCode = (c?: string | null) => !!c && /^(signed_out|lease_.*|unauthorized)$/.test(c);
  const signedOut = code === "signed_out" || signinCode(checks.visit_details?.reason) || signinCode(checks.offline_lease?.reason);
  // A refused PIN never ran a check: stay on the PIN step with the inline line, checks "Not yet".
  const pinRefused = result === "not_ready" && (readyCode === "pin_invalid" || checks.offline_lease?.reason === "pin_invalid");
  // Device-key step failed for a reason other than sign-in: a new PIN is the way forward, not the same one again.
  const otherDevice = code === "device_access_denied" || readyCode === "device_access_denied" || Object.values(checks).some((c) => c?.reason === "device_access_denied");
  const leaseFailed = !!checks.offline_lease?.reason && !signinCode(checks.offline_lease.reason) && checks.offline_lease.reason !== "device_access_denied";
  return (
    <div className="mx-auto w-full max-w-[560px]">
      <ScreenHead title={title} right={more} />
      <section className="px-4 pb-8 pt-4" aria-live="polite">
        {pinRefused && <>
          <h1 className="font-serif text-[1.6em] font-semibold text-ink">{W.getReady}</h1>
          <p className="mt-1 text-ink-2">Do this with signal — at the office, in the truck or in the driveway.</p>
          <Rows checks={{}} result="idle" />
          <PinChoice key="refused" enrolled={enrolled} onGo={run} busy={!!busy} refused />
        </>}
        {result === "idle" && <>
          <h1 className="font-serif text-[1.6em] font-semibold text-ink">{W.getReady}</h1>
          <p className="mt-1 text-ink-2">Do this with signal — at the office, in the truck or in the driveway.</p>
          <Rows checks={{}} result="idle" />
          <PinChoice enrolled={enrolled} onGo={run} busy={!!busy} />
        </>}
        {result === "checking" && <>
          <h1 className="font-serif text-[1.6em] font-semibold text-ink">{W.gettingReady}</h1>
          <Rows checks={checks} result={result} />
          <p className="mt-3 text-ink-2">{W.keepOpen}</p>
        </>}
        {result === "ready" && <>
          <h1 className="font-serif text-[1.6em] font-semibold text-accent-2">{W.readyOffline}</h1>
          {expires && <p className="mt-1 font-semibold text-ink">{fill(W.worksUntil, { time: centralTime(expires) })}</p>}
          <Rows checks={checks} result={result} />
          <p className="mt-3 text-ink-2">{W.installHint}<br />{W.keepDevice}</p>
          {onStart && <div className="mt-5"><Btn tone="primary" wide onClick={onStart} disabled={busy}>{started ? W.openVisit : W.startVisit}</Btn></div>}
        </>}
        {result === "not_ready" && !pinRefused && <>
          <h1 className="font-serif text-[1.6em] font-semibold text-flag">{W.notReady}</h1>
          <Rows checks={checks} result={result} />
          <p className="mt-3 text-ink">{W.usePaper}</p>
          <div className="mt-5 grid gap-3">
            {signedOut
              ? <LinkBtn tone="primary" wide href={`/login?next=${encodeURIComponent(typeof location === "undefined" ? "/consult/" : location.pathname)}`}>{W.signIn}</LinkBtn>
              : otherDevice ? <>
                {/* Trying again here can't succeed until Joe moves the visit: going back is the action. */}
                <LinkBtn tone="primary" wide href="/consult/">{W.backToVisits}</LinkBtn>
                {pin && <Btn tone="quiet" wide onClick={() => onGetReady(pin)}>{W.tryAgain}</Btn>}
              </>
              : pin && !leaseFailed ? <Btn tone="primary" wide onClick={() => onGetReady(pin)}>{W.tryAgain}</Btn> : <PinChoice enrolled={enrolled} onGo={run} busy={!!busy} />}
          </div>
        </>}
        {result === "no_signal" && <>
          <h1 className="font-serif text-[1.6em] font-semibold text-ink">{W.noSignal}</h1>
          <p className="mt-2 text-[1.05em] font-semibold text-ink">{W.openOnce}</p>
          <p className="text-ink">{W.notPreparedYet}</p>
          <p className="mt-3 text-ink">{W.usePaper}</p>
          <div className="mt-5"><Btn tone="primary" wide onClick={() => (pin ? onGetReady(pin) : location.reload())}>{W.tryAgain}</Btn></div>
        </>}
        {code && result !== "not_ready" && code !== "signed_out" && code !== "pin_invalid" && <p role="alert" className="mt-4 font-semibold text-flag">! {plainWords(code, { name: userName })}</p>}
      </section>
    </div>
  );
}

/** r12 R12-3: Reopen from the opened Complete screen — the office's current revision, then the same
 *  `reopen` command the look-over sends. The page reloads into the reopened visit. */
async function reopenVisit(id: string, reason: string) {
  const g = await fetch(`/api/consult/${id}`, { credentials: "same-origin", cache: "no-store" });
  if (g.status === 401) throw new Error("signed_out");
  if (!g.ok) throw new Error("no_signal");
  const snap = (await g.json()) as { consult?: { revision?: number | string } };
  const r = await fetch(`/api/consult/${id}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Consult-CSRF": "1" }, body: JSON.stringify({ command: "reopen", input: { expected_revision: Number(snap.consult?.revision), reason } }) });
  const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error_code?: string; code?: string };
  if (!r.ok || body.ok === false) throw new Error(body.error_code ?? body.code ?? "invalid_command");
}

/** r7 R7-1: a Complete visit opened on a device — finished, locked, calm. No Get ready, PIN or paper line.
 *  r12 R12-3: the same role check as the visitor's own close result — a staff visitor is told Joe reopens it
 *  from the office look-over; Joe is told "Answers are locked." and offered Reopen, as on his own close. */
export function CompleteCard({ title, closedAt, completeness, unmeasured = 0, lookOver, more, staff = false, consultId }: { title: string; closedAt?: string | null; completeness?: unknown; unmeasured?: number; lookOver: string; more?: ReactNode; staff?: boolean; consultId?: string }) {
  const c = completeness as { price_critical?: { total: number; done: number; skipped?: number }; record?: { total: number; done: number; skipped?: number } } | null | undefined;
  const when = centralTime(closedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const [reopening, setReopening] = useState(false); const [reason, setReason] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const canReopen = !staff && !!consultId;
  return (
    <div className="mx-auto w-full max-w-[560px]">
      <ScreenHead title={title} right={more} />
      <section className="px-4 pb-8 pt-4" aria-live="polite">
        <h1 className="font-serif text-[1.8em] font-semibold text-accent-2">✓ {W.complete}{when ? <> · <span className="whitespace-nowrap">{when}</span></> : null}</h1>
        {unmeasured > 0 && <p className="mt-1 font-semibold text-ink">{quantitiesLine(unmeasured)}</p>}
        {c?.price_critical && c.record && <p className="mt-2 font-mono text-ink">{completeCountsLine({ price_critical: c.price_critical, record: c.record })}</p>}
        <p className="mt-3 text-ink">{staff ? W.completeLocked : W.answersLocked}</p>
        <div className="mt-5 grid gap-3">
          <LinkBtn tone="primary" wide href={lookOver}>{W.lookOver}</LinkBtn>
          {canReopen && !reopening && <Btn wide onClick={() => setReopening(true)}>{W.reopen}</Btn>}
          <LinkBtn wide href="/consult/">{W.backToVisits}</LinkBtn>
        </div>
        {canReopen && reopening && (
          <form className="mt-4 grid gap-3" onSubmit={async (e) => { e.preventDefault(); setErr(null); setBusy(true); try { await reopenVisit(consultId!, reason.trim()); location.reload(); } catch (x) { setErr(plainWords(x instanceof Error ? x.message : "")); setBusy(false); } }}>
            <TextInput label={W.reopenReason} value={reason} onChange={setReason} multiline autoFocus />
            {err && <Banner kind="action">{err}</Banner>}
            <div className="flex gap-3"><Btn onClick={() => setReopening(false)}>{W.cancel}</Btn><Btn tone="primary" type="submit" disabled={!reason.trim() || busy}>{W.reopen}</Btn></div>
          </form>
        )}
      </section>
    </div>
  );
}

export function UnlockCard({ title, onUnlock, busy, code, expires, olderBuild, more }: { title: string; onUnlock: (pin: string) => void; busy: boolean; code: string | null; expires: number | null; olderBuild: boolean; more?: ReactNode }) {
  const [pin, setPin] = useState("");
  return (
    <div className="mx-auto w-full max-w-[560px]">
      <ScreenHead title={title} right={more} />
      <form className="grid gap-3 px-4 pb-8 pt-4" onSubmit={(e) => { e.preventDefault(); if (/^\d{6,12}$/.test(pin)) onUnlock(pin); }}>
        <h1 className="font-serif text-[1.6em] font-semibold text-ink">{W.app}</h1>
        <p className="text-ink">{W.unlockLead}</p>
        {expires && <p className="text-ink-2">{fill(W.worksUntil, { time: centralTime(expires) })}</p>}
        {olderBuild && <div role="status" className="rounded-lg border-2 border-info bg-info-soft px-4 py-3 text-ink">Update ready — reload between rooms. This visit keeps working on this device until its answers are sent.</div>}
        <TextInput label={W.pinEnter} value={pin} onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 12))} type="password" inputMode="numeric" autoFocus />
        {code && <p role="alert" className="font-semibold text-flag">! {plainWords(code)}</p>}
        <Btn tone="primary" wide type="submit" disabled={busy || !/^\d{6,12}$/.test(pin)}>{busy ? "Opening…" : W.openVisit}</Btn>
      </form>
    </div>
  );
}
