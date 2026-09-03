"use client";

import { useState, useTransition } from "react";
import { MessageSquare, Phone, PhoneCall, Send, AlertCircle, ExternalLink, Plus, X, ArrowLeft, Ban, Paperclip } from "lucide-react";
import { Chip } from "@/components/ui";
import {
  loadSmsThread,
  sendSmsReply,
  startSmsThread,
  linkSmsThread,
  unlinkSmsThread,
  setSmsOptOut,
} from "@/lib/actions/sms";
import { placeCallAction } from "@/lib/actions/calls";
import type { SmsThreadSummary, SmsMessage, SmsLinkOptions } from "@/lib/sms";

/** Record path for the "open record" link (link_type → route segment). */
const LINK_ROUTE: Record<string, string> = {
  lead: "leads",
  sub: "subs",
  project: "projects",
  client: "projects",
  vendor: "vendors",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Deterministic timestamp label from an ISO string (UTC parts → no locale, no
 *  hydration mismatch). */
function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} · ${hh}:${mm}`;
}

function threadTitle(t: SmsThreadSummary): string {
  return t.contactName?.trim() || t.phone;
}

export function MessagesClient({
  threads: initialThreads,
  linkOptions,
  configured,
  problems,
  voiceConfigured,
}: {
  threads: SmsThreadSummary[];
  linkOptions: SmsLinkOptions;
  configured: boolean;
  problems: string[];
  voiceConfigured: boolean;
}) {
  const [threads, setThreads] = useState(initialThreads);
  const [selectedId, setSelectedId] = useState<number | null>(initialThreads[0]?.id ?? null);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newBody, setNewBody] = useState("");
  const [composeErr, setComposeErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [dialing, setDialing] = useState(false);
  // On phones the rail + conversation can't sit side by side; show one at a time
  // (opening a thread reveals the conversation, the back button returns to the
  // list). Desktop keeps both panes — this only toggles below `lg`.
  const [mobileThread, setMobileThread] = useState(false);
  const [, start] = useTransition();

  const selected = threads.find((t) => t.id === selectedId) ?? null;

  function openThread(id: number) {
    setSelectedId(id);
    setMobileThread(true);
    setMessages([]);
    setLoading(true);
    setNotice(null);
    // Optimistically clear the unread dot in the rail.
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, unread: false } : t)));
    start(async () => {
      const data = await loadSmsThread(id);
      setMessages(data?.messages ?? []);
      setLoading(false);
    });
  }

  function send() {
    const body = draft.trim();
    if (!body || selectedId == null) return;
    setNotice(null);
    // Optimistic outbound bubble.
    const optimistic: SmsMessage = {
      id: -Date.now(),
      direction: "out",
      body,
      status: "sending",
      createdAt: new Date().toISOString(),
      media: [],
      errorDetail: null,
      failureKind: null,
      keyword: null,
      sentBy: "owner",
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    start(async () => {
      const res = await sendSmsReply(selectedId, body);
      const data = await loadSmsThread(selectedId);
      setMessages(data?.messages ?? []);
      if (!res.ok) {
        setDraft(body);
        setNotice(res.error ?? "Could not send.");
      }
    });
  }

  function changeLink(id: number, value: string) {
    // value is "" (unlink) or "<type>:<slug>".
    const [type, slug] = value ? value.split(":") : ["", ""];
    setThreads((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, linkType: (type || null) as SmsThreadSummary["linkType"], linkSlug: slug || null }
          : t,
      ),
    );
    start(async () => {
      if (value) await linkSmsThread(id, type, slug);
      else await unlinkSmsThread(id);
    });
  }

  function toggleOptOut(t: SmsThreadSummary) {
    const next = !t.optedOut;
    if (next && !confirm(`Mark ${threadTitle(t)} as opted out? The OS will refuse to text them until they send START (or you undo this).`)) return;
    setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, optedOut: next, optedOutAt: next ? new Date().toISOString() : null } : x)));
    start(async () => {
      await setSmsOptOut(t.id, next);
    });
  }

  function callSelected() {
    if (!selected || dialing) return;
    setDialing(true);
    setNotice(null);
    start(async () => {
      const r = await placeCallAction(selected.phone, selected.contactName);
      setDialing(false);
      setNotice(r.ok ? "Calling: your cell rings first, then the OS dials them and connects you. Notes land on /calls." : r.error ?? "Could not place the call.");
    });
  }

  function startNew() {
    if (sending) return;
    setComposeErr(null);
    setSending(true);
    start(async () => {
      const res = await startSmsThread(newPhone, newBody, newName);
      setSending(false);
      if (res.threadId != null) {
        const id = res.threadId;
        // Add the thread to the rail if it's new, then open it.
        setThreads((prev) =>
          prev.some((t) => t.id === id)
            ? prev
            : [
                {
                  id,
                  phone: newPhone.trim(),
                  contactName: newName.trim() || null,
                  linkType: null,
                  linkSlug: null,
                  unread: false,
                  lastMessageAt: new Date().toISOString(),
                  optedOut: false,
                  optedOutAt: null,
                },
                ...prev,
              ],
        );
        setComposeOpen(false);
        setNewPhone("");
        setNewName("");
        setNewBody("");
        openThread(id);
        if (!res.ok) setNotice(res.error ?? "Could not send.");
      } else {
        setComposeErr(res.error ?? "Could not start the conversation.");
      }
    });
  }

  const composerDisabled = !configured || Boolean(selected?.optedOut);

  return (
    <div className="flex h-full">
      {/* Thread rail */}
      <aside
        className={`w-full flex-none flex-col border-r border-rule bg-paper-2 lg:w-[300px] ${
          mobileThread ? "hidden lg:flex" : "flex"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
          <MessageSquare className="size-4 text-ink-3" strokeWidth={1.5} />
          <span className="flex-1 font-serif text-[15px] font-semibold text-ink">Text messages</span>
          <button
            type="button"
            onClick={() => {
              setComposeErr(null);
              setComposeOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2 py-1 text-[11px] font-semibold text-paper hover:bg-[#232a1e]"
          >
            <Plus className="size-3" strokeWidth={2} /> New
          </button>
        </div>

        {!configured && (
          <div className="m-3 rounded-lg border border-dashed border-rule bg-paper px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
              <AlertCircle className="size-3.5 text-flag" strokeWidth={1.5} /> SMS not connected
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
              {problems.length
                ? problems.join("; ")
                : "Texting runs on Telnyx. Set the SMS_* env vars and restart to go live — see docs/comms.md. Outbound texts also wait on 10DLC campaign approval (scripts/register-10dlc.mjs)."}
            </p>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px] text-ink-3">
              No conversations yet. Inbound texts to the business number appear here.
            </div>
          ) : (
            threads.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => openThread(t.id)}
                className={`flex w-full items-start gap-2.5 border-b border-rule-soft px-4 py-3 text-left transition-colors hover:bg-paper ${
                  t.id === selectedId ? "bg-paper" : ""
                }`}
              >
                <span
                  className={`mt-1 size-2 flex-none rounded-full ${t.unread ? "bg-accent" : "bg-transparent"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`truncate text-[13px] ${t.unread ? "font-semibold text-ink" : "text-ink-2"}`}>
                      {threadTitle(t)}
                    </span>
                    {t.linkType && <Chip kind="ghost">{t.linkType}</Chip>}
                    {t.optedOut && <Chip kind="flag">opted out</Chip>}
                  </div>
                  <div className="font-mono text-[10px] text-ink-3">{fmtWhen(t.lastMessageAt)}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Conversation */}
      <section
        className={`min-w-0 flex-1 flex-col ${mobileThread ? "flex" : "hidden lg:flex"}`}
      >
        {selected ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-3">
              <button
                type="button"
                onClick={() => setMobileThread(false)}
                aria-label="Back to conversations"
                className="-ml-1 inline-flex size-7 flex-none items-center justify-center rounded-md text-ink-2 hover:bg-black/5 lg:hidden"
              >
                <ArrowLeft className="size-4" strokeWidth={1.5} />
              </button>
              <Phone className="size-3.5 text-ink-3" strokeWidth={1.5} />
              <span className="font-serif text-[15px] font-semibold text-ink">{threadTitle(selected)}</span>
              <span className="font-mono text-[11px] text-ink-3">{selected.phone}</span>
              {selected.optedOut && (
                <Chip kind="flag">opted out{selected.optedOutAt ? ` ${selected.optedOutAt.slice(0, 10)}` : ""}</Chip>
              )}

              <div className="ml-auto flex items-center gap-1.5">
                {voiceConfigured && (
                  <button
                    type="button"
                    onClick={callSelected}
                    disabled={dialing}
                    title="Ring my cell, then call them"
                    className="inline-flex items-center gap-1 rounded-md border border-rule bg-paper px-2 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
                  >
                    <PhoneCall className="size-3.5" strokeWidth={1.5} /> {dialing ? "Ringing…" : "Call"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleOptOut(selected)}
                  title={selected.optedOut ? "Clear the local opt-out (they asked in person)" : "Mark as opted out"}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] ${
                    selected.optedOut ? "border-flag text-flag hover:bg-flag-soft" : "border-rule text-ink-3 hover:bg-paper-2"
                  }`}
                >
                  <Ban className="size-3.5" strokeWidth={1.5} /> {selected.optedOut ? "Opt back in" : "Opt out"}
                </button>
                <span className="hidden font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3 sm:inline">Linked to</span>
                <select
                  value={selected.linkType && selected.linkSlug ? `${selected.linkType}:${selected.linkSlug}` : ""}
                  onChange={(e) => changeLink(selected.id, e.target.value)}
                  className="max-w-[180px] rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
                >
                  <option value="">Not linked</option>
                  {linkOptions.leads.length > 0 && (
                    <optgroup label="Leads">
                      {linkOptions.leads.map((o) => (
                        <option key={`lead:${o.slug}`} value={`lead:${o.slug}`}>{o.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {linkOptions.subs.length > 0 && (
                    <optgroup label="Subs">
                      {linkOptions.subs.map((o) => (
                        <option key={`sub:${o.slug}`} value={`sub:${o.slug}`}>{o.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {linkOptions.projects.length > 0 && (
                    <optgroup label="Projects">
                      {linkOptions.projects.map((o) => (
                        <option key={`project:${o.slug}`} value={`project:${o.slug}`}>{o.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {linkOptions.vendors.length > 0 && (
                    <optgroup label="Vendors">
                      {linkOptions.vendors.map((o) => (
                        <option key={`vendor:${o.slug}`} value={`vendor:${o.slug}`}>{o.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {selected.linkType && selected.linkSlug && LINK_ROUTE[selected.linkType] && (
                  <a
                    href={`/${LINK_ROUTE[selected.linkType]}/${selected.linkSlug}`}
                    className="inline-flex items-center text-ink-3 hover:text-ink"
                    aria-label="Open linked record"
                  >
                    <ExternalLink className="size-3.5" strokeWidth={1.5} />
                  </a>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-paper-2 px-5 py-4">
              {loading ? (
                <div className="py-10 text-center text-[12px] text-ink-3">Loading…</div>
              ) : messages.length === 0 ? (
                <div className="py-10 text-center text-[12px] text-ink-3">No messages in this thread yet.</div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[68%] rounded-2xl px-3.5 py-2 text-[13px] ${
                        m.direction === "out"
                          ? m.status === "failed"
                            ? "rounded-br-sm border border-flag/50 bg-flag-soft text-ink"
                            : "rounded-br-sm bg-accent text-white"
                          : "rounded-bl-sm border border-rule bg-card text-ink"
                      }`}
                    >
                      {m.media.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-1.5">
                          {m.media.map((a) =>
                            a.mime.startsWith("image/") ? (
                              <a key={a.file_id} href={`/api/files/${a.file_id}`} target="_blank" rel="noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={`/api/files/${a.file_id}?w=320`} alt={a.name} className="max-h-48 rounded-lg" />
                              </a>
                            ) : (
                              <a key={a.file_id} href={`/api/files/${a.file_id}?download=1`} className="inline-flex items-center gap-1 rounded-md border border-rule bg-paper px-2 py-1 text-[11px] text-ink-2">
                                <Paperclip className="size-3" strokeWidth={1.5} /> {a.name}
                              </a>
                            ),
                          )}
                        </div>
                      )}
                      {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                      <div
                        className={`mt-0.5 font-mono text-[9px] ${
                          m.direction === "out" && m.status !== "failed" ? "text-white/70" : "text-ink-3"
                        }`}
                      >
                        {fmtWhen(m.createdAt)}
                        {m.keyword && ` · ${m.keyword.replace("_", " ")}`}
                        {m.sentBy === "system:help" && " · auto-reply"}
                        {m.direction === "out" && m.status !== "sent" && m.status !== "delivered" && ` · ${m.status}`}
                      </div>
                      {m.direction === "out" && m.status === "failed" && m.errorDetail && (
                        <div className="mt-1 text-[11px] text-flag">{m.errorDetail}</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {notice && (
              <div className="border-t border-rule bg-flag-soft px-5 py-2 text-[12px] text-flag">{notice}</div>
            )}
            {selected.optedOut && (
              <div className="border-t border-rule bg-paper-2 px-5 py-2 text-[12px] text-ink-2">
                <Ban className="mr-1 inline size-3.5 text-flag" strokeWidth={1.5} />
                {threadTitle(selected)} opted out (STOP). The OS will not text them until they send START. Calling is still fine.
              </div>
            )}

            {/* Composer */}
            <div className="flex items-end gap-2 border-t border-rule px-5 py-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder={!configured ? "SMS not connected" : selected.optedOut ? "Contact opted out — texting blocked" : "Type a text…"}
                disabled={composerDisabled}
                className="max-h-32 min-h-[38px] flex-1 resize-y rounded-lg border border-rule bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent disabled:bg-paper-2 disabled:text-ink-3"
              />
              <button
                type="button"
                onClick={send}
                disabled={composerDisabled || !draft.trim()}
                className="inline-flex h-[38px] flex-none items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-2 disabled:opacity-50"
              >
                <Send className="size-3.5" strokeWidth={1.5} /> Send
              </button>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <MessageSquare className="size-8 text-ink-4" strokeWidth={1.25} />
            <div className="text-[13px] text-ink-3">
              {threads.length === 0
                ? "No conversations yet."
                : "Select a conversation to view it."}
            </div>
          </div>
        )}
      </section>

      {/* New-message compose modal */}
      {composeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4"
          onClick={() => !sending && setComposeOpen(false)}
        >
          <div
            className="w-full max-w-[420px] rounded-xl border border-rule bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <h2 className="flex-1 font-serif text-[17px] font-semibold text-ink">New text message</h2>
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                className="text-ink-3 hover:text-ink"
                aria-label="Close"
              >
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>

            {!configured && (
              <div className="mt-3 flex items-start gap-1.5 rounded-md border border-dashed border-rule bg-paper px-2.5 py-2 text-[11px] text-ink-3">
                <AlertCircle className="mt-0.5 size-3.5 flex-none text-flag" strokeWidth={1.5} />
                SMS is not connected. You can compose now, but sending is disabled until Telnyx is configured.
              </div>
            )}

            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">To · phone</label>
                <input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+16125551234"
                  className="mt-1 w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 font-mono text-[13px] text-ink outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                  Contact name · optional
                </label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Marco (framing)"
                  className="mt-1 w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Message</label>
                <textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  rows={3}
                  placeholder="Type your text… (first contact: end with 'Reply STOP to opt out')"
                  className="mt-1 w-full resize-y rounded-md border border-rule bg-paper px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent"
                />
              </div>
            </div>

            {composeErr && <p className="mt-2 text-[12px] text-flag">{composeErr}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:bg-paper-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={startNew}
                disabled={!configured || sending || !newPhone.trim() || !newBody.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-50"
              >
                <Send className="size-3.5" strokeWidth={1.5} /> {sending ? "Sending…" : "Send text"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
