"use client";

import { useState, useTransition } from "react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import { startTimerAction, stopTimerAction, correctIntervalAction, confirmClockInAction, clockOutAction } from "@/lib/owner-time/actions";
import type { ReviewList, TimeInterval } from "@/lib/owner-time/intervals";

type Category = "site" | "design" | "estimating" | "admin" | "other";
const CATEGORIES: Category[] = ["site", "design", "estimating", "admin", "other"];
const btn = "rounded-md border border-ink-4 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40";
const input = "rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent";

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const when = (iso: string | null) => (iso ? fmt.format(new Date(iso)) : "—");
const dur = (i: TimeInterval) => {
  const end = i.end_at ? Date.parse(i.end_at) : Date.now();
  return `${((end - Date.parse(i.start_at)) / 3600_000).toFixed(2)} h${i.end_at ? "" : " (running)"}`;
};
const toLocalInput = (iso: string) => new Date(iso).toISOString().slice(0, 16);

export function TimeReview({ review, projects, rates, from, to }: { review: ReviewList & { running: TimeInterval | null }; projects: { id: string; name: string; slug: string }[]; rates: { category: string; rate_cents: number; effective_from: string }[]; from: string; to: string }) {
  const [pending, start] = useTransition();
  const [projectId, setProjectId] = useState<string>("");
  const [category, setCategory] = useState<Category>("site");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ startAt: string; endAt: string; projectId: string; category: Category; note: string }>({ startAt: "", endAt: "", projectId: "", category: "site", note: "" });
  const name = (id: string | null) => projects.find((p) => p.id === id)?.name ?? (id ? "(other job)" : "no job");
  const flagsFor = (id: string) => review.flags.filter((f) => f.intervalId === id);
  const act = (fn: () => Promise<{ ok: boolean; error?: string } | void>) => start(async () => { await runAction(fn); });

  return (
    <div className="flex flex-col gap-6">
      <Card kind="soft" className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {review.running ? (
            <>
              <Chip kind="money">running</Chip>
              <span>{name(review.running.project_id)} · {review.running.category} · since {when(review.running.start_at)}</span>
              <button className={btn} disabled={pending} onClick={() => act(() => stopTimerAction())}>Stop</button>
            </>
          ) : (
            <>
              <Eyebrow>Manual timer</Eyebrow>
              <select className={input} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">no job (overhead)</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className={input} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input className={`${input} w-56`} placeholder="what (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className={btn} disabled={pending} onClick={() => act(() => startTimerAction(projectId || null, category, note))}>Start</button>
            </>
          )}
          <span className="ml-auto text-[12px] text-ink-3">{when(from)} → {when(to)}</span>
        </div>
      </Card>

      <section>
        <Eyebrow>Intervals</Eyebrow>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-3">Start</th><th className="py-2 pr-3">End</th><th className="py-2 pr-3">Job</th><th className="py-2 pr-3">Category</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">State</th><th className="py-2 pr-3">Hours</th><th className="py-2 pr-3">Flags</th><th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {review.intervals.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-ink-3">No time recorded in this range.</td></tr>}
              {review.intervals.map((i) => (
                <tr key={i.id} className="border-b border-rule/60 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{when(i.start_at)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{when(i.end_at)}{i.suggested_end_at && !i.end_at ? <span className="text-ink-3"> (suggested {when(i.suggested_end_at)})</span> : null}</td>
                  <td className="py-2 pr-3">{name(i.project_id)}{i.choices?.length ? <span className="text-ink-3"> · {i.choices.length} nearby</span> : null}</td>
                  <td className="py-2 pr-3">{i.category}</td>
                  <td className="py-2 pr-3 text-ink-3">{i.source}</td>
                  <td className="py-2 pr-3"><Chip kind={i.state === "confirmed" ? "money" : "ghost"}>{i.state}</Chip>{i.review_reason ? <div className="text-[11px] text-ink-3">{i.review_reason}</div> : null}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{dur(i)}</td>
                  <td className="py-2 pr-3 text-[11px] text-ink-3">{flagsFor(i.id).map((f) => <div key={f.flag}>{f.flag}: {f.detail}</div>)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {editing === i.id ? (
                      <div className="flex flex-col gap-1">
                        <input type="datetime-local" className={input} value={edit.startAt} onChange={(e) => setEdit({ ...edit, startAt: e.target.value })} />
                        <input type="datetime-local" className={input} value={edit.endAt} onChange={(e) => setEdit({ ...edit, endAt: e.target.value })} />
                        <select className={input} value={edit.projectId} onChange={(e) => setEdit({ ...edit, projectId: e.target.value })}>
                          <option value="">no job</option>
                          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <select className={input} value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as Category })}>
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input className={input} placeholder="why" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
                        <div className="flex gap-1">
                          <button className={btn} disabled={pending} onClick={() => act(async () => { const r = await correctIntervalAction(i.id, { startAt: new Date(edit.startAt).toISOString(), endAt: edit.endAt ? new Date(edit.endAt).toISOString() : null, projectId: edit.projectId || null, category: edit.category, state: "confirmed", note: edit.note }); if (r.ok) setEditing(null); return r; })}>Save</button>
                          <button className={btn} onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {i.state === "inferred" && i.source === "geofence_prompt" && !i.end_at && (
                          <button className={btn} disabled={pending || (i.choices.length > 1 && !i.project_id)} title={i.choices.length > 1 ? "Pick the job first (Adjust)" : "Confirm you were at this job"} onClick={() => act(() => confirmClockInAction(i.id, i.project_id))}>Clock in</button>
                        )}
                        {i.state === "confirmed" && !i.end_at && i.source !== "designer_activity" && (
                          <button className={btn} disabled={pending} onClick={() => act(() => clockOutAction(i.id, Boolean(i.suggested_end_at)))}>Clock out</button>
                        )}
                        {(i.state === "inferred" || i.state === "review") && (
                          <button className={btn} disabled={pending} onClick={() => act(() => correctIntervalAction(i.id, { state: "confirmed", note: "kept" }))}>Keep</button>
                        )}
                        <button className={btn} onClick={() => { setEditing(i.id); setEdit({ startAt: toLocalInput(i.start_at), endAt: i.end_at ? toLocalInput(i.end_at) : "", projectId: i.project_id ?? "", category: i.category, note: "" }); }}>Adjust</button>
                        {i.state !== "discarded" && (
                          <button className={btn} disabled={pending} onClick={() => act(() => correctIntervalAction(i.id, { state: "discarded", note: "discarded in review" }))}>Discard</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <Eyebrow>Owner labor rates (internal valuation only)</Eyebrow>
        <Card kind="soft" className="mt-2 px-4 py-3 text-[12px] leading-relaxed text-ink-3">
          {rates.length === 0
            ? "No approved rate yet — hours are captured and shown, but every job reads “cost not configured”. A rate is set through a markup decision (ask in the Ask window: “set my site rate to …”), never guessed."
            : rates.map((r) => `${r.category}: $${(r.rate_cents / 100).toFixed(2)}/h from ${r.effective_from}`).join(" · ")}
        </Card>
      </section>
    </div>
  );
}
