"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { CoverageMark } from "@/components/ui/CoverageMark";
import { stageChecklistFollowup } from "@/lib/actions/discovery-checklist";
import type { ChecklistLead } from "@/lib/actions/discovery-checklist-ui";
import type { ChecklistSnapshot } from "@/lib/checklist-coverage/manual";
import { emailCandidates, formatValue, isRefusal, MAX_EMAIL_QUESTIONS } from "@/lib/checklist-coverage/answers";
import { errorCopy } from "@/lib/checklist-coverage/action-result";
import { safeRevision } from "@/lib/checklist-coverage/contract";
import { earlierDrafts, followupCopy } from "@/lib/checklist-coverage/followup-copy";
import { Btn } from "./Sheet";
import { chicagoTime, durationWords } from "./time";
import type { ChecklistCallInfo } from "./ChecklistPane";

export interface SummaryData {
  counts: { covered: number; partial: number; open: number; not_applicable: number };
  rows: ChecklistSnapshot["rows"];
  notes: string;
  everythingCovered: boolean;
  subject: string;
  lead: { email: string | null; name: string } | null;
  drafts: { id: string; status: string; approval_status: string }[];
  noEmailCopy: string | null;
  /** Who is reading: the owner approves follow-ups himself. */
  viewer?: "owner" | "staff";
}

const INPUT = "mt-1 block w-full rounded-md border border-rule bg-card px-3 text-[16px] leading-6 text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

export function ChecklistSummary({
  sessionId, snapshot, call, lead, data, error, onRetry, onBackToList, onEditRow, onLinkLead, onEditLeadEmail, onDraftStaged,
}: {
  sessionId: string; snapshot: ChecklistSnapshot; call: ChecklistCallInfo | null; lead: ChecklistLead | null;
  data: SummaryData | null; error: boolean; onRetry: () => void; onBackToList: () => void;
  onEditRow: (itemId: string) => void; onLinkLead: () => void; onEditLeadEmail?: (lead: ChecklistLead) => void; onDraftStaged: () => void;
}) {
  const rows = useMemo(() => (data?.rows ?? []).map((r, i) => ({
    item_id: r.identity.item_id, key: r.spec.key, label: r.spec.label, state: r.coverage.state, value: r.coverage.value,
    reason: r.coverage.reason, priority: r.spec.reminder_priority ?? i, question: r.spec.questions[0] ?? null,
  })), [data]);
  const candidates = useMemo(() => emailCandidates(rows), [rows]);
  const [ticked, setTicked] = useState<string[] | null>(null);
  const picked = ticked ?? candidates.ticked;
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [staging, setStaging] = useState(false);
  /** Submitted in this view; the follow-ups that were there before it. */
  const [staged, setStaged] = useState(false);
  const [draftsBefore, setDraftsBefore] = useState<string[] | null>(null);
  const opRef = useRef<{ id: string; key: string } | null>(null);

  if (error) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p role="alert" className="flex flex-wrap items-center gap-3 text-[16px] text-flag"><AlertTriangle aria-hidden className="size-5" /> Couldn&apos;t load the summary. <Btn onClick={onRetry}><RotateCw aria-hidden className="size-4" /> Retry</Btn></p>
      </div>
    );
  }
  if (!data) return <div className="flex-1 px-4 py-4 text-[16px] text-ink-3" role="status">Loading summary</div>;

  const s = snapshot.session;
  const who = data.lead?.name ?? lead?.name ?? call?.label ?? null;
  // A hand-ticked checklist with no call has no call length to show: "Checklist
  // summary · started 7:34 PM", never "Call summary · 0 min".
  const duration = call ? durationWords(call.answered_at ?? call.started_at, s.ended_at) : null;
  // The title stays short ("Checklist summary"); who and when go on a smaller
  // line under it. Each part is kept whole, and each "·" sits in the left
  // padding of the part after it; the line is pulled left by that padding
  // inside an overflow-hidden box, so the "·" before whichever part starts a
  // line is clipped — a wrapped line never starts or ends on "·".
  const time = !call && s.started_at ? chicagoTime(s.started_at) : "";
  const title = call ? "Call summary" : "Checklist summary";
  const byline = [who, duration, time ? `started ${time}` : null].filter((p): p is string => !!p);
  const c = data.counts;
  const open = rows.filter((r) => r.state === "open");
  const partly = rows.filter((r) => r.state === "partial");
  const na = rows.filter((r) => r.state === "not_applicable");
  const answered = rows.filter((r) => formatValue(r.key, r.value));
  const subjectText = subject ?? data.subject;
  const email = data.lead?.email ?? null;
  const everything = data.everythingCovered;
  const copy = followupCopy(data.viewer);
  const listed = earlierDrafts(data.drafts, staged, draftsBefore);

  function toggle(id: string) {
    setTicked((t) => {
      const cur = t ?? candidates.ticked;
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_EMAIL_QUESTIONS) return cur;
      return [...cur, id];
    });
  }

  function addQuestions() {
    const lines = rows.filter((r) => picked.includes(r.item_id) && r.question).map((r) => `- ${r.question}`);
    if (!lines.length) return;
    setBody((b) => [b.trimEnd(), lines.join("\n")].filter(Boolean).join("\n\n"));
  }

  async function submit() {
    setDraftError(null);
    if (!subjectText.trim() || /[\r\n]/.test(subjectText)) { setDraftError("Add a one-line subject."); return; }
    if (!body.trim()) { setDraftError("Write the email first."); return; }
    if (body.length > 30000) { setDraftError("The email is too long."); return; }
    // One operation id per exact draft, so a retry after a dropped connection
    // stages it once; editing the text makes it a new draft.
    const key = JSON.stringify([subjectText, body, s.lead_id, email]);
    if (opRef.current?.key !== key) opRef.current = { id: crypto.randomUUID(), key };
    setStaging(true);
    try {
      const r = await stageChecklistFollowup({ session_id: sessionId, expected_revision: safeRevision(s.revision), operation_id: opRef.current.id, subject: subjectText.trim(), body, reviewed_lead_id:s.lead_id, reviewed_email:email });
      if(r.ok) { setDraftsBefore(data?.drafts.map((d) => d.id) ?? []); setStaged(true); onDraftStaged(); return; }
      setDraftError(errorCopy(r.code));
      if(r.code==='CHECKLIST_CONFLICT' || r.code==='CHECKLIST_RECIPIENT_CHANGED') { opRef.current=null; onRetry(); }

    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setDraftError(/NO_EMAIL/.test(m) ? "Confirm their email first." : /LINK_LEAD/.test(m) ? "Link this checklist to a lead first." : navigator.onLine === false ? "Submitting needs a connection. Your draft is still here." : "Couldn't submit. Your draft is still here — try again.");
    } finally { setStaging(false); }
  }

  const askToggle = (r: (typeof rows)[number]) => {
    if (isRefusal(r.key, r.value)) return <span className="text-[14px] text-ink-3">Rather not say</span>;
    const on = picked.includes(r.item_id);
    const full = !on && picked.length >= MAX_EMAIL_QUESTIONS;
    return (
      <button type="button" aria-pressed={on} disabled={full || everything} onClick={() => toggle(r.item_id)}
        className="inline-flex min-h-12 items-center gap-2 rounded-md border border-rule bg-card px-3 text-[15px] font-semibold text-ink hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">
        <span aria-hidden className="font-mono">{on ? "☑" : "☐"}</span> Ask in email
      </button>
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* pb-20 (pb-28 from 640 to 1024 px, where the Operator pill floats): the last "Ask in email" scrolls clear of the pill. */}
      <div className="grid gap-x-8 gap-y-6 px-4 pb-20 pt-4 @2xl/page:px-5 @6xl/page:grid-cols-2 sm:max-lg:pb-28">
        <section aria-labelledby={`${sessionId}-sum`}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <h2 id={`${sessionId}-sum`} className="font-serif text-[22px] font-semibold leading-8 text-ink">{title}</h2>
              {byline.length > 0 && (
                <div className="overflow-hidden">
                  <p className="-ml-4 flex flex-wrap text-meta text-ink-2">
                    {byline.map((part, i) => (
                      <span key={i} className={`relative min-w-0 pl-4 before:absolute before:left-1.5 before:text-ink-3 before:content-['·'] ${i === 0 ? "break-words" : "whitespace-nowrap"}`}>{part}</span>
                    ))}
                  </p>
                </div>
              )}
            </div>
            <Btn onClick={onBackToList}>Back to checklist</Btn>
          </div>
          <p className="mt-1 text-[16px] font-semibold text-ink-2">{c.covered} covered · {c.partial} partly · {c.open} open · {c.not_applicable} N/A</p>

          {everything ? (
            <p className="mt-4 flex items-center gap-2 text-[17px] font-semibold text-ink"><span aria-hidden>✓</span> Everything covered.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {candidates.rows.length > 0 && (
                <p className="text-[15px] text-ink-2" aria-live="polite">Ask up to {MAX_EMAIL_QUESTIONS} in the email · {picked.length} picked</p>
              )}
              {open.length > 0 && (
                <div>
                  <h3 className="text-[15px] font-semibold text-ink-3">Open</h3>
                  <ul className="mt-1 divide-y divide-rule-soft">
                    {open.map((r) => <li key={r.item_id} className="flex flex-wrap items-center justify-between gap-2 py-1"><span className="text-[17px] text-ink">{r.label}</span>{askToggle(r)}</li>)}
                  </ul>
                </div>
              )}
              {partly.length > 0 && (
                <div>
                  <h3 className="text-[15px] font-semibold text-ink-3">Partly</h3>
                  <ul className="mt-1 divide-y divide-rule-soft">
                    {partly.map((r) => (
                      <li key={r.item_id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                        <span className="text-[17px] text-ink">{r.label}{formatValue(r.key, r.value) ? <span className="text-ink-2"> “{formatValue(r.key, r.value)}” — confirm</span> : null}</span>
                        {askToggle(r)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {na.length > 0 && (
                <div>
                  <h3 className="text-[15px] font-semibold text-ink-3">N/A</h3>
                  <ul className="mt-1 space-y-1">{na.map((r) => <li key={r.item_id} className="text-[16px] text-ink">{r.label}{r.reason ? <span className="text-ink-2"> — {r.reason}</span> : null}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          <details className="group mt-5 rounded-md border border-rule-soft bg-card px-3" open={answered.length > 0 && answered.length <= 4}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-[16px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-focus">
              <span aria-hidden className="transition-transform group-open:rotate-90">▸</span> All rows ({rows.length}) <span className="font-normal text-ink-3">· {answered.length === 1 ? "1 answer" : `${answered.length} answers`}</span>
            </summary>
            <ul className="divide-y divide-rule-soft pb-2">
              {rows.map((r) => (
                <li key={r.item_id} className="flex flex-wrap items-center gap-x-3 py-1">
                  <span className="min-w-0 flex-1 basis-48 text-[16px]"><span className="font-semibold text-ink">{r.label}</span> <CoverageMark variant="coverage" state={r.state} size="sm" className="ml-1" />{formatValue(r.key, r.value) ? <span className="block text-ink-2">{formatValue(r.key, r.value)}</span> : null}</span>
                  <Btn kind="ghost" onClick={() => onEditRow(r.item_id)} aria-label={`Edit ${r.label}`}>Edit</Btn>
                </li>
              ))}
            </ul>
          </details>

          {data.notes && (
            <div className="mt-4"><h3 className="text-[15px] font-semibold text-ink-3">Notes</h3><p className="mt-1 whitespace-pre-wrap text-[16px] text-ink">{data.notes}</p></div>
          )}

        </section>

        {!everything && (
          <section aria-labelledby={`${sessionId}-draft`} className="@6xl/page:border-l @6xl/page:border-rule @6xl/page:pl-8">
            <h2 id={`${sessionId}-draft`} className="font-serif text-[20px] font-semibold leading-7 text-ink">Follow-up draft</h2>
            {listed.length > 0 && (
              <ul className="mt-2 space-y-1 text-[15px] text-ink-2">
                {listed.map((d) => <li key={d.id}>Follow-up submitted — {copy.status(d.approval_status)}.</li>)}
              </ul>
            )}
            {!s.lead_id ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[16px]"><span>Link this checklist to a lead first.</span><Btn onClick={onLinkLead}>Link to a lead</Btn></div>
            ) : !email ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[16px]">
                <span className="font-semibold">Confirm their email first</span>
                {lead && onEditLeadEmail && <Btn onClick={() => onEditLeadEmail(lead)}>Add email</Btn>}
              </div>
            ) : staged ? (
              <p role="status" className="mt-3 text-[16px] text-ink">
                {copy.submitted}
                {data.viewer === "owner" && <> <Link href="/today" className="inline-flex min-h-12 items-center font-semibold text-accent-2 underline focus-visible:outline-2 focus-visible:outline-focus">Open Today</Link></>}
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-[16px]"><span className="text-ink-3">To:</span> <span className="break-all font-semibold">{email}</span></p>
                <label className="block"><span className="text-[15px] font-semibold">Subject</span>
                  <input value={subjectText} onChange={(e) => setSubject(e.target.value.replace(/[\r\n]+/g, " "))} className={`${INPUT} min-h-12`} />
                </label>
                {picked.length > 0 && (
                  <div className="rounded-md border border-rule-soft bg-card px-3 py-2">
                    <p className="text-[15px] font-semibold text-ink-3">Questions to ask ({picked.length} of {MAX_EMAIL_QUESTIONS})</p>
                    <ul className="mt-1 space-y-1 text-[16px] text-ink-2">{rows.filter((r) => picked.includes(r.item_id)).map((r) => <li key={r.item_id}>{r.label}{r.question ? ` — “${r.question}”` : ""}</li>)}</ul>
                    <Btn className="mt-2" onClick={addQuestions}>Add these questions to the draft</Btn>
                  </div>
                )}
                <label className="block"><span className="text-[15px] font-semibold">Email</span>
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} maxLength={30000} className={`${INPUT} py-2.5`} />
                </label>
                {draftError && <p role="alert" className="flex items-center gap-1.5 text-[15px] text-flag"><AlertTriangle aria-hidden className="size-4" /> {draftError}</p>}
                <Btn kind="primary" onClick={() => void submit()} disabled={staging} className="w-full @xl/page:w-auto">{staging ? "Submitting…" : "Submit for approval"}</Btn>
                <p className="text-[15px] text-ink-3">{copy.hint}</p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
