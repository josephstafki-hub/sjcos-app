"use client";

import { useEffect, useState, useTransition } from "react";
import { PhoneCall, PhoneIncoming, PhoneOutgoing, Voicemail, AlertCircle, ExternalLink, Plus, X, ArrowLeft, FileText } from "lucide-react";
import { Chip } from "@/components/ui";
import { loadCall, placeCallAction, type CallDetail } from "@/lib/actions/calls";
import type { CallRow } from "@/lib/voice";

const LINK_ROUTE: Record<string, string> = { lead: "leads", sub: "subs", project: "projects", client: "projects", vendor: "vendors" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} · ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function fmtDuration(s: number | null): string {
  if (s == null) return "";
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

function name(c: CallRow): string {
  return c.contact_name?.trim() || c.counterparty_number;
}

const OUTCOME_LABEL: Record<string, string> = {
  answered: "Answered",
  voicemail: "Voicemail",
  missed: "Missed",
  no_answer: "No answer",
  failed: "Failed",
};

function OutcomeChip({ c }: { c: CallRow }) {
  if (!c.ended) return <Chip kind="accent">{c.status === "bridged" ? "On the line" : c.status === "voicemail" ? "Recording voicemail" : "Ringing"}</Chip>;
  const o = c.outcome ?? c.status;
  const kind = o === "answered" ? "ghost" : o === "voicemail" || o === "missed" ? "flag" : "ghost";
  return <Chip kind={kind}>{OUTCOME_LABEL[o] ?? o}</Chip>;
}

function DirIcon({ c }: { c: CallRow }) {
  if (c.outcome === "voicemail") return <Voicemail className="size-3.5 text-flag" strokeWidth={1.5} />;
  if (c.direction === "inbound") return <PhoneIncoming className="size-3.5 text-ink-3" strokeWidth={1.5} />;
  return <PhoneOutgoing className="size-3.5 text-ink-3" strokeWidth={1.5} />;
}

export function CallsClient({
  calls,
  configured,
  problems,
  openId,
}: {
  calls: CallRow[];
  configured: boolean;
  problems: string[];
  openId: string | null;
}) {
  const initialId = openId ?? calls[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [mobileDetail, setMobileDetail] = useState(Boolean(openId));
  const [composeOpen, setComposeOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [composeErr, setComposeErr] = useState<string | null>(null);
  const [dialing, setDialing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [loading, start] = useTransition();

  // Fetch the detail (events, transcript) for whichever call is selected.
  // State only changes inside the async transition, never synchronously in
  // the effect body.
  useEffect(() => {
    if (!selectedId) return;
    const id = selectedId;
    start(async () => {
      const d = await loadCall(id);
      setDetail((prev) => (prev?.call.id === id && !d ? prev : d));
    });
  }, [selectedId]);

  function open(id: string) {
    setSelectedId(id);
    setMobileDetail(true);
    setNotice(null);
    setShowTranscript(false);
  }

  function dial() {
    if (dialing) return;
    setComposeErr(null);
    setDialing(true);
    start(async () => {
      const r = await placeCallAction(newPhone, newName);
      setDialing(false);
      if (r.ok && r.callId) {
        setComposeOpen(false);
        setNewPhone("");
        setNewName("");
        setNotice("Your cell is ringing. Pick up, and the OS will dial them and connect you.");
        setSelectedId(r.callId);
        setMobileDetail(true);
      } else {
        setComposeErr(r.error ?? "Could not place the call.");
      }
    });
  }

  // Only trust `detail` once it belongs to the selected call; until then show
  // the list row so switching calls never shows the previous call's notes.
  const current = detail && detail.call.id === selectedId ? detail : null;
  const c = current?.call ?? calls.find((x) => x.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <aside className={`w-full flex-none flex-col border-r border-rule bg-paper-2 lg:w-[320px] ${mobileDetail ? "hidden lg:flex" : "flex"}`}>
        <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
          <PhoneCall className="size-4 text-ink-3" strokeWidth={1.5} />
          <span className="flex-1 font-serif text-[15px] font-semibold text-ink">Calls</span>
          <button
            type="button"
            onClick={() => {
              setComposeErr(null);
              setComposeOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2 py-1 text-[11px] font-semibold text-paper hover:bg-[#232a1e]"
          >
            <Plus className="size-3" strokeWidth={2} /> Call
          </button>
        </div>

        {!configured && (
          <div className="m-3 rounded-lg border border-dashed border-rule bg-paper px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
              <AlertCircle className="size-3.5 text-flag" strokeWidth={1.5} /> Voice not connected
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
              {problems.length ? problems.join("; ") : "Set the VOICE_* env vars (see docs/comms.md) and restart to forward calls to your cell, record, and take notes."}
            </p>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {calls.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px] text-ink-3">No calls yet. Inbound calls to the business number land here.</div>
          ) : (
            calls.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => open(x.id)}
                className={`flex w-full items-start gap-2.5 border-b border-rule-soft px-4 py-3 text-left transition-colors hover:bg-paper ${x.id === selectedId ? "bg-paper" : ""}`}
              >
                <span className="mt-1"><DirIcon c={x} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`truncate text-[13px] ${x.outcome === "voicemail" || x.outcome === "missed" ? "font-semibold text-ink" : "text-ink-2"}`}>{name(x)}</span>
                    {x.link_type && <Chip kind="ghost">{x.link_type}</Chip>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-ink-3">
                    <span>{fmtWhen(x.started_at)}</span>
                    {x.duration_s != null && x.outcome === "answered" && <span>{fmtDuration(x.duration_s)}</span>}
                    <OutcomeChip c={x} />
                    {x.notes_status === "done" && <FileText className="size-3 text-accent" strokeWidth={1.5} />}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className={`min-w-0 flex-1 flex-col ${mobileDetail ? "flex" : "hidden lg:flex"}`}>
        {c ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-3">
              <button type="button" onClick={() => setMobileDetail(false)} aria-label="Back" className="-ml-1 inline-flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-black/5 lg:hidden">
                <ArrowLeft className="size-4" strokeWidth={1.5} />
              </button>
              <DirIcon c={c} />
              <span className="font-serif text-[15px] font-semibold text-ink">{name(c)}</span>
              <span className="font-mono text-[11px] text-ink-3">{c.counterparty_number}</span>
              <OutcomeChip c={c} />
              <div className="ml-auto flex items-center gap-2">
                {c.link_type && c.link_slug && LINK_ROUTE[c.link_type] && (
                  <a href={`/${LINK_ROUTE[c.link_type]}/${c.link_slug}`} className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
                    <ExternalLink className="size-3.5" strokeWidth={1.5} /> {c.link_type}
                  </a>
                )}
                <button
                  type="button"
                  disabled={!configured || dialing}
                  onClick={() => {
                    setNewPhone(c.counterparty_number);
                    setNewName(c.contact_name ?? "");
                    setComposeErr(null);
                    setComposeOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-50"
                >
                  <PhoneCall className="size-3.5" strokeWidth={1.5} /> Call back
                </button>
              </div>
            </div>

            {notice && <div className="border-b border-rule bg-paper-2 px-5 py-2 text-[12px] text-ink-2">{notice}</div>}

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-paper-2 px-5 py-4">
              {loading && !current ? (
                <div className="py-10 text-center text-[12px] text-ink-3">Loading…</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-ink-2 sm:grid-cols-4">
                    <div><span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Started</span><div>{fmtWhen(c.started_at)}</div></div>
                    <div><span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Duration</span><div>{fmtDuration(c.duration_s) || "—"}</div></div>
                    <div><span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Direction</span><div>{c.direction}{c.placed_by ? ` · ${c.placed_by}` : ""}</div></div>
                    <div><span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Recording</span><div>{c.recording_status}</div></div>
                  </div>

                  {c.error && (
                    <div className="flex items-start gap-1.5 rounded-md border border-flag/40 bg-flag-soft px-3 py-2 text-[12px] text-flag">
                      <AlertCircle className="mt-0.5 size-3.5 flex-none" strokeWidth={1.5} /> {c.error}
                    </div>
                  )}

                  {c.recording_file_id && (
                    <div className="rounded-lg border border-rule bg-card p-3">
                      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Recording</div>
                      <audio controls preload="none" src={`/api/files/${c.recording_file_id}`} className="w-full" />
                    </div>
                  )}

                  <div className="rounded-lg border border-rule bg-card p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <FileText className="size-4 text-accent" strokeWidth={1.5} />
                      <span className="font-serif text-[14px] font-semibold text-ink">Call notes</span>
                      <Chip kind="ghost">{c.notes_status}</Chip>
                    </div>
                    {c.notes ? (
                      <div className="space-y-3 text-[13px] text-ink">
                        <p className="leading-relaxed">{c.notes.summary}</p>
                        {c.notes.flags.length > 0 && (
                          <div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-flag">Flags</div>
                            <ul className="mt-1 space-y-1">
                              {c.notes.flags.map((f, i) => (
                                <li key={i} className="flex gap-2"><Chip kind="flag">{f.kind.replace("_", " ")}</Chip><span>{f.text}</span></li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {c.notes.decisions.length > 0 && (
                          <div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Decisions · commitments</div>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5">
                              {c.notes.decisions.map((d, i) => <li key={i}>{d.text} <span className="text-ink-3">({d.by})</span></li>)}
                            </ul>
                          </div>
                        )}
                        {c.notes.action_items.length > 0 && (
                          <div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Action items</div>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5">
                              {c.notes.action_items.map((a, i) => <li key={i}>{a.text} <span className="text-ink-3">— {a.owner}{a.due ? `, ${a.due}` : ""}</span></li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-[12px] text-ink-3">
                        {c.notes_status === "pending" ? "Being written…" : c.notes_status === "failed" ? `Failed: ${c.notes_error ?? "unknown"}` : c.notes_status === "skipped" ? `Skipped${c.notes_error ? ` (${c.notes_error})` : ""}.` : c.transcript_status === "pending" ? "Waiting for the transcript." : "No notes yet."}
                      </p>
                    )}
                  </div>

                  {c.transcript && (
                    <div className="rounded-lg border border-rule bg-card p-4">
                      <button type="button" onClick={() => setShowTranscript((v) => !v)} className="flex w-full items-center gap-2 text-left">
                        <span className="font-serif text-[14px] font-semibold text-ink">Transcript</span>
                        <span className="font-mono text-[10px] text-ink-3">{showTranscript ? "hide" : "show"}</span>
                      </button>
                      {showTranscript && <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-ink-2">{c.transcript}</pre>}
                    </div>
                  )}

                  {current?.events.length ? (
                    <div className="rounded-lg border border-rule bg-card p-4">
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Timeline</div>
                      <ul className="space-y-0.5 font-mono text-[11px] text-ink-3">
                        {current.events.map((e, i) => (
                          <li key={i}><span className="text-ink-2">{fmtWhen(e.occurred_at ?? e.created_at)}</span> · {e.event_type} — {e.note}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <PhoneCall className="size-8 text-ink-4" strokeWidth={1.25} />
            <div className="text-[13px] text-ink-3">{calls.length === 0 ? "No calls yet." : "Select a call to view it."}</div>
          </div>
        )}
      </section>

      {composeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4" onClick={() => !dialing && setComposeOpen(false)}>
          <div className="w-full max-w-[420px] rounded-xl border border-rule bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h2 className="flex-1 font-serif text-[17px] font-semibold text-ink">Place a call</h2>
              <button type="button" onClick={() => setComposeOpen(false)} className="text-ink-3 hover:text-ink" aria-label="Close"><X className="size-4" strokeWidth={1.5} /></button>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              Your cell rings first. When you pick up, the OS dials them and connects you. The call is recorded and transcribed, and notes land on the record.
            </p>
            {!configured && (
              <div className="mt-3 flex items-start gap-1.5 rounded-md border border-dashed border-rule bg-paper px-2.5 py-2 text-[11px] text-ink-3">
                <AlertCircle className="mt-0.5 size-3.5 flex-none text-flag" strokeWidth={1.5} /> Voice is not connected — dialing is disabled.
              </div>
            )}
            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Number</label>
                <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="+16125551234" className="mt-1 w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 font-mono text-[13px] text-ink outline-none focus:border-accent" />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Who · optional</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Dave (Butler St)" className="mt-1 w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent" />
              </div>
            </div>
            {composeErr && <p className="mt-2 text-[12px] text-flag">{composeErr}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setComposeOpen(false)} className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:bg-paper-2">Cancel</button>
              <button type="button" onClick={dial} disabled={!configured || dialing || !newPhone.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-50">
                <PhoneCall className="size-3.5" strokeWidth={1.5} /> {dialing ? "Ringing your cell…" : "Ring my cell, then call"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
