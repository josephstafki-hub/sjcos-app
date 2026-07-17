"use client";

import { useState, useTransition } from "react";
import { Plus, Sparkles, Trash2, X, Send, Users, Mail, Download, Check, Inbox, SkipForward } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { AI_NAME } from "@/lib/ai-name";
import { NEWSLETTER_TEMPLATES } from "@/lib/newsletter-templates";
import {
  createIssue,
  saveIssue,
  deleteIssue,
  draftIntro,
  draftBlockForProject,
  addRecipient,
  removeRecipient,
  importClientRecipients,
  queueIssue,
  releaseNewsletterItem,
  skipNewsletterItem,
  refreshOutbox,
} from "@/lib/actions/newsletter";
import type { NewsletterData, NewsletterIssue, NewsletterBlock, Recipient, OutboxItem } from "@/lib/newsletter";

type Mode = "Edit" | "Preview" | "Recipients" | "Outbox";

function monthTitle(): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
}

export function NewsletterClient({ data }: { data: NewsletterData }) {
  const [issues, setIssues] = useState<NewsletterIssue[]>(data.issues);
  const [recipients, setRecipients] = useState<Recipient[]>(data.recipients);
  const [outbox, setOutbox] = useState<OutboxItem[]>(data.outbox);
  const [selectedId, setSelectedId] = useState<number | null>(data.selectedId);
  const [mode, setMode] = useState<Mode>("Edit");
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();

  const current = issues.find((i) => i.id === selectedId) ?? null;
  const sent = current?.status === "sent";
  const locked = current?.status === "sent" || current?.status === "queued"; // no editing once queued
  const activeCount = recipients.filter((r) => r.active).length;
  const queuedCount = outbox.filter((o) => o.status === "queued").length;

  function patchCurrent(patch: Partial<NewsletterIssue>) {
    if (selectedId == null) return;
    setIssues((prev) => prev.map((i) => (i.id === selectedId ? { ...i, ...patch } : i)));
  }
  function patchBlocks(fn: (b: NewsletterBlock[]) => NewsletterBlock[]) {
    if (!current) return;
    patchCurrent({ blocks: fn(current.blocks) });
  }

  function newIssue(templateKey: string) {
    setPicking(false);
    const tpl = NEWSLETTER_TEMPLATES.find((t) => t.key === templateKey) ?? NEWSLETTER_TEMPLATES[0];
    start(async () => {
      const id = await createIssue(tpl.key);
      setIssues((prev) => [
        {
          id,
          title: monthTitle(),
          intro: tpl.starterIntro,
          blocks: tpl.starterBlocks.map((b) => ({ ...b })),
          template: tpl.key,
          status: "draft",
          recipientCount: 0,
          sentLabel: null,
          createdLabel: "just now",
        },
        ...prev,
      ]);
      setSelectedId(id);
      setMode("Edit");
    });
  }

  function save() {
    if (!current) return;
    setNotice(null);
    start(async () => {
      const res = await saveIssue(current.id, current.title, current.intro, current.blocks);
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } else setNotice(res.error);
    });
  }

  function removeIssue(id: number) {
    if (!confirm("Delete this draft issue?")) return;
    start(async () => {
      await deleteIssue(id);
      setIssues((prev) => prev.filter((i) => i.id !== id));
      if (selectedId === id) setSelectedId(issues.find((i) => i.id !== id)?.id ?? null);
    });
  }

  function draftTheIntro() {
    if (!current) return;
    setNotice(null);
    start(async () => {
      const res = await draftIntro(current.id);
      if (res.ok && res.data) patchCurrent({ intro: res.data });
      else setNotice(res.ok ? "No draft returned." : res.error);
    });
  }

  function addJobBlock(slug: string) {
    if (!slug) return;
    setNotice(null);
    start(async () => {
      const res = await draftBlockForProject(slug);
      if (res.ok && res.data) patchBlocks((b) => [...b, res.data!]);
      else setNotice(res.ok ? "No draft returned." : res.error);
    });
  }

  function queue() {
    if (!current) return;
    if (
      !confirm(
        `Queue "${current.title}" for ${activeCount} recipient${activeCount === 1 ? "" : "s"}?\n\n` +
          `Nothing is emailed yet — each message waits in the Outbox until you Release it.`,
      )
    )
      return;
    setNotice(null);
    start(async () => {
      const res = await queueIssue(current.id);
      if (res.ok) {
        patchCurrent({ status: "queued" });
        setMode("Outbox");
        setNotice(`Queued ${res.data?.queued ?? 0} message(s). Release them below when you're ready.`);
        // Pull the real persisted rows (with real ids) so Release is enabled.
        setOutbox(await refreshOutbox());
      } else setNotice(res.error);
    });
  }

  function releaseItem(item: OutboxItem) {
    if (!confirm(`Release now? This emails ${item.email} for real via Gmail.`)) return;
    setNotice(null);
    start(async () => {
      const res = await releaseNewsletterItem(item.id);
      if (res.ok) {
        setOutbox(await refreshOutbox());
      } else {
        setNotice(res.error ?? "Release failed.");
        setOutbox(await refreshOutbox());
      }
    });
  }
  function skipItem(item: OutboxItem) {
    setOutbox((prev) => prev.map((o) => (o.id === item.id ? { ...o, status: "skipped" } : o)));
    start(async () => {
      await skipNewsletterItem(item.id);
      setOutbox(await refreshOutbox());
    });
  }

  // ── Recipients ──
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  function addRcpt() {
    const email = newEmail.trim();
    if (!email) return;
    start(async () => {
      const res = await addRecipient(email, newName);
      if (res.ok) {
        setRecipients((prev) =>
          prev.some((r) => r.email === email.toLowerCase())
            ? prev
            : [...prev, { id: -Date.now(), email: email.toLowerCase(), name: newName.trim(), active: true }],
        );
        setNewEmail("");
        setNewName("");
        setOutbox(await refreshOutbox()); // surface the parked welcome greeting
      } else setNotice(res.error);
    });
  }
  function rmRcpt(id: number) {
    setRecipients((prev) => prev.filter((r) => r.id !== id));
    start(async () => {
      await removeRecipient(id);
    });
  }
  function importClients() {
    start(async () => {
      const res = await importClientRecipients();
      if (res.ok) {
        setNotice(`Imported ${res.data ?? 0} client email(s). Reload to see them in the list.`);
        setOutbox(await refreshOutbox()); // surface parked greetings for new contacts
      }
    });
  }

  return (
    <div className="flex h-full">
      {/* Issues rail */}
      <aside className="flex w-[240px] flex-none flex-col border-r border-rule bg-paper-2">
        <div className="relative flex items-center gap-2 border-b border-rule px-4 py-3">
          <h2 className="flex-1 font-serif text-[15px] font-semibold text-ink">Issues</h2>
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2 py-1 text-[11px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
          >
            <Plus className="size-3" strokeWidth={2} /> New
          </button>
          {picking && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPicking(false)} />
              <div className="absolute right-3 top-12 z-20 w-[220px] rounded-lg border border-rule bg-card p-1.5 shadow-lg">
                <div className="px-2 pb-1 pt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                  Start from a template
                </div>
                {NEWSLETTER_TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => newIssue(t.key)}
                    className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-paper-2"
                  >
                    <div className="text-[12.5px] font-semibold text-ink">{t.label}</div>
                    <div className="text-[11px] leading-snug text-ink-3">{t.description}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {issues.length === 0 ? (
            <div className="px-2 py-8 text-center text-[12px] text-ink-3">
              No issues yet. Start one with “New”.
            </div>
          ) : (
            issues.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setSelectedId(it.id)}
                className={`flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-left ${
                  it.id === selectedId ? "bg-accent-soft" : "hover:bg-paper"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{it.title}</div>
                  <div className="font-mono text-[10px] text-ink-3">
                    {it.status === "sent" ? `Sent · ${it.recipientCount}` : it.createdLabel}
                  </div>
                </div>
                <Chip kind={it.status === "sent" ? "money" : it.status === "queued" ? "accent" : "ghost"}>
                  {it.status === "sent" ? "SENT" : it.status === "queued" ? "QUEUED" : "DRAFT"}
                </Chip>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Editor / preview / recipients */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!current ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Mail className="size-8 text-ink-4" strokeWidth={1.25} />
            <div className="text-[13px] text-ink-3">Select or create an issue.</div>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 border-b border-rule px-5 py-2.5">
              {(["Edit", "Preview", "Recipients", "Outbox"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${
                    mode === m ? "bg-ink text-paper" : "text-ink-3 hover:bg-paper-2"
                  }`}
                >
                  {m}
                  {m === "Recipients" ? ` · ${activeCount}` : ""}
                  {m === "Outbox" && queuedCount ? ` · ${queuedCount}` : ""}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                {!locked && mode === "Edit" && (
                  <button
                    type="button"
                    onClick={save}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-60"
                  >
                    {saved ? <Check className="size-3.5 text-money" strokeWidth={2} /> : null}
                    {saved ? "Saved" : "Save"}
                  </button>
                )}
                {!locked && (
                  <button
                    type="button"
                    onClick={queue}
                    disabled={pending || activeCount === 0}
                    title={activeCount === 0 ? "Add recipients first" : "Parks each message in the Outbox — nothing sends yet"}
                    className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-50"
                  >
                    <Send className="size-3.5" strokeWidth={1.5} /> Queue for {activeCount}
                  </button>
                )}
                {current.status === "queued" && <Chip kind="accent">Queued — release in Outbox</Chip>}
                {sent && <Chip kind="money">Sent · {current.recipientCount}</Chip>}
              </div>
            </div>

            {notice && (
              <div className="border-b border-rule bg-paper-2 px-5 py-2 text-[12px] text-ink-2">{notice}</div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {mode === "Edit" && (
                <div className="mx-auto max-w-[620px] space-y-4">
                  <div>
                    <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Title / subject</label>
                    <input
                      value={current.title}
                      onChange={(e) => patchCurrent({ title: e.target.value })}
                      disabled={locked}
                      className="mt-1 w-full rounded-md border border-rule bg-paper px-3 py-2 font-serif text-[18px] font-semibold text-ink outline-none focus:border-accent disabled:bg-paper-2"
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <label className="flex-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Intro</label>
                      {!locked && (
                        <button
                          type="button"
                          onClick={draftTheIntro}
                          disabled={pending}
                          className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai-soft px-2 py-0.5 text-[11px] font-semibold text-ai-2 hover:bg-ai-soft/70 disabled:opacity-60"
                        >
                          <Sparkles className="size-3" strokeWidth={1.5} /> Draft with {AI_NAME}
                        </button>
                      )}
                    </div>
                    <textarea
                      value={current.intro}
                      onChange={(e) => patchCurrent({ intro: e.target.value })}
                      disabled={locked}
                      rows={4}
                      placeholder="A warm opening for this issue…"
                      className="mt-1 w-full resize-y rounded-md border border-rule bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent disabled:bg-paper-2"
                    />
                  </div>

                  {/* Blocks */}
                  <div className="space-y-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Sections</div>
                    {current.blocks.map((b, idx) => (
                      <Card key={idx} className="p-3">
                        <div className="flex items-center gap-2">
                          <input
                            value={b.heading}
                            onChange={(e) => patchBlocks((bs) => bs.map((x, i) => (i === idx ? { ...x, heading: e.target.value } : x)))}
                            disabled={locked}
                            placeholder="Section heading"
                            className="flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 font-serif text-[15px] font-semibold text-ink outline-none hover:border-rule-soft focus:border-accent disabled:opacity-70"
                          />
                          {b.projectSlug && <Chip kind="ghost">{b.projectSlug}</Chip>}
                          {!locked && (
                            <button
                              type="button"
                              onClick={() => patchBlocks((bs) => bs.filter((_, i) => i !== idx))}
                              className="text-ink-4 hover:text-flag"
                              aria-label="Remove section"
                            >
                              <X className="size-3.5" strokeWidth={1.5} />
                            </button>
                          )}
                        </div>
                        <textarea
                          value={b.body}
                          onChange={(e) => patchBlocks((bs) => bs.map((x, i) => (i === idx ? { ...x, body: e.target.value } : x)))}
                          disabled={locked}
                          rows={3}
                          placeholder="What happened, what you'd tell a client…"
                          className="mt-1.5 w-full resize-y rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink-2 outline-none focus:border-accent disabled:bg-paper-2"
                        />
                      </Card>
                    ))}

                    {!locked && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => patchBlocks((b) => [...b, { heading: "", body: "" }])}
                          className="inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2"
                        >
                          <Plus className="size-3.5" strokeWidth={2} /> Blank section
                        </button>
                        {data.recentJobs.length > 0 && (
                          <select
                            value=""
                            onChange={(e) => addJobBlock(e.target.value)}
                            disabled={pending}
                            className="rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink-2 outline-none focus:border-accent"
                          >
                            <option value="">+ Add from a completed job…</option>
                            {data.recentJobs.map((j) => (
                              <option key={j.slug} value={j.slug}>{j.name}{j.city ? ` — ${j.city}` : ""}</option>
                            ))}
                          </select>
                        )}
                        {pending && <span className="text-[11px] text-ink-3">{AI_NAME} drafting…</span>}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {mode === "Preview" && (
                <div className="mx-auto max-w-[580px] overflow-hidden rounded-lg border border-rule bg-card">
                  {current.template !== "classic" && (
                    <div className="bg-accent-soft px-6 py-3 font-serif text-[15px] font-semibold text-accent-2">
                      SJ Carpentry LLC
                    </div>
                  )}
                  <div className="p-6 pt-5">
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
                      {current.template === "classic" ? "SJ Carpentry LLC · " : ""}
                      {current.title}
                    </div>
                    {current.intro && (
                      <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{current.intro}</p>
                    )}
                    {current.blocks.map((b, i) => (
                      <div key={i} className={`mt-5 ${current.template === "jobsite" ? "border-t border-rule pt-4" : ""}`}>
                        {b.heading && <h3 className="font-serif text-[17px] font-semibold text-ink">{b.heading}</h3>}
                        {b.body && <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{b.body}</p>}
                      </div>
                    ))}
                    <div className="mt-6 border-t border-rule pt-3 font-mono text-[11px] text-ink-3">
                      SJ Carpentry LLC · reply any time
                    </div>
                  </div>
                </div>
              )}

              {mode === "Outbox" && (
                <OutboxPanel outbox={outbox} pending={pending} onRelease={releaseItem} onSkip={skipItem} />
              )}

              {mode === "Recipients" && (
                <div className="mx-auto max-w-[560px] space-y-4">
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-ink-3" strokeWidth={1.5} />
                    <span className="flex-1 text-[13px] text-ink-2">
                      {activeCount} active recipient{activeCount === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      onClick={importClients}
                      disabled={pending}
                      className="inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-60"
                    >
                      <Download className="size-3.5" strokeWidth={1.5} /> Import client emails
                    </button>
                  </div>

                  <Card className="overflow-hidden p-0">
                    {recipients.length === 0 ? (
                      <div className="px-4 py-6 text-center text-[12px] text-ink-3">No recipients yet.</div>
                    ) : (
                      recipients.map((r, i) => (
                        <div key={r.id} className={`flex items-center gap-3 px-4 py-2.5 ${i ? "border-t border-rule-soft" : ""}`}>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] text-ink">{r.name || r.email}</div>
                            {r.name && <div className="font-mono text-[10px] text-ink-3">{r.email}</div>}
                          </div>
                          {!r.active && <Chip kind="ghost">inactive</Chip>}
                          <button type="button" onClick={() => rmRcpt(r.id)} className="text-ink-4 hover:text-flag" aria-label="Remove">
                            <Trash2 className="size-3.5" strokeWidth={1.5} />
                          </button>
                        </div>
                      ))
                    )}
                  </Card>

                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Email</label>
                      <input
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addRcpt()}
                        placeholder="client@email.com"
                        className="mt-1 w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Name · optional</label>
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addRcpt()}
                        placeholder="Pat Henderson"
                        className="mt-1 w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={addRcpt}
                      disabled={pending || !newEmail.trim()}
                      className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
                    >
                      <Plus className="size-3.5" strokeWidth={2} /> Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            {!locked && mode === "Edit" && (
              <div className="border-t border-rule px-5 py-2 text-right">
                <button
                  type="button"
                  onClick={() => removeIssue(current.id)}
                  className="text-[11px] text-ink-3 hover:text-flag"
                >
                  Delete draft
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** The parked-send outbox: nothing here has been emailed. Queued/failed rows can
 *  be Released (the only real send) or Skipped; released rows show open receipts. */
function OutboxPanel({
  outbox,
  pending,
  onRelease,
  onSkip,
}: {
  outbox: OutboxItem[];
  pending: boolean;
  onRelease: (item: OutboxItem) => void;
  onSkip: (item: OutboxItem) => void;
}) {
  const pendingRows = outbox.filter((o) => o.status === "queued" || o.status === "failed");
  const doneRows = outbox.filter((o) => o.status === "released" || o.status === "skipped");

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent-soft/60 px-3 py-2">
        <Inbox className="mt-0.5 size-4 text-accent-2" strokeWidth={1.5} />
        <p className="text-[12px] leading-snug text-ink-2">
          Everything here is <b>parked</b> — no email has been sent. Review each message and press{" "}
          <b>Release</b> to actually email that person via Gmail, or <b>Skip</b> to drop it.
        </p>
      </div>

      {pendingRows.length === 0 ? (
        <div className="px-2 py-8 text-center text-[12px] text-ink-3">Nothing waiting to send.</div>
      ) : (
        <Card className="overflow-hidden p-0">
          {pendingRows.map((o, i) => (
            <div key={o.id} className={`px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{o.name || o.email}</div>
                  <div className="truncate font-mono text-[10px] text-ink-3">
                    {o.email} · {o.kind === "greeting" ? "Welcome greeting" : o.issueTitle ?? "Issue"}
                  </div>
                </div>
                {o.status === "failed" && <Chip kind="flag">FAILED</Chip>}
                <button
                  type="button"
                  onClick={() => onSkip(o)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border border-rule px-2 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper-2 disabled:opacity-50"
                >
                  <SkipForward className="size-3" strokeWidth={1.5} /> Skip
                </button>
                <button
                  type="button"
                  onClick={() => onRelease(o)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-accent-2 disabled:opacity-50"
                >
                  <Send className="size-3" strokeWidth={1.5} /> {o.status === "failed" ? "Retry" : "Release"}
                </button>
              </div>
              <div className="mt-1 truncate text-[11.5px] text-ink-3">{o.subject}</div>
              {o.error && <div className="mt-1 text-[11px] text-flag">{o.error}</div>}
            </div>
          ))}
        </Card>
      )}

      {doneRows.length > 0 && (
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">History</div>
          <Card className="overflow-hidden p-0">
            {doneRows.map((o, i) => (
              <div key={o.id} className={`flex items-center gap-2 px-4 py-2.5 ${i ? "border-t border-rule-soft" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-ink-2">{o.name || o.email}</div>
                  <div className="truncate font-mono text-[10px] text-ink-3">
                    {o.kind === "greeting" ? "Welcome greeting" : o.issueTitle ?? "Issue"}
                  </div>
                </div>
                {o.status === "skipped" ? (
                  <Chip kind="ghost">skipped</Chip>
                ) : (
                  <>
                    <span className="font-mono text-[10px] text-ink-3">
                      {o.openedLabel ? `opened ${o.openedLabel}${o.openCount > 1 ? ` · ${o.openCount}×` : ""}` : "not opened"}
                    </span>
                    <Chip kind="money">sent</Chip>
                  </>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
