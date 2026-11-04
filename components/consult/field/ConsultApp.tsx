"use client";

import {clientRecapText} from '@/lib/consult/client-summary';
/**
 * Field app root for /consult/[id] (online, server-rendered boot) and the offline
 * shell (/consult/offline.html → capture.js, boot = null). One controller per visit.
 * Status bar (§6.2): one 56 px row, no wrapping; dot/mark always followed by a word;
 * ⋯ holds Sun mode and Back to SJC OS on every width. Phase 1 has no recording, so
 * the capture state always reads "○ Notes off" and there is no notes/AI control.
 */
import {sendHealth,sendDeadlines,type SendHealth} from "@/lib/consult/ui/send-health";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { VisitController, type Boot } from "@/lib/consult/ui/controller";
import { buildEvidence, refusedEntries, summaryInput, unsentCount } from "@/lib/consult/ui/model";
import { W, closeRefusalPlace, fill, plainWords } from "@/lib/consult/ui/words";
import { Banner, Btn, LinkBtn, Sheet, useWakeLock } from "./primitives";
import { CompleteCard, GetReadyCard, UnlockCard, ScreenHead, centralTime } from "./GetReady";
import { MoreMenu, useSun } from "./MoreMenu";
import { VisitScreen } from "./VisitScreen";
import { ClosingScreen } from "./WrapClose";
import { ClientView } from "./ClientView";

const nowIso = () => new Date().toISOString();
const clock = (t: number) => centralTime(t, { hour: "numeric", minute: "2-digit" });
/** No signal is already said by the offline strip; every other failed send is shown in words. */
const sendFailed = (f: { code: string; at: number } | null | undefined) => !!f && !/^(no_signal|network|send_in_progress)$/.test(f.code);
/** Weak or unknown connection (iOS reports none): only then is "answers and photos first" true to say. */
function weakLink(): boolean {
  const c = (typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection);
  if (!c?.effectiveType) return true;
  return !!c.saveData || /2g|3g/.test(c.effectiveType);
}
/** Re-renders once `at + ms` has passed, so a banner can wait a minute before it shows. */
function useAfter(at: number | null | undefined, ms: number): boolean {
  const [, bump] = useState(0);
  const due = at ? at + ms - Date.now() : null;
  useEffect(() => { if (due === null || due <= 0) return; const t = setTimeout(() => bump((n) => n + 1), due + 50); return () => clearTimeout(t); }, [due]);
  return due !== null && due <= 0;
}

/** Two minutes online with answers waiting and nothing sent is a failure in itself (r2 N6): the
 *  screen must not depend on a send reporting an error. Returns when "stuck" began, or null. */
function useStuckSince(online:boolean,unsent:number,lastSend:number|null,failed:boolean) {
 const [health,setHealth]=useState<SendHealth>({waitingFrom:null,failureFrom:null,lastSend});
 useEffect(()=>setHealth(h=>sendHealth(h,online,unsent,lastSend,failed,Date.now())),[online,unsent,lastSend,failed]);
 useAfter(health.waitingFrom,120_000);useAfter(health.failureFrom,60_000);
 return sendDeadlines(health,Date.now());
}

/** §6.2 status bar: one 56 px row. Focus rings sit inside the row (offset −3 px) so none is clipped. */
function StatusBar({ unsent, photos, answers, online, lastSend, failure, onSend, sending, onExit, wide }: { unsent: number; photos: number; answers: number; online: boolean; lastSend: number | null; failure: { code: string; at: number } | null; onSend: () => void; sending: boolean; onExit: () => void; wide?: boolean }) {
  const [sheet, setSheet] = useState(false);
  // Send now always says what happened: "Sending…", then Last sent or "Nothing went out".
  const [tried, setTried] = useState<{ at: number; lastSend: number | null } | null>(null);
  const failed = !!failure;
  const stuck = failed && online && failure!.code !== "no_signal";
  // r4 R4-10: "sending…" only while something is waiting — a check with nothing queued says nothing.
  const busy = sending && unsent > 0;
  const outcome = !tried || busy ? null : (lastSend ?? 0) > (tried.lastSend ?? 0) ? "sent" : unsent === 0 ? "sent" : "not_sent";
  const send = () => { setTried({ at: Date.now(), lastSend }); onSend(); };
  return (
    <header className="sticky top-0 z-40 border-b-2 border-rule bg-paper-2">
      <div className="flex min-h-14 items-center gap-2 pl-2 pr-1">
        <button type="button" onClick={() => setSheet(true)} aria-label={`${W.notesOff}. ${unsent} waiting to send. ${online ? W.online : W.offlineLine}.${failed ? ` ${W.lastTry}: ${plainWords(failure!.code)}` : ""} Open send details.`}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left font-semibold text-ink hover:bg-hover focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-focus">
          <span aria-hidden className="font-mono">○</span>
          <span className="min-w-0 truncate">{W.notesOff} · <span className="font-mono">⇅ {unsent}</span>{stuck ? <span className="text-flag"> · <span aria-hidden>⚠ </span>{W.notSent}</span> : <span className={wide ? "" : "max-md:hidden"}>{online ? ` · ${W.online}` : ""}</span>}{busy ? <span className="text-ink-3"> · {W.sendingNow}</span> : null}</span>
        </button>
        <MoreMenu onExit={onExit} />
      </div>
      {!online && <p role="status" className="border-t-2 border-info bg-info-soft px-4 py-1.5 text-[0.95em] font-semibold text-ink"><span aria-hidden>⇣ </span>{W.offlineLine}</p>}
      <Sheet open={sheet} onClose={() => { setSheet(false); setTried(null); }} title={W.sending} footer={<Btn tone="primary" onClick={send} disabled={sending || unsent === 0}>{busy ? `${W.sendingWord}…` : failed ? W.tryAgain : W.sendNow}</Btn>}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-ink">
          <dt className="text-ink-2">{W.notes}</dt><dd>{W.notesOff}</dd>
          <dt className="text-ink-2">{W.answersWaiting}</dt><dd className="font-mono">{answers}</dd>
          <dt className="text-ink-2">{W.photosWaiting}</dt><dd className="font-mono">{photos}</dd>
          {/* r5: Last sent holds the time; "All sent ✓" is the status line under the list. */}
          <dt className="text-ink-2">{W.lastSent}</dt><dd>{lastSend ? clock(lastSend) : W.notYet}</dd>
          {failed && <><dt className="text-ink-2">{W.lastTry}</dt><dd className="text-ink"><span aria-hidden className="font-bold text-flag">⚠ </span>{clock(failure!.at)} · {plainWords(failure!.code)}{!/^(send_stuck|no_signal)$/.test(failure!.code) && <span className="block font-mono text-[0.8em] text-ink-3">{W.codeForJoe} {failure!.code}</span>}</dd></>}
          <dt className="text-ink-2">{W.signal}</dt><dd>{online ? W.online : W.noSignal}</dd>
        </dl>
        <p role="status" aria-live="polite" className="mt-3 min-h-[1.5em] font-semibold text-ink">
          {/* r6 extra: never "All sent ✓" when nothing has ever been sent. */}
          {busy ? `${W.sendingWord}…` : unsent === 0 ? (lastSend ? W.allSent : W.nothingWaiting) : outcome === "sent" && lastSend ? `✓ ${W.lastSent} ${clock(lastSend)} · ⇅ ${unsent} ${W.stillWaiting}` : outcome === "not_sent" ? <><span aria-hidden className="text-flag">⚠ </span>{W.nothingWentOut}</> : ""}
        </p>
        {!online && <p className="mt-3 text-ink">{W.offlineStrip}</p>}
        {online && busy && weakLink() && <p className="mt-3 text-ink-2">{W.weakSignal}</p>}
      </Sheet>
    </header>
  );
}

export function ConsultApp({ boot, consultId }: { boot: Boot | null; consultId: string }) {
  const ctl = useMemo(() => new VisitController(boot, consultId), [boot, consultId]);
  const st = useSyncExternalStore(ctl.subscribe, ctl.getState, ctl.getState);
  const [sun] = useSun();
  const [client, setClient] = useState<{instance:string;field:string} | null>(null);
  const [resume, setResume] = useState<string | null>(null);
  /** r5: the close result's row button (Review flags, Pick the date, …), run once back on the visit. */
  const [after, setAfter] = useState<string | null>(null);
  const [exit, setExit] = useState(false);
  const [wide, setWide] = useState(false);
  useEffect(() => { void ctl.init(); return () => ctl.dispose(); }, [ctl]);
  useEffect(() => { const q = matchMedia("(min-width: 1024px)"); const f = () => setWide(q.matches); f(); q.addEventListener("change", f); return () => q.removeEventListener("change", f); }, []);
  useWakeLock(st.phase === "visit");

  const snap = st.local ? ctl.snapshot() : null;
  const display = snap?.display ?? boot?.display;
  const model = useMemo(() => (st.local ? ctl.model() : null), [ctl, st.local, st.fresh, st.draft, st.freshSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  const entries = st.local?.queue.entries ?? [];
  const unsentOps = unsentCount(entries);
  const unsentPhotos = st.local?.blobs.filter((b) => !b.receipt).length ?? 0;
  const unsent = unsentOps + unsentPhotos;
  const {stuckAt,banner} = useStuckSince(st.online && st.phase === "visit", unsent, st.local?.last_send ?? null, sendFailed(st.lastSendFailure));
  // A reported failure wins; otherwise a silent stall online is shown as "Nothing went out".
  const failure = sendFailed(st.lastSendFailure) ? st.lastSendFailure : stuckAt !== null && !st.sending ? { code: "send_stuck", at: stuckAt } : st.lastSendFailure?.code === "send_in_progress" ? null : st.lastSendFailure;
  const failureDue = banner;
  const userName = boot?.user.name ?? display?.visitor_name ?? "yourself";
  const home = boot?.home ?? (display?.slug ? `/projects/${display.slug}` : "/");
  // One time format everywhere: the label is always made by centralTime from the stored visit time.
  const when = snap?.consult.scheduled_at ? centralTime(snap.consult.scheduled_at) : display?.scheduled_label ?? "";
  const title = display ? `${display.client}${when ? ` · ${when}` : ""}` : W.app;
  const leave = () => { if (unsent > 0) setExit(true); else location.href = home; };
  const more = <MoreMenu exitHref={home} />;
  const signInHref = `/login?next=${encodeURIComponent(`/consult/${consultId}`)}`;
  // r11 extra: only Joe applies findings; anyone else on the device is told so instead of a button.
  const staffUser = (boot?.user.role ?? (display?.visitor_staff ? "staff" : "owner")) !== "owner";

  let body: React.ReactNode = null;
  if (st.phase === "loading") body = <div className="mx-auto max-w-[560px]"><ScreenHead title={title} right={more} /><p className="px-4 py-6 text-ink-2" role="status">Opening…</p></div>;
  else if (st.phase === "complete") body = <CompleteCard staff={staffUser} consultId={consultId} title={title} closedAt={boot?.closed_at} completeness={boot?.completeness} unmeasured={boot?.unmeasured} lookOver={`${home}/consult/${consultId}`} more={more} />;
  else if (st.phase === "disabled") body = <div className="mx-auto max-w-[560px]"><ScreenHead title={title} right={more} /><div className="px-4 py-6"><Banner kind="action">{plainWords("capture_disabled")}</Banner><div className="mt-4"><LinkBtn wide href={home}>{W.back}</LinkBtn></div></div></div>;
  else if (st.phase === "get_ready") body = <GetReadyCard title={title} result={st.ready.result} checks={st.ready.checks} enrolled={st.enrolled} expires={st.leaseExpires} code={st.code} readyCode={st.ready.code} userName={userName} onGetReady={(pin) => void ctl.getReady(pin)} more={more} />;
  else if (st.phase === "unlock") body = <UnlockCard title={title} onUnlock={(pin) => void ctl.unlock(pin)} busy={st.busy} code={st.code} expires={st.leaseExpires} olderBuild={st.olderBuild} more={more} />;
  else if (st.phase === "blocked") {
    // Another device holds this visit: its own words (§5.7), never "access removed" or "sign in".
    const code = st.code === "device_access_denied" || st.lastSendFailure?.code === "device_access_denied" ? "device_access_denied" : st.blocked ?? st.code ?? "signed_out";
    body = (
      <div className="mx-auto max-w-[560px]"><ScreenHead title={title} right={more} />
        <div className="grid gap-4 px-4 py-6">
          <Banner kind="action">{plainWords(code, { name: userName })}</Banner>
          {code === "signed_out" && <LinkBtn tone="primary" wide href={signInHref}>{W.signIn}</LinkBtn>}
          {code === "update_required" && <Btn tone="primary" wide onClick={() => location.reload()}>{W.reload}</Btn>}
          <LinkBtn wide href={home}>{W.back}</LinkBtn>
        </div>
      </div>
    );
  } else if (st.phase === "visit" && model && st.local) {
    const closingSection = model.sections.find((s) => s.module.key === "closing");
    const initials = st.local.blobs.find((b) => b.kind === "initials" && b.instance_id===closingSection?.instance.id && b.field_key==="client_initials");
    const status = (st.fresh ?? snap)?.consult.status ?? "scheduled";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
    const visitDay = snap ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(snap.consult.scheduled_at)) : today;
    if (client) {
      const formal = model.promised ? centralTime(`${model.promised}T12:00:00-06:00`, { weekday: "short", month: "short", day: "numeric" }) : "";
      return <div className="consult-root consult-fixed overflow-y-auto" data-scroll data-sun={sun ? "1" : undefined}><ClientView summary={summaryInput(model, display, centralTime(snap?.consult.scheduled_at ?? nowIso(), { month: "short", day: "numeric" }), formal)} pamphlet={client.field === "pamphlet_initials"} hasInitials={st.local.blobs.some(b=>b.kind==="initials"&&b.instance_id===client.instance&&b.field_key===client.field)}
        onInitials={async (png, summaryText) => { await ctl.photo(png, { instance_id: client.instance, field_key: client.field, kind: "initials" }, W.initials, summaryText); }}
        verifyPin={(pin) => ctl.verifyPin(pin)}
        onHandBack={(text) => { if(client.field==="client_initials") ctl.shownSummary=text; setClient(null); setResume(client.instance); }} /></div>;
    }
    const setupMissing = model.started && !st.local.close_intent && !st.local.queue.blocked && !["complete", "needs_finishing", "cancelled"].includes(model.status) && model.slots.some((s) => s.required && !s.parent && s.live < s.minimum);
    const banners = (
      <div className="grid gap-3 px-4 pt-3 empty:hidden">
        {st.storageFull && <Banner kind="action">{fill(W.storageFull, { field: st.lastSaved ?? "—" })}</Banner>}
        {(st.olderBuild || st.blocked === "update_required") && <Banner kind="status" actions={<Btn onClick={() => location.reload()}>{W.reload}</Btn>}>Update ready — reload between rooms.</Banner>}
        {st.code === "signed_out" && <Banner kind="action" actions={<LinkBtn href={signInHref}>{W.signIn}</LinkBtn>}>{plainWords("signed_out", { name: userName })}</Banner>}
        {/* A close made without signal is kept (close_intent) and resumes by itself; keep working never cancels it. */}
        {!st.closing && st.local.close_intent && <Banner kind="status" actions={st.online ? <Btn onClick={() => void ctl.drain(true)}>{W.sendNow}</Btn> : undefined}>{W.closeWaiting}</Banner>}
        {/* r4: required sections are set up on start and on every load (an interrupted start finishes here). */}
        {st.busy && <Banner kind="status">{W.settingUp}</Banner>}
        {!st.busy && setupMissing && <Banner kind="status" actions={<Btn tone="primary" onClick={() => void ctl.ensureRequiredInstances().catch(() => undefined)}>{st.code ? W.tryAgain : W.setupAgain}</Btn>}>{W.setupNotDone}{st.code ? ` ${plainWords(st.code, { name: userName })}` : ""}</Banner>}
        {/* r7 R7-2: while closing, the close screen alone says how the send is going. */}
        {!st.closing && failureDue && st.code !== "signed_out" && st.online && !st.sending && failure && unsent > 0 && <Banner kind="action" actions={<Btn tone="primary" onClick={() => void ctl.drain(true)}>{W.tryAgain}</Btn>}>{fill(W.notSentSince, { time: clock(st.local.last_send ?? failure.at) })} {plainWords(failure.code, { name: userName })}</Banner>}
      </div>
    );
    if (!model.started) {
      body = <GetReadyCard title={title} result="ready" checks={st.ready.checks} enrolled expires={st.leaseExpires} code={st.code} userName={userName} onGetReady={(pin) => void ctl.getReady(pin)} onStart={() => void ctl.start()} busy={st.busy} more={more} />;
    } else if (st.closing) {
      body = <>{banners}<ClosingScreen closing={st.closing} unsent={unsent} online={st.online} autoApply={!!boot?.auto_apply} findings={(st.fresh?.findings_job as { status: string; last_error: string | null } | null) ?? null} findingsCode={st.findingsCode} unmeasured={model.unmeasured}
        onSend={() => void ctl.drain(true)} onRetry={() => void ctl.close(buildEvidence(model, st.draft, !!initials))} onKeepWorking={() => ctl.dismissClosing()} onAction={(a) => { setAfter(a); ctl.dismissClosing(); }} onReopen={(r) => ctl.reopen(r)} onApply={() => void ctl.applyFindings()} home={home}
        signInHref={signInHref} staff={staffUser} closedAt={(st.fresh ?? snap)?.consult.closed_at}
        refusedPlace={st.closing.step === "error" ? closeRefusalPlace(st.closing.field, model) : null}
        onRefused={(fix) => {
          // r10 R10-1: a refused close is dropped (reload / back / a place on the visit / keep working) or rebuilt (send now, try again).
          // r11 R11-1: each fix goes where its line says; a field the office named is focused there.
          if (fix === "send_now" || fix === "retry") { void ctl.closeAgain(); return; }
          const field = st.closing?.field;
          void ctl.abandonClose().then(() => {
            if (fix === "reload") void ctl.refresh().then(() => location.reload());
            else if (fix === "back_to_visits") location.href = "/consult/";
            else if (fix === "sign_in") location.href = signInHref;
            else if (fix === "go_to_field") setAfter(field ? `focus:${field}` : "go_conflict");
            else if (fix === "before_you_wrap") setAfter(field ? `focus:${field}` : "before_you_wrap");
            else if (fix === "trade_walks") setAfter("trade_walks_day");
          });
        }} /></>;
    } else if (status === "complete") {
      body = <>{banners}<ClosingScreen closing={{ step: "done", result: { complete: true, checks: [], price_critical: { total: model.pc.total, done: model.pc.done, skipped: model.pc.skipped }, record: { total: model.record.total, done: model.record.done, skipped: model.record.skipped }, revision: 0 } }} unsent={unsent} online={st.online} autoApply={!!boot?.auto_apply}
        findings={(st.fresh?.findings_job as { status: string; last_error: string | null } | null) ?? null} findingsCode={st.findingsCode} unmeasured={model.unmeasured} onSend={() => void ctl.drain(true)} onRetry={() => void ctl.refresh()} onKeepWorking={() => undefined} onReopen={(r) => ctl.reopen(r)} onApply={() => void ctl.applyFindings()} home={home} staff={staffUser} closedAt={(st.fresh ?? snap)?.consult.closed_at} /></>;
    } else {
      body = <>{banners}<VisitScreen key={resume ?? "visit"} device={st.device} startAt={resume} saveError={st.code} prefill={snap?.prefill} visitorNotes={snap?.visitor_notes} reopened={snap?.reopened} model={model} display={display} thumbs={st.thumbs} online={st.online} draft={st.draft} refused={refusedEntries(entries).length} hasInitials={!!initials} userName={userName} staff={!!display?.visitor_staff} lastSaved={st.lastSaved} startAction={after} onStartAction={() => setAfter(null)}
        forgotClose={status === "in_progress" && visitDay < today}
        api={{
          answer: (i, f, label, p, d) => ctl.answer(i, f, label, f==="client_initials"&&p.status==="skipped"?{...p,summary_text:ctl.shownSummary ?? clientRecapText(summaryInput(model,display,visitDay,model.promised ?? ""))}:p, d),
          addInstance: (m, label, parent) => ctl.addInstance(m, label, parent),
          removeInstance: (i, label) => ctl.removeInstance(i, label),
          photo: (file, meta, label) => ctl.photo(file, meta, label),
          resolve: (i, f, rev, cur, prop, p, label) => ctl.resolve(i, f, rev, cur, prop, p, label),
          discard: (id, reason) => ctl.discard(id, reason),
          ackSummary: ctl.shownSummary ?? clientRecapText(summaryInput(model,display,visitDay,model.promised ?? "")),
          setDraft: async (d) => {
            if(d.ack_reason && d.ack_reason!==st.draft.ack_reason){
              const instance=await ctl.ensureClosing();
              const text=ctl.shownSummary ?? clientRecapText(summaryInput(model,display,visitDay,model.promised ?? ""));
              await ctl.answer(instance,"client_initials","No initials",{status:"skipped",skip_reason:d.ack_reason==="Client absent"?"Client absent":d.ack_reason==="Client declined"?"Client declined":"Other",skip_note:d.ack_reason,summary_text:text});
            }
            return ctl.setDraft(d);
          },
          close: () => void ctl.close(buildEvidence(model, st.draft, !!initials)),
          ensureClosing: () => ctl.ensureClosing(),
          showToClient: (f) => { if(f) setClient({instance:f.addr.split(":")[0],field:f.key}); else void ctl.ensureClosing().then(instance=>setClient({instance,field:"client_initials"})); },
        }} /></>;
    }
  } else body = <div className="mx-auto max-w-[560px]"><ScreenHead title={title} right={more} /><p className="px-4 py-6 text-ink-2" role="status">Opening…</p></div>;

  return (
    // r5 R5-1: the visitor screen is fixed to the viewport at every width (position: fixed; inset: 0,
    // html/body overflow: clip — consult.css), so no focus jump can move the status bar or the bottom
    // bar. Below 1024 px <main> is the one scroller; from 1024 px the right pane scrolls by itself and
    // its bottom bar (Next ›) stays pinned in the thumb zone (§6.1, r2 N4).
    <div className="consult-root consult-fixed flex flex-col bg-paper text-ink" data-sun={sun ? "1" : undefined}>
      {st.phase === "visit" && st.local && model?.started && <StatusBar unsent={unsent} photos={unsentPhotos} answers={unsentOps} online={st.online} lastSend={st.local.last_send} failure={failure} onSend={() => void ctl.drain(true)} sending={st.sending} onExit={leave} wide={wide} />}
      <main data-scroll className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">{body}</main>
      <Sheet open={exit} onClose={() => setExit(false)} title={W.back}
        footer={<><Btn onClick={() => setExit(false)}>{W.keepWorking}</Btn><Btn onClick={() => { ctl.lock(); location.href = home; }}>Lock notes on this device</Btn><Btn tone="primary" disabled={!st.online} onClick={() => void ctl.drain(true)}>{W.sendNow}</Btn></>}>
        <p className="text-ink">{fill(W.itemsWaiting, { n: unsent })} — they stay on this device until they are sent.</p>
      </Sheet>
    </div>
  );
}
