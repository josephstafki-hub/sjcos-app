"use client";
/**
 * Field app root for /consult/[id] (online, server-rendered boot) and the offline
 * shell (/consult/offline.html → capture.js, boot = null). One controller per visit.
 * Status bar (§6.2): one 56 px row, no wrapping; dot/mark always followed by a word;
 * ⋯ holds Sun mode and Back to SJC OS on every width. Phase 1 has no recording, so
 * the capture state always reads "○ Notes off" and there is no notes/AI control.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { VisitController, type Boot } from "@/lib/consult/ui/controller";
import { buildEvidence, refusedEntries, summaryInput, unsentCount } from "@/lib/consult/ui/model";
import { W, fill, plainWords } from "@/lib/consult/ui/words";
import { Banner, Btn, LinkBtn, Sheet, useWakeLock } from "./primitives";
import { GetReadyCard, UnlockCard, ScreenHead, centralTime } from "./GetReady";
import { VisitScreen } from "./VisitScreen";
import { ClosingScreen } from "./WrapClose";
import { ClientView } from "./ClientView";

const SUN_KEY = "sjcos-consult-sun";
const sunListeners = new Set<() => void>();
const sunStore = {
  subscribe: (fn: () => void) => { sunListeners.add(fn); return () => { sunListeners.delete(fn); }; },
  get: () => { try { return localStorage.getItem(SUN_KEY) === "1"; } catch { return false; } },
  set: (v: boolean) => { try { localStorage.setItem(SUN_KEY, v ? "1" : "0"); } catch { /* private mode */ } for (const fn of sunListeners) fn(); },
};
const nowIso = () => new Date().toISOString();

function StatusBar({ unsent, photos, answers, online, lastSend, onSend, sending, sun, onSun, onExit, wide }: { unsent: number; photos: number; answers: number; online: boolean; lastSend: number | null; onSend: () => void; sending: boolean; sun: boolean; onSun: () => void; onExit: () => void; wide?: boolean }) {
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b-2 border-rule bg-paper-2">
      <div className="flex min-h-14 items-center gap-2 px-2">
        <button type="button" onClick={() => setSheet(true)} aria-label={`${W.notesOff}. ${unsent} waiting to send. ${online ? W.online : W.offlineLine}. Open send details.`}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left font-semibold text-ink hover:bg-hover focus-visible:outline-3 focus-visible:outline-focus">
          <span aria-hidden className="font-mono">○</span>
          <span className="min-w-0 truncate">{W.notesOff} · <span className="font-mono">⇅ {unsent}</span><span className={wide ? "" : "max-md:hidden"}>{online ? ` · ${W.online}` : ""}</span>{sending ? <span className="text-ink-3"> · sending…</span> : null}</span>
        </button>
        <button type="button" onClick={() => setMenu(true)} aria-label={W.more} aria-haspopup="dialog" className="inline-flex size-14 shrink-0 items-center justify-center rounded-md text-[1.4em] font-bold text-ink hover:bg-hover focus-visible:outline-3 focus-visible:outline-focus">⋯</button>
      </div>
      {!online && <p role="status" className="border-t-2 border-info bg-info-soft px-4 py-1.5 text-[0.95em] font-semibold text-ink"><span aria-hidden>⇣ </span>{W.offlineLine}</p>}
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Sending" footer={<Btn tone="primary" onClick={() => { onSend(); }} disabled={!online || sending || unsent === 0}>{W.sendNow}</Btn>}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-ink">
          <dt className="text-ink-2">Notes</dt><dd>{W.notesOff}</dd>
          <dt className="text-ink-2">Answers waiting</dt><dd className="font-mono">{answers}</dd>
          <dt className="text-ink-2">Photos waiting</dt><dd className="font-mono">{photos}</dd>
          <dt className="text-ink-2">Last sent</dt><dd>{lastSend ? centralTime(lastSend, { hour: "numeric", minute: "2-digit" }) : "Not yet"}</dd>
          <dt className="text-ink-2">Signal</dt><dd>{online ? W.online : W.noSignal}</dd>
        </dl>
        {!online && <p className="mt-3 text-ink">{W.offlineStrip}</p>}
        {online && unsent > 0 && <p className="mt-3 text-ink-2">Sending answers and photos first.</p>}
      </Sheet>
      <Sheet open={menu} onClose={() => setMenu(false)} title={W.more}>
        <div className="grid gap-3">
          <Btn wide role="switch" aria-checked={sun} onClick={onSun} className="justify-between"><span>{W.sunMode}</span><span className="font-mono">{sun ? "● On" : "○ Off"}</span></Btn>
          <Btn wide onClick={() => { setMenu(false); onExit(); }}>{W.back}</Btn>
        </div>
      </Sheet>
    </header>
  );
}

export function ConsultApp({ boot, consultId }: { boot: Boot | null; consultId: string }) {
  const ctl = useMemo(() => new VisitController(boot, consultId), [boot, consultId]);
  const st = useSyncExternalStore(ctl.subscribe, ctl.getState, ctl.getState);
  const sun = useSyncExternalStore(sunStore.subscribe, sunStore.get, () => false);
  const [client, setClient] = useState<{instance:string;field:string} | null>(null);
  const [resume, setResume] = useState<string | null>(null);
  const [exit, setExit] = useState(false);
  const [wide, setWide] = useState(false);
  useEffect(() => { void ctl.init(); return () => ctl.dispose(); }, [ctl]);
  useEffect(() => { const q = matchMedia("(min-width: 1024px)"); const f = () => setWide(q.matches); f(); q.addEventListener("change", f); return () => q.removeEventListener("change", f); }, []);
  useWakeLock(st.phase === "visit");
  const toggleSun = () => sunStore.set(!sun);

  const snap = st.local ? ctl.snapshot() : null;
  const display = snap?.display ?? boot?.display;
  const model = useMemo(() => (st.local ? ctl.model() : null), [ctl, st.local, st.fresh, st.draft, st.freshSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  const entries = st.local?.queue.entries ?? [];
  const unsentOps = unsentCount(entries);
  const unsentPhotos = st.local?.blobs.filter((b) => !b.receipt).length ?? 0;
  const unsent = unsentOps + unsentPhotos;
  const userName = boot?.user.name ?? display?.visitor_name ?? "yourself";
  const home = boot?.home ?? (display?.slug ? `/projects/${display.slug}` : "/");
  const title = display ? `${display.client}${display.scheduled_label ? ` · ${display.scheduled_label}` : ""}` : W.app;
  const leave = () => { if (unsent > 0) setExit(true); else location.href = home; };

  let body: React.ReactNode = null;
  if (st.phase === "loading") body = <div className="mx-auto max-w-[560px]"><ScreenHead title={title} /><p className="px-4 py-6 text-ink-2" role="status">Opening…</p></div>;
  else if (st.phase === "disabled") body = <div className="mx-auto max-w-[560px]"><ScreenHead title={title} /><div className="px-4 py-6"><Banner kind="action">{plainWords("capture_disabled")}</Banner><div className="mt-4"><LinkBtn wide href={home}>{W.back}</LinkBtn></div></div></div>;
  else if (st.phase === "get_ready") body = <GetReadyCard title={title} result={st.ready.result} checks={st.ready.checks} enrolled={st.enrolled} expires={st.leaseExpires} code={st.code} userName={userName} onGetReady={(pin) => void ctl.getReady(pin)} />;
  else if (st.phase === "unlock") body = <UnlockCard title={title} onUnlock={(pin) => void ctl.unlock(pin)} busy={st.busy} code={st.code} expires={st.leaseExpires} olderBuild={st.olderBuild} />;
  else if (st.phase === "blocked") {
    const code = st.blocked ?? st.code ?? "signed_out";
    body = (
      <div className="mx-auto max-w-[560px]"><ScreenHead title={title} />
        <div className="grid gap-4 px-4 py-6">
          <Banner kind="action">{plainWords(code, { name: userName })}</Banner>
          {code === "signed_out" && <LinkBtn tone="primary" wide href={`/login?next=${encodeURIComponent(`/consult/${consultId}`)}`}>{W.signIn}</LinkBtn>}
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
      const formal = model.promised ? centralTime(`${model.promised}T12:00:00-06:00`, { month: "short", day: "numeric" }) : "";
      return <div className="consult-root min-h-dvh" data-sun={sun ? "1" : undefined}><ClientView summary={summaryInput(model, display, centralTime(snap?.consult.scheduled_at ?? nowIso(), { month: "short", day: "numeric" }), formal)} pamphlet={client.field === "pamphlet_initials"} hasInitials={st.local.blobs.some(b=>b.kind==="initials"&&b.instance_id===client.instance&&b.field_key===client.field)}
        onInitials={async (png) => { await ctl.photo(png, { instance_id: client.instance, field_key: client.field, kind: "initials" }, W.initials); }}
        verifyPin={(pin) => ctl.verifyPin(pin)}
        onHandBack={() => { setClient(null); setResume(client.instance); }} /></div>;
    }
    const banners = (
      <div className="grid gap-3 px-4 pt-3 empty:hidden">
        {st.storageFull && <Banner kind="action">{fill(W.storageFull, { field: st.lastSaved ?? "—" })}</Banner>}
        {(st.olderBuild || st.blocked === "update_required") && <Banner kind="status" actions={<Btn onClick={() => location.reload()}>{W.reload}</Btn>}>Update ready — reload between rooms.</Banner>}
        {st.code === "signed_out" && <Banner kind="action" actions={<LinkBtn href={`/login?next=${encodeURIComponent(`/consult/${consultId}`)}`}>{W.signIn}</LinkBtn>}>{plainWords("signed_out", { name: userName })}</Banner>}
      </div>
    );
    if (!model.started) {
      body = <GetReadyCard title={title} result="ready" checks={st.ready.checks} enrolled expires={st.leaseExpires} code={st.code} userName={userName} onGetReady={(pin) => void ctl.getReady(pin)} onStart={() => void ctl.start()} busy={st.busy} />;
    } else if (st.closing) {
      body = <>{banners}<ClosingScreen closing={st.closing} unsent={unsent} online={st.online} autoApply={!!boot?.auto_apply} findings={(st.fresh?.findings_job as { status: string; last_error: string | null } | null) ?? null} findingsCode={st.findingsCode}
        onSend={() => void ctl.drain(true)} onRetry={() => void ctl.close(buildEvidence(model, st.draft, !!initials))} onKeepWorking={() => ctl.dismissClosing()} onReopen={(r) => ctl.reopen(r)} onApply={() => void ctl.applyFindings()} home={home} /></>;
    } else if (status === "complete") {
      body = <>{banners}<ClosingScreen closing={{ step: "done", result: { complete: true, checks: [], price_critical: { total: model.pc.total, done: model.pc.done, skipped: model.pc.skipped }, record: { total: model.record.total, done: model.record.done, skipped: model.record.skipped }, revision: 0 } }} unsent={unsent} online={st.online} autoApply={!!boot?.auto_apply}
        findings={(st.fresh?.findings_job as { status: string; last_error: string | null } | null) ?? null} findingsCode={st.findingsCode} onSend={() => void ctl.drain(true)} onRetry={() => void ctl.refresh()} onKeepWorking={() => undefined} onReopen={(r) => ctl.reopen(r)} onApply={() => void ctl.applyFindings()} home={home} /></>;
    } else {
      body = <>{banners}<VisitScreen key={resume ?? "visit"} startAt={resume} saveError={st.code} prefill={snap?.prefill} visitorNotes={snap?.visitor_notes} model={model} display={display} thumbs={st.thumbs} online={st.online} draft={st.draft} refused={refusedEntries(entries).length} hasInitials={!!initials} userName={userName} staff={!!display?.visitor_staff} lastSaved={st.lastSaved}
        forgotClose={status === "in_progress" && visitDay < today}
        api={{
          answer: (i, f, label, p, d) => ctl.answer(i, f, label, p, d),
          addInstance: (m, label, parent) => ctl.addInstance(m, label, parent),
          removeInstance: (i, label) => ctl.removeInstance(i, label),
          photo: (file, meta, label) => ctl.photo(file, meta, label),
          resolve: (i, f, rev, cur, prop, p, label) => ctl.resolve(i, f, rev, cur, prop, p, label),
          discard: (id, reason) => ctl.discard(id, reason),
          setDraft: (d) => ctl.setDraft(d),
          close: () => void ctl.close(buildEvidence(model, st.draft, !!initials)),
          showToClient: (f) => { if(f) setClient({instance:f.addr.split(":")[0],field:f.key}); else if(closingSection) setClient({instance:closingSection.instance.id,field:"client_initials"}); },
        }} /></>;
    }
  } else body = <div className="mx-auto max-w-[560px]"><ScreenHead title={title} /><p className="px-4 py-6 text-ink-2" role="status">Opening…</p></div>;

  return (
    <div className="consult-root flex min-h-dvh flex-col bg-paper text-ink" data-sun={sun ? "1" : undefined}>
      {st.phase === "visit" && st.local && <StatusBar unsent={unsent} photos={unsentPhotos} answers={unsentOps} online={st.online} lastSend={st.local.last_send} onSend={() => void ctl.drain(true)} sending={st.sending} sun={sun} onSun={toggleSun} onExit={leave} wide={wide} />}
      {st.phase !== "visit" && st.phase !== "loading" && (
        <div className="flex justify-end px-2 pt-1"><Btn tone="quiet" size={48} role="switch" aria-checked={sun} onClick={toggleSun}>{W.sunMode} {sun ? "● On" : "○ Off"}</Btn></div>
      )}
      <main className="flex min-h-0 flex-1 flex-col">{body}</main>
      <Sheet open={exit} onClose={() => setExit(false)} title={W.back}
        footer={<><Btn onClick={() => setExit(false)}>{W.keepWorking}</Btn><Btn onClick={() => { ctl.lock(); location.href = home; }}>Lock notes on this device</Btn><Btn tone="primary" disabled={!st.online} onClick={() => void ctl.drain(true)}>{W.sendNow}</Btn></>}>
        <p className="text-ink">{fill(W.itemsWaiting, { n: unsent })} — they stay on this device until they are sent.</p>
      </Sheet>
    </div>
  );
}
