"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ChevronDown, CloudOff, ExternalLink, RotateCw } from "lucide-react";
import { CoverageMark, coverageWord } from "@/components/ui/CoverageMark";
import { errorCopy } from "@/lib/checklist-coverage/action-result";
import { finishChecklist, linkChecklist, loadChecklistSummary } from "@/lib/actions/discovery-checklist";
import { checklistLeadInfo, type ChecklistLead } from "@/lib/actions/discovery-checklist-ui";
import { INSURANCE_WARNING, priorToValue, type ChecklistSnapshot } from "@/lib/checklist-coverage/manual";
import type { CoverageState } from "@/lib/checklist-coverage/contract";
import { changesWord, nextTapState, rowView, notesView, type RowValue } from "@/lib/checklist-coverage/client-queue";
import { formatValue, isInsurance } from "@/lib/checklist-coverage/answers";
import { markSignedIn, useChecklistSync, type ChecklistSync } from "./useChecklistSync";
import { RowSheet } from "./RowSheet";
import { CallPicker, LeadPicker, NewLeadSheet, prefetchChecklistLeads } from "./Pickers";
import { ChecklistSummary, type SummaryData } from "./ChecklistSummary";
import { Btn } from "./Sheet";
import { EditContactModal } from "@/components/leads/LeadContact";
import { chicagoTime, elapsed } from "./time";
import { setOpenChecklist } from "../open-call-store";
import { claimCompactApprovals } from "@/lib/notification-placement";
import { ApprovalBadgeSlot } from "@/components/shell/ApprovalBadgeSlot";

export interface ChecklistCallInfo {
  id: string; direction: "inbound" | "outbound"; status: string; ended: boolean;
  started_at: string; answered_at: string | null; label: string; number: string;
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** "Saved" only after the server acknowledged every edit (plan §4.2 step 4). */
function saveWord(sync: ChecklistSync): { word: string; tone: string } {
  const n = sync.queue.length;
  if (sync.problem || sync.conflict) return { word: "Not saved", tone: "text-flag" };
  if (n && (!sync.online || sync.storageDenied)) return { word: "Not sent", tone: "text-flag" };
  if (n) return { word: "Saving…", tone: "text-ink-3" };
  return { word: "Saved", tone: "text-ink-2" };
}

function Banner({ tone, icon, children, actions, role = "status" }: { tone: "flag" | "info" | "plain"; icon?: ReactNode; children: ReactNode; actions?: ReactNode; role?: "status" | "alert" }) {
  const cls = tone === "flag" ? "border-flag/40 bg-flag-soft text-flag" : tone === "info" ? "border-info/30 bg-info-soft text-ink" : "border-rule bg-card text-ink";
  return (
    <div role={role} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-[16px] leading-6 ${cls}`}>
      <span className="flex min-w-0 flex-1 basis-56 items-start gap-2">{icon}<span className="min-w-0">{children}</span></span>
      {actions && <span className="flex flex-wrap gap-2">{actions}</span>}
    </div>
  );
}

function describe(key: string, v: RowValue | { notes: string }): string {
  if ("notes" in v) return v.notes || "(empty)";
  const word = coverageWord(v.state === "not_applicable" ? "not_applicable" : v.state);
  const value = formatValue(key, v.value);
  return [word, value, v.state === "not_applicable" ? v.reason : null].filter(Boolean).join(" — ");
}

export function ChecklistPane({
  sessionId, userId, call, onBack, onOpenCall, badgeSlot = false,
}: {
  sessionId: string;
  userId: string;
  /** The call this pane sits under (its header is the Calls detail header). */
  call: ChecklistCallInfo | null;
  /** Phone Back for a checklist that isn't under a call. */
  onBack?: () => void;
  onOpenCall?: (callId: string) => void;
  /** This pane's own header (no call) holds the "Decisions N" badge. */
  badgeSlot?: boolean;
}) {
  const sync = useChecklistSync(sessionId, userId);
  // While a checklist is on screen, approvals fold into their badge: the
  // checklist's own follow-up must never cover Finish (lib/notification-placement.ts).
  const claimId = useId();
  useEffect(() => {
    claimCompactApprovals(claimId, true);
    return () => claimCompactApprovals(claimId, false);
  }, [claimId]);
  const snap = sync.snapshot;
  const [view, setView] = useState<"list" | "summary" | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [lead, setLead] = useState<ChecklistLead | null>(null);
  const [leadVersion, setLeadVersion] = useState(0);
  const [editLead, setEditLead] = useState<ChecklistLead | null>(null);
  const [picker, setPicker] = useState<"lead" | "call" | "new_lead" | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Record<string, RowValue>>({});
  const [notes, setNotes] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [answersOpen, setAnswersOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const lastAnnounce = useRef(0);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { markSignedIn(userId); }, [userId]);
  // The lead picker's first page is ready before "Lead: Link later ▾" is tapped.
  const callNumber = call?.number ?? null;
  const needsLead = !!snap && !snap.session.lead_id;
  useEffect(() => { if (needsLead) prefetchChecklistLeads(callNumber).catch(() => undefined); }, [needsLead, callNumber]);
  // Under a call, CallsClient reports the open call; alone, this pane does.
  const underCall = !!call;
  useEffect(() => {
    if (underCall) return;
    setOpenChecklist({ sessionId, callId: null });
    return () => setOpenChecklist(null);
  }, [sessionId, underCall]);

  // Until Joe switches views, a finished checklist opens on its summary.
  const shownView = view ?? (snap ? (snap.session.status === "ended" ? "summary" : "list") : null);

  const leadId = snap?.session.lead_id ?? null;
  useEffect(() => {
    if (!leadId) return;
    let live = true;
    checklistLeadInfo(leadId).then((l) => { if (live) setLead(l); }).catch(() => undefined);
    return () => { live = false; };
  }, [leadId, leadVersion]);
  const shownLead = lead && lead.id === leadId ? lead : null;

  const rows = useMemo(() => {
    if (!snap) return [];
    return snap.rows.map((r) => ({ row: r, view: rowView(snap, sync.queue, r.identity.item_id)! }));
  }, [snap, sync.queue]);
  const covered = rows.filter((r) => r.view.state === "covered").length;

  // Count changes are announced politely, at most every 10 s (plan §6.9).
  useEffect(() => {
    if (!rows.length) return;
    const text = `${covered} of ${rows.length} covered`;
    const wait = Math.max(0, 10_000 - (Date.now() - lastAnnounce.current));
    const t = setTimeout(() => { lastAnnounce.current = Date.now(); setAnnounce(text); }, wait);
    return () => clearTimeout(t);
  }, [covered, rows.length]);

  const savedNotes = snap ? notesView(snap, sync.queue).notes : "";
  const notesText = notes ?? savedNotes;

  // ── summary view ───────────────────────────────────────────────────────
  const [summaryLoad, setSummaryLoad] = useState(0);
  async function openSummary(data?: SummaryData) {
    setView("summary");
    setSummaryError(false);
    if (data) { setSummary(data); return; }
    setSummary(null);
    setSummaryLoad((n) => n + 1);
  }
  /** Re-read the summary in place (after staging a draft or adding an email). */
  function refreshSummary() {
    loadChecklistSummary(sessionId).then((d) => setSummary(d as SummaryData)).catch(() => undefined);
  }
  const needsSummary = shownView === "summary" && !summary && !summaryError;
  useEffect(() => {
    if (!needsSummary) return;
    let live = true;
    loadChecklistSummary(sessionId).then((d) => { if (live) setSummary(d as SummaryData); }).catch(() => { if (live) setSummaryError(true); });
    return () => { live = false; };
  }, [needsSummary, sessionId, summaryLoad]);

  // ── edits ──────────────────────────────────────────────────────────────
  function change(itemId: string, next: RowValue, current: RowValue) {
    setUndo((u) => ({ ...u, [itemId]: { state: current.state, value: current.value, reason: current.reason } }));
    sync.setItem({ item_id: itemId, ...next });
  }

  function tap(itemId: string, current: RowValue) {
    const state: CoverageState = nextTapState(current.state);
    change(itemId, { state, value: state === "open" && current.state === "not_applicable" ? null : current.value, reason: null }, current);
  }

  function stillRight(itemId: string, key: string, prior: { value: unknown }, current: RowValue) {
    // Same as confirmLeadChecklistItem: Covered with the saved fact as the answer,
    // but through the queue so it survives a dropped connection.
    change(itemId, { state: "covered", value: priorToValue(key, prior.value) ?? null, reason: null }, current);
  }

  function typeNotes(text: string) {
    setNotes(text);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => sync.setNotes(text), 1200);
  }
  function flushNotes() {
    if (notesTimer.current) clearTimeout(notesTimer.current);
    if (notes !== null) sync.setNotes(notes);
  }

  async function link(target: { lead_id?: string | null; call_id?: string | null }): Promise<boolean> {
    if (!snap) return false;
    if (!sync.whenIdle()) { setLinkError("Wait until your changes have sent, then link."); return false; }
    setLinkBusy(true); setLinkError(null);
    try {
      const fresh = await sync.reload();
      if (!fresh) throw new Error("load");
      const r = await linkChecklist({
        session_id: sessionId, lead_id: target.lead_id !== undefined ? target.lead_id : fresh.session.lead_id,
        call_id: target.call_id !== undefined ? target.call_id : fresh.session.call_id,
        expected_revision: fresh.session.revision, operation_id: crypto.randomUUID(),
      });
      if (!r.ok) { await sync.reload(); setLinkError(errorCopy(r.code)); return false; }
      await sync.reload();
      setPicker(null);
      return true;
    } catch {
      setLinkError(navigator.onLine === false ? "Linking needs a connection." : "Couldn't link. Try again.");
      return false;
    } finally { setLinkBusy(false); }
  }

  /** Online-only commands wait (briefly) for this device's edits to land first. */
  async function waitIdle(ms: number): Promise<boolean> {
    const until = Date.now() + ms;
    while (!sync.whenIdle()) {
      if (Date.now() > until || navigator.onLine === false) return false;
      await new Promise((r) => setTimeout(r, 250));
    }
    return true;
  }

  async function finish() {
    if (!snap) return;
    flushNotes();
    setFinishing(true); setFinishError(null);
    if (!(await waitIdle(8000))) {
      setFinishing(false);
      setFinishError(navigator.onLine === false ? "Finishing needs a connection. Your ticks are kept on this device." : "Your changes haven't sent yet. Try again in a moment.");
      return;
    }
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const fresh = await sync.reload();
        if (!fresh) break;
        const r = await finishChecklist({ session_id: sessionId, expected_revision: fresh.session.revision, operation_id: crypto.randomUUID() });
        if (!r.ok && r.code!=="CHECKLIST_CONFLICT") {setFinishError(errorCopy(r.code)); return;}
        if (r.ok) { await sync.reload(); await openSummary(("summary" in r ? r.summary : undefined) as SummaryData | undefined); return; }
      }
      setFinishError("The checklist changed on another device. Try again.");
    } catch {
      setFinishError(navigator.onLine === false ? "Finishing needs a connection. Your ticks are kept on this device." : "Couldn't finish. Try again.");
    } finally { setFinishing(false); }
  }

  // ── states before the checklist is in hand ────────────────────────────
  if (sync.problem?.kind === "user_switch") return <p role="alert" className="p-4">Sign in again before continuing. Your changes have not been sent.</p>;
  if (!snap) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
        {!call && <ManualHeader onBack={onBack} started={null} badgeSlot={badgeSlot} />}
        <div className="flex-1 overflow-y-auto px-4 py-4 @2xl/page:px-5">
          {sync.loadError ? (
            <Banner tone="flag" role="alert" icon={<AlertTriangle aria-hidden className="mt-0.5 size-5 flex-none" />}
              actions={<Btn onClick={() => sync.retry()}><RotateCw aria-hidden className="size-4" /> Retry</Btn>}>
              Couldn&apos;t load the checklist.
            </Banner>
          ) : (
            <div aria-busy="true">
              <p className="text-[16px] text-ink-3" role="status">Loading checklist</p>
              <ul className="mt-3 space-y-2" aria-hidden>{Array.from({ length: 9 }, (_, i) => <li key={i} className="h-12 animate-pulse rounded-md bg-paper-3 motion-reduce:animate-none" />)}</ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  const status = saveWord(sync);
  // Edits that are waiting because they can't go out (offline / storage off),
  // not the split second an online save is in flight.
  const unsent = !sync.online || sync.storageDenied;
  const s = snap.session;
  const sheetRow = openItem ? rows.find((r) => r.row.identity.item_id === openItem) : null;
  const answers = rows.filter((r) => formatValue(r.row.spec.key, r.view.value));

  if (shownView === "summary") {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
        {/* The summary title carries "started 7:34 PM"; don't say it twice. */}
        {!call && <ManualHeader onBack={onBack} started={null} badgeSlot={badgeSlot} />}
        <ChecklistSummary sessionId={sessionId} snapshot={snap} call={call} lead={shownLead} data={summary} error={summaryError}
          onRetry={() => void openSummary()} onBackToList={() => setView("list")}
          onEditRow={(id) => { setView("list"); setOpenItem(id); }}
          onLinkLead={() => { setView("list"); setPicker("lead"); }}
          onEditLeadEmail={setEditLead} onDraftStaged={refreshSummary} />
        {editLead && <EditContactModal slug={editLead.slug} name={editLead.name} email={editLead.email ?? ""} phone={editLead.phone ?? ""}
          onClose={() => { setEditLead(null); setLeadVersion((v) => v + 1); refreshSummary(); }} />}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      {!call && <ManualHeader onBack={onBack} started={s.started_at} badgeSlot={badgeSlot} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 @2xl/page:px-5">
          {/* Session line: Lead · Call · Saved, then the "By hand" chip on the
              same wrapping line — kept tight so the rows start high on a phone. */}
          <div className="flex flex-wrap items-center gap-x-2 text-[16px]">
            <span className="flex min-w-0 items-center">
              <button type="button" onClick={() => { setLinkError(null); setPicker("lead"); }} className={`inline-flex min-h-12 min-w-0 items-center gap-1 rounded-md px-2 -ml-2 hover:bg-hover ${FOCUS}`}>
                <span className="text-ink-3">Lead:</span> <span className="truncate font-semibold text-ink">{shownLead?.name ?? (s.lead_id ? "…" : "Link later")}</span> <ChevronDown aria-hidden className="size-4 flex-none text-ink-3" />
              </button>
              {shownLead && <Link href={`/leads/${shownLead.slug}`} aria-label={`Open ${shownLead.name}'s lead page`} className={`inline-flex size-12 items-center justify-center rounded-md text-ink-2 hover:bg-hover ${FOCUS}`}><ExternalLink aria-hidden className="size-4" /></Link>}
            </span>
            <span aria-hidden className="text-ink-4 max-[480px]:hidden">·</span>
            {call ? (
              <span className="inline-flex min-h-12 items-center gap-1 text-ink-2"><span className="text-ink-3">Call:</span> this call</span>
            ) : (
              <button type="button" onClick={() => { setLinkError(null); setPicker("call"); }} className={`inline-flex min-h-12 items-center gap-1 rounded-md px-2 hover:bg-hover max-[480px]:-ml-2 ${FOCUS}`}>
                <span className="text-ink-3">Call:</span> <span className="font-semibold text-ink">{s.call_id ? "linked" : "none"}</span> <ChevronDown aria-hidden className="size-4 text-ink-3" />
              </button>
            )}
            {s.call_id && !call && onOpenCall && <Btn kind="ghost" onClick={() => onOpenCall(s.call_id!)}>Open call</Btn>}
            <span aria-hidden className="text-ink-4 max-[480px]:hidden">·</span>
            <span className={`inline-flex min-h-12 items-center font-semibold ${status.tone}`}>{status.word}</span>
            {/* Under a call, the call's own header carries ● On the line 04:21. */}
            <span className="inline-flex min-h-7 items-center rounded-full border border-rule bg-card px-3 py-0.5 text-[15px] font-semibold leading-5 text-ink-2">By hand — AI can&apos;t hear this call</span>
            {s.status === "ended" && <span className="inline-flex min-h-7 items-center text-[15px] text-ink-3">Finished · edits still allowed</span>}
          </div>

          <div className="mt-2 space-y-2 empty:hidden"><Banners sync={sync} rows={rows} /></div>
        </div>

        <fieldset disabled={sync.editsBlocked} className="min-w-0 grid gap-x-8 px-4 pb-4 pt-3 @2xl/page:px-5 @6xl/page:grid-cols-[minmax(0,58fr)_minmax(0,42fr)]">
          <section aria-labelledby={`${sessionId}-h`}>
            <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-1">
              <h2 id={`${sessionId}-h`} className="font-serif text-[20px] font-semibold leading-7 text-ink">Discovery checklist</h2>
              <span className="text-[15px] font-semibold text-ink-2">{covered} of {rows.length}</span>
            </div>
            <span className="sr-only" aria-live="polite">{announce}</span>
            <ul className="divide-y divide-rule-soft">
              {rows.map(({ row, view: v }) => {
                const id = row.identity.item_id;
                const showPrior = !!row.prior && v.state === "open" && !v.pending;
                const priorText = row.prior ? formatValue(row.spec.key, priorToValue(row.spec.key, row.prior.value)) : "";
                const next = nextTapState(v.state);
                const answer = formatValue(row.spec.key, v.value);
                return (
                  <li key={id}>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <button type="button" onClick={() => setOpenItem(id)} aria-haspopup="dialog"
                        className={`flex min-h-12 min-w-0 flex-1 basis-40 flex-col items-start justify-center rounded-md px-2 -ml-2 py-1 text-left hover:bg-hover ${FOCUS}`}>
                        <span className="text-[17px] font-semibold leading-6 text-ink">{row.spec.label}</span>
                        {showPrior ? (
                          <span className="flex flex-wrap items-center gap-1.5 text-[15px] leading-5 text-ink-2">
                            <span className="rounded-full border border-rule px-2 text-[13px] font-semibold text-ink-3">On lead</span>{priorText}
                          </span>
                        ) : answer ? <span className="line-clamp-2 text-[15px] leading-5 text-ink-2">{answer}</span> : null}
                      </button>
                      {showPrior && (
                        <Btn onClick={() => stillRight(id, row.spec.key, row.prior!, v)} className="order-last px-3 max-[420px]:w-full @3xl/page:order-none">Still right ✓</Btn>
                      )}
                      <button type="button" onClick={() => tap(id, v)}
                        aria-label={`${row.spec.label}: ${coverageWord(v.state)}${v.pending ? ", not saved yet" : ""}. Mark ${coverageWord(next)}`}
                        className={`ml-auto inline-flex min-h-12 min-w-[7.5rem] flex-col items-end justify-center rounded-md px-2 -mr-2 hover:bg-hover ${FOCUS}`}>
                        <CoverageMark variant="coverage" state={v.state} />
                        {/* Words, not a dotted underline: only while it really can't send. */}
                        {v.pending && unsent && <span className="text-[13px] leading-4 text-ink-3">not sent</span>}
                      </button>
                    </div>
                    {isInsurance(row.spec.key, v.value) && (
                      <p className="mb-2 flex gap-2 rounded-md border border-flag/40 bg-flag-soft px-3 py-2 text-[15px] text-flag"><AlertTriangle aria-hidden className="mt-0.5 size-4 flex-none" />{INSURANCE_WARNING}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <aside className="mt-4 space-y-3 @6xl/page:mt-0">
            <div className="@6xl/page:hidden">
              {answers.length > 0 && (
                <Btn kind="secondary" aria-expanded={answersOpen} onClick={() => setAnswersOpen((o) => !o)} className="mr-2">Answers <ChevronDown aria-hidden className={`size-4 transition-transform ${answersOpen ? "rotate-180" : ""}`} /></Btn>
              )}
              <Btn kind="secondary" aria-expanded={notesOpen || !!notesText} onClick={() => setNotesOpen((o) => !o)}>Notes</Btn>
            </div>
            {answers.length > 0 && (
              <div className={`${answersOpen ? "block" : "hidden"} @6xl/page:block`}>
                <h3 className="text-[15px] font-semibold text-ink-3">Answers so far</h3>
                <dl className="mt-1 space-y-1.5 text-[16px]">
                  {answers.map(({ row, view: v }) => (
                    <div key={row.identity.item_id}><dt className="inline font-semibold text-ink">{row.spec.label}:</dt> <dd className="inline text-ink-2">{formatValue(row.spec.key, v.value)}</dd></div>
                  ))}
                </dl>
              </div>
            )}
            <div className={`${notesOpen || notesText ? "block" : "hidden"} @6xl/page:block`}>
              <label htmlFor={`${sessionId}-notes`} className="text-[15px] font-semibold text-ink-3">Notes</label>
              <textarea id={`${sessionId}-notes`} value={notesText} onChange={(e) => typeNotes(e.target.value)} onBlur={flushNotes} rows={5} maxLength={30000}
                className="mt-1 block w-full rounded-md border border-rule bg-card px-3 py-2.5 text-[16px] leading-6 text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus" />
            </div>
          </aside>
        </fieldset>

        {/* On a phone the tab bar below already clears the safe area. */}
        <div className="sticky bottom-0 z-10 border-t border-rule bg-paper-2 px-4 pb-2 pt-2 @2xl/page:px-5 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pt-3 sm:max-lg:pr-40">
          {/* The offline banner scrolls away with the rows; this line stays in view. */}
          {unsent && sync.queue.length > 0 && (
            <p className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink-2"><CloudOff aria-hidden className="size-4 flex-none" /> {sync.online ? "" : "Offline — "}{changesWord(sync.queue.length)} not sent</p>
          )}
          {finishError && <p role="alert" className="mb-2 text-[15px] text-flag">{finishError}</p>}
          <Btn kind="primary" onClick={() => void (s.status === "ended" ? openSummary() : finish())} disabled={finishing || !!sync.conflict || sync.recovered !== null} className="w-full @3xl/page:w-auto @3xl/page:min-w-64">
            {finishing ? "Finishing…" : s.status === "ended" ? "Summary" : "Finish checklist"}
          </Btn>
        </div>
      </div>

      {sheetRow && (
        <RowSheet key={openItem!} spec={sheetRow.row.spec} view={sheetRow.view} manualLock={sheetRow.row.coverage.manual_lock}
          undoTo={undo[openItem!] ?? null} onClose={() => setOpenItem(null)}
          onSave={(next) => { change(openItem!, next, sheetRow.view); setOpenItem(null); }} />
      )}
      {picker === "lead" && <LeadPicker callNumber={callNumber} busy={linkBusy} error={linkError} onClose={() => setPicker(null)} onPick={(l) => void link({ lead_id: l.id })}
        onNewLead={() => { setLinkError(null); setPicker("new_lead"); }} />}
      {/* New lead from the checklist: saved, then this checklist links to it (plan §6.6). */}
      {picker === "new_lead" && <NewLeadSheet phone={callNumber ?? ""} onClose={() => setPicker(null)}
        onCreated={async (l) => { if (!(await link({ lead_id: l.id }))) setPicker("lead"); }} />}
      {picker === "call" && <CallPicker busy={linkBusy} error={linkError} onClose={() => setPicker(null)} onPick={(c) => void link({ call_id: c.id })} />}
    </div>
  );
}

function ManualHeader({ onBack, started, badgeSlot }: { onBack?: () => void; started: string | null; badgeSlot?: boolean }) {
  // One 48 px row at every width (plan §6.4a): "← Checklist · 8:58 PM [⚑ 1]" on
  // a phone, "← Calls Checklist · started 8:58 PM [Decisions 1]" from @md. The
  // time and its "·" never break apart, so no line ends on "·".
  return (
    <div className="flex min-h-12 items-center gap-1 border-b border-rule bg-paper px-4 @2xl/page:gap-2 @2xl/page:px-5">
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Back to Calls" className={`-ml-2 inline-flex min-h-12 flex-none items-center gap-1 rounded-md px-2 text-[16px] text-ink-2 hover:bg-hover @max-sm/page:size-11 @max-sm/page:min-h-11 @max-sm/page:justify-center @max-sm/page:px-0 @3xl/page:hidden ${FOCUS}`}>
          <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} /> <span className="@max-sm/page:hidden">Calls</span>
        </button>
      )}
      <h2 className="min-w-0 truncate whitespace-nowrap font-serif text-[20px] font-semibold leading-7 text-ink">Checklist{started ? <span className="whitespace-nowrap font-sans text-[16px] font-normal text-ink-3"> · <span className="@max-md/page:hidden">started </span>{chicagoTime(started)}</span> : null}</h2>
      {badgeSlot && <ApprovalBadgeSlot className="ml-auto" />}
    </div>
  );
}

/** "● On the line 04:21" / "Incoming call" / "Your cell rings first" (plan §6.4,
 *  §6.7) — in the call's detail header, beside the name. */
export function CallState({ call, now }: { call: ChecklistCallInfo; now: number | null }) {
  if (call.ended) return <span className="text-[15px] text-ink-3">Call ended</span>;
  if (call.status === "ringing") return <span className="text-[15px] font-semibold text-ink">{call.direction === "inbound" ? "Incoming call" : "Your cell rings first"}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink">
      <span aria-hidden className="size-2 rounded-full bg-accent" /> On the line {now ? elapsed(call.answered_at ?? call.started_at, now) : ""}
    </span>
  );
}

function Banners({ sync, rows }: { sync: ChecklistSync; rows: { row: ChecklistSnapshot["rows"][number] }[] }) {
  const n = sync.queue.length;
  const labelOf = (itemId: string) => rows.find((r) => r.row.identity.item_id === itemId)?.row.spec ?? null;
  const conflict = sync.conflict;
  return (
    <>
      {sync.problem?.kind === "user_switch" && (
        <Banner tone="flag" role="alert" icon={<AlertTriangle aria-hidden className="mt-0.5 size-5 flex-none" />}
          actions={<Btn onClick={() => window.location.reload()}>Reload</Btn>}>
          You&apos;re signed in as someone else in another tab. Changes on this page weren&apos;t sent. Reload to carry on.
        </Banner>
      )}
      {conflict && (() => {
        const spec = conflict.mine.kind === "set_item" ? labelOf(conflict.mine.op.item_id) : null;
        const name = spec?.label ?? "Notes";
        const mine = conflict.mine.kind === "set_item" ? { state: conflict.mine.op.state, value: conflict.mine.op.value, reason: conflict.mine.op.reason } : { notes: conflict.mine.op.notes };
        return (
          <div role="alert" className="rounded-md border border-flag/40 bg-flag-soft px-3 py-3 text-[16px] text-ink">
            <p className="flex items-start gap-2 font-semibold text-flag"><AlertTriangle aria-hidden className="mt-0.5 size-5 flex-none" /> {name} was changed on another device.</p>
            <dl className="mt-2 grid gap-2 @xl/page:grid-cols-2">
              <div className="rounded-md bg-card px-3 py-2"><dt className="text-[14px] font-semibold text-ink-3">This device</dt><dd className="mt-0.5 break-words">{describe(spec?.key ?? "", mine)}</dd></div>
              <div className="rounded-md bg-card px-3 py-2"><dt className="text-[14px] font-semibold text-ink-3">Saved now</dt><dd className="mt-0.5 break-words">{describe(spec?.key ?? "", conflict.current)}</dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2"><Btn kind="primary" onClick={sync.keepMine}>Keep mine</Btn><Btn onClick={sync.keepSaved}>Use the saved one</Btn></div>
          </div>
        );
      })()}
      {sync.problem?.kind === "error" && (
        <Banner tone="flag" role="alert" icon={<AlertTriangle aria-hidden className="mt-0.5 size-5 flex-none" />}
          actions={<><Btn onClick={sync.retry}>Try again</Btn><Btn kind="ghost" onClick={sync.discardFailed}>Discard change</Btn></>}>
          {sync.problem.message}
        </Banner>
      )}
      {sync.recovered && (
        <Banner tone="info" role="alert" actions={<><Btn kind="primary" onClick={sync.sendRecovered}>Send now</Btn><Btn onClick={sync.discardRecovered}>Discard</Btn></>}>
          {changesWord(sync.recovered.length)} from this device weren&apos;t sent
        </Banner>
      )}
      {!sync.online && !sync.storageDenied && (
        <Banner tone="plain" icon={<CloudOff aria-hidden className="mt-0.5 size-5 flex-none text-ink-2" />}>
          {n ? <>Offline — {changesWord(n)} saved on this device. They&apos;ll send when you&apos;re back online.</> : <>Offline — changes you make are saved on this device.</>}
        </Banner>
      )}
      {sync.storageDenied && (!sync.online || n > 0) && (
        <Banner tone="flag" role="alert" icon={<AlertTriangle aria-hidden className="mt-0.5 size-5 flex-none" />}>
          Can&apos;t save on this device — keep this page open until you&apos;re back online.
        </Banner>
      )}
    </>
  );
}

