"use client";

import { useState, useTransition } from "react";
import { Plus, Sparkles, Trash2, X, Send, Users, Mail, Download, Check } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { AI_NAME } from "@/lib/ai-name";
import {
  createIssue,
  saveIssue,
  deleteIssue,
  draftIntro,
  draftBlockForProject,
  addRecipient,
  removeRecipient,
  importClientRecipients,
  sendIssue,
} from "@/lib/actions/newsletter";
import type { NewsletterData, NewsletterIssue, NewsletterBlock, Recipient } from "@/lib/newsletter";

type Mode = "Edit" | "Preview" | "Recipients";

function monthTitle(): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
}

export function NewsletterClient({ data }: { data: NewsletterData }) {
  const [issues, setIssues] = useState<NewsletterIssue[]>(data.issues);
  const [recipients, setRecipients] = useState<Recipient[]>(data.recipients);
  const [selectedId, setSelectedId] = useState<number | null>(data.selectedId);
  const [mode, setMode] = useState<Mode>("Edit");
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const current = issues.find((i) => i.id === selectedId) ?? null;
  const sent = current?.status === "sent";
  const activeCount = recipients.filter((r) => r.active).length;

  function patchCurrent(patch: Partial<NewsletterIssue>) {
    if (selectedId == null) return;
    setIssues((prev) => prev.map((i) => (i.id === selectedId ? { ...i, ...patch } : i)));
  }
  function patchBlocks(fn: (b: NewsletterBlock[]) => NewsletterBlock[]) {
    if (!current) return;
    patchCurrent({ blocks: fn(current.blocks) });
  }

  function newIssue() {
    start(async () => {
      const id = await createIssue();
      setIssues((prev) => [
        { id, title: monthTitle(), intro: "", blocks: [], status: "draft", recipientCount: 0, sentLabel: null, createdLabel: "just now" },
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

  function send() {
    if (!current) return;
    if (!confirm(`Send "${current.title}" to ${activeCount} recipient${activeCount === 1 ? "" : "s"}?`)) return;
    setNotice(null);
    start(async () => {
      const res = await sendIssue(current.id);
      if (res.ok) {
        patchCurrent({ status: "sent", recipientCount: res.data?.sent ?? 0, sentLabel: "just now" });
        setNotice(`Sent to ${res.data?.sent ?? 0} recipient(s)${res.data?.failed ? `, ${res.data.failed} failed` : ""}.`);
      } else setNotice(res.error);
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
      if (res.ok) setNotice(`Imported ${res.data ?? 0} client email(s). Reload to see them.`);
    });
  }

  return (
    <div className="flex h-full">
      {/* Issues rail */}
      <aside className="flex w-[240px] flex-none flex-col border-r border-rule bg-paper-2">
        <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
          <h2 className="flex-1 font-serif text-[15px] font-semibold text-ink">Issues</h2>
          <button
            type="button"
            onClick={newIssue}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2 py-1 text-[11px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
          >
            <Plus className="size-3" strokeWidth={2} /> New
          </button>
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
                <Chip kind={it.status === "sent" ? "money" : "ghost"}>{it.status === "sent" ? "SENT" : "DRAFT"}</Chip>
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
              {(["Edit", "Preview", "Recipients"] as Mode[]).map((m) => (
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
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                {!sent && mode === "Edit" && (
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
                {!sent && (
                  <button
                    type="button"
                    onClick={send}
                    disabled={pending || activeCount === 0}
                    title={activeCount === 0 ? "Add recipients first" : ""}
                    className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-50"
                  >
                    <Send className="size-3.5" strokeWidth={1.5} /> Send to {activeCount}
                  </button>
                )}
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
                      disabled={sent}
                      className="mt-1 w-full rounded-md border border-rule bg-paper px-3 py-2 font-serif text-[18px] font-semibold text-ink outline-none focus:border-accent disabled:bg-paper-2"
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <label className="flex-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Intro</label>
                      {!sent && (
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
                      disabled={sent}
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
                            disabled={sent}
                            placeholder="Section heading"
                            className="flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 font-serif text-[15px] font-semibold text-ink outline-none hover:border-rule-soft focus:border-accent disabled:opacity-70"
                          />
                          {b.projectSlug && <Chip kind="ghost">{b.projectSlug}</Chip>}
                          {!sent && (
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
                          disabled={sent}
                          rows={3}
                          placeholder="What happened, what you'd tell a client…"
                          className="mt-1.5 w-full resize-y rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink-2 outline-none focus:border-accent disabled:bg-paper-2"
                        />
                      </Card>
                    ))}

                    {!sent && (
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
                <div className="mx-auto max-w-[580px] rounded-lg border border-rule bg-card p-6">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
                    SJ Carpentry LLC · {current.title}
                  </div>
                  {current.intro && (
                    <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{current.intro}</p>
                  )}
                  {current.blocks.map((b, i) => (
                    <div key={i} className="mt-5">
                      {b.heading && <h3 className="font-serif text-[17px] font-semibold text-ink">{b.heading}</h3>}
                      {b.body && <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{b.body}</p>}
                    </div>
                  ))}
                  <div className="mt-6 border-t border-rule pt-3 font-mono text-[11px] text-ink-3">
                    SJ Carpentry LLC · reply any time
                  </div>
                </div>
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

            {!sent && mode === "Edit" && (
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
