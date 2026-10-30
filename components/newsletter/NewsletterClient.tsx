"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, Sparkles, Trash2, Send, Mail, Check, Inbox, ArrowLeft, Star } from "lucide-react";
import { Card, Chip, Button, PageHeader, Segmented, Tabs } from "@/components/ui";
import { AI_NAME } from "@/lib/ai-name";
import { NEWSLETTER_TEMPLATES } from "@/lib/newsletter-templates";
import { DEFAULT_SETTINGS } from "@/lib/newsletter-design";
import { renderIssueHtml } from "@/lib/newsletter-render";
import {
  createIssue,
  saveIssue,
  deleteIssue,
  draftIntro,
  draftBlockForProject,
  queueIssue,
  releaseNewsletterItem,
  releaseAllOutbox,
  skipNewsletterItem,
  refreshOutbox,
  setWelcomeIssue,
  setTargetGroupIds,
} from "@/lib/actions/newsletter";
import { runAction } from "@/lib/run-action";
import { BlockEditor, AddBlockBar } from "./BlockEditor";
import { DesignPanel } from "./DesignPanel";
import { SequencePanel } from "./SequencePanel";
import { RecipientsPanel } from "./RecipientsPanel";
import { AudiencePanel } from "./AudiencePanel";
import type {
  NewsletterData,
  NewsletterIssue,
  NewsletterBlock,
  Recipient,
  NewsletterGroup,
  OutboxItem,
  Sequence,
} from "@/lib/newsletter";

type Mode = "Edit" | "Design" | "Preview" | "Recipients" | "Automations" | "Outbox";

function monthTitle(): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
}

export function NewsletterClient({ data }: { data: NewsletterData }) {
  const [issues, setIssues] = useState<NewsletterIssue[]>(data.issues);
  const [recipients, setRecipients] = useState<Recipient[]>(data.recipients);
  const [groups, setGroups] = useState<NewsletterGroup[]>(data.groups);
  const [outbox, setOutbox] = useState<OutboxItem[]>(data.outbox);
  const [sequences, setSequences] = useState<Sequence[]>(data.sequences);
  const [selectedId, setSelectedId] = useState<number | null>(data.selectedId);
  const [mode, setMode] = useState<Mode>(data.issues.find((i) => i.id === data.selectedId)?.status === "queued" ? "Preview" : "Edit");
  // Contacts (the master list + audiences) is global, not scoped to a draft —
  // Joe found it confusing that editing it lived inside a specific issue's tab
  // bar. It now gets its own top-level view; the per-issue Recipients tab is
  // just "which audience/one-time adds does THIS send go to".
  const [view, setView] = useState<"issues" | "contacts">("issues");
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [picking, setPicking] = useState(false);
  // Phones can't fit the issues rail + editor side by side; show one at a time
  // (selecting/creating an issue reveals the editor, back returns to the list).
  // Wide page containers keep both panes; narrower ones show one at a time.
  const [mobileEditor, setMobileEditor] = useState(data.selectedId != null);
  const [pending, start] = useTransition();
  /** Issues with local edits not yet through Save. A background data sync (the
   *  LiveUpdates poller refreshing after an agent write) keeps these local
   *  copies instead of clobbering a half-written draft. */
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<number>>(new Set());

  // Adopt fresh server data whenever the page's server component re-renders —
  // that's how an agent's MCP edit (new recipient, updated issue, drained
  // outbox) lands here without a reload. Render-phase adjustment, not an
  // effect (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-
  // when-a-prop-changes).
  const [prevData, setPrevData] = useState(data);
  if (prevData !== data) {
    setPrevData(data);
    setRecipients(data.recipients);
    setGroups(data.groups);
    setOutbox(data.outbox);
    setSequences(data.sequences);
    setIssues((prev) =>
      data.issues.map((i) => (dirtyIds.has(i.id) ? (prev.find((p) => p.id === i.id) ?? i) : i)),
    );
  }

  const current = issues.find((i) => i.id === selectedId) ?? null;
  const sent = current?.status === "sent";
  const locked = current?.status === "sent" || current?.status === "queued"; // no editing once queued
  const activeCount = recipients.filter((r) => r.active).length;
  const queuedCount = outbox.filter((o) => o.status === "queued").length;
  const liveSequenceCount = sequences.filter((s) => s.active).length;

  /** `persisted` — the patch mirrors a write that already landed on the server
   *  (queue status, audience toggle), so it doesn't make the draft dirty. */
  function patchCurrent(patch: Partial<NewsletterIssue>, persisted = false) {
    if (selectedId == null) return;
    if (!persisted) {
      setDirtyIds((prev) => (prev.has(selectedId) ? prev : new Set(prev).add(selectedId)));
    }
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
          settings: { ...DEFAULT_SETTINGS },
          status: "draft",
          recipientCount: 0,
          sentLabel: null,
          createdLabel: "just now",
          isWelcome: false,
          extraRecipients: [],
          targetGroupIds: [],
        },
        ...prev,
      ]);
      setSelectedId(id);
      setMode("Edit");
      setMobileEditor(true);
    });
  }

  function save() {
    if (!current) return;
    setNotice(null);
    start(async () => {
      const res = await runAction(
        () => saveIssue(current.id, current.title, current.intro, current.blocks, current.settings),
        { fallback: "Could not save the issue." },
      );
      if (res.ok) {
        setDirtyIds((prev) => {
          const next = new Set(prev);
          next.delete(current.id);
          return next;
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  /** Delete an issue at any status. The old version asked one question, ignored
   *  the server's answer, and removed the card from local state regardless — so a
   *  refused delete looked like it worked until the page reloaded. Now the prompt
   *  matches what's actually being destroyed and the list only changes on success. */
  function removeIssue(id: number) {
    const target = issues.find((i) => i.id === id);
    if (!target) return;

    const prompt =
      target.status === "sent"
        ? `"${target.title}" was already sent to ${target.recipientCount} recipient${target.recipientCount === 1 ? "" : "s"}.\n\n` +
          `Remove it from this list? The delivery record in the Outbox is kept.`
        : target.status === "queued"
          ? `"${target.title}" has messages parked in the Outbox.\n\n` +
            `Deleting it discards those too — nothing was emailed, so nothing is lost.`
          : `Delete "${target.title}"?`;
    if (!confirm(prompt)) return;

    setNotice(null);
    start(async () => {
      const res = await runAction(() => deleteIssue(id, target.status === "sent"), {
        fallback: "Could not delete the issue.",
      });
      if (!res.ok) return;
      setIssues((prev) => prev.filter((i) => i.id !== id));
      if (selectedId === id) setSelectedId(issues.find((i) => i.id !== id)?.id ?? null);
      // A queued issue's parked rows went with it.
      if (target.status !== "draft") setOutbox(await refreshOutbox());
    });
  }

  function draftTheIntro() {
    if (!current) return;
    setNotice(null);
    start(async () => {
      const res = await runAction(() => draftIntro(current.id), { fallback: "Could not draft the intro." });
      if (res.ok && res.data) patchCurrent({ intro: res.data });
      else if (res.ok) setNotice("No draft returned.");
    });
  }

  function addJobBlock(slug: string) {
    if (!slug) return;
    setNotice(null);
    start(async () => {
      const res = await runAction(() => draftBlockForProject(slug), { fallback: "Could not draft that section." });
      if (res.ok && res.data) patchBlocks((b) => [...b, res.data!]);
      else if (res.ok) setNotice("No draft returned.");
    });
  }

  // ── Audience (which groups + one-time adds a Queue targets; no groups = everyone active) ──
  // Lives on the issue itself (current.targetGroupIds), not local component
  // state — a checkbox that silently reset on every reload read as "I checked
  // an audience and it did nothing." setTargetGroupIds saves on every toggle.
  const targetGroupIds = current?.targetGroupIds ?? [];
  const audienceCount =
    (targetGroupIds.length === 0
      ? activeCount
      : new Set(
          recipients.filter((r) => r.active && r.groupIds.some((g) => targetGroupIds.includes(g))).map((r) => r.id),
        ).size) + (current?.extraRecipients.length ?? 0);

  function setTargetGroups(fn: (prev: number[]) => number[]) {
    if (!current) return;
    const prev = current.targetGroupIds;
    const next = fn(prev);
    patchCurrent({ targetGroupIds: next }, true);
    start(async () => {
      // Optimistic: roll the checkbox back if the save fails (runAction toasts).
      await runAction(() => setTargetGroupIds(current.id, next), {
        fallback: "Could not save the audience.",
        onError: () => patchCurrent({ targetGroupIds: prev }, true),
      });
    });
  }

  function queue() {
    if (!current) return;
    const audienceNote =
      targetGroupIds.length === 0
        ? "everyone active"
        : groups
            .filter((g) => targetGroupIds.includes(g.id))
            .map((g) => g.name)
            .join(", ");
    if (
      !confirm(
        `Queue "${current.title}" for ${audienceCount} recipient${audienceCount === 1 ? "" : "s"} (${audienceNote})?\n\n` +
          `Nothing is emailed yet — each message waits in the Outbox until you Release it.`,
      )
    )
      return;
    setNotice(null);
    start(async () => {
      const res = await runAction(
        () => queueIssue(current.id, targetGroupIds.length ? targetGroupIds : undefined),
        { fallback: "Could not queue the issue." },
      );
      if (res.ok) {
        patchCurrent({ status: "queued" }, true);
        setMode("Preview");
        setNotice(`Queued ${res.data?.queued ?? 0} message(s). Review the issue, then open Outbox to request release.`);
        // Pull the real persisted rows (with real ids) so Release is enabled.
        setOutbox(await refreshOutbox());
      }
    });
  }

  function releaseItem(item: OutboxItem) {
    if (!confirm(`Release now? This emails ${item.email} for real via Gmail.`)) return;
    setNotice(null);
    start(async () => {
      await runAction(() => releaseNewsletterItem(item.id), { fallback: "Release failed." });
      // Either way re-read: a failed release is left as `failed` for retry.
      setOutbox(await refreshOutbox());
    });
  }
  function releaseAll() {
    const n = outbox.filter((o) => o.status === "queued" || o.status === "failed").length;
    if (n === 0) return;
    if (!confirm(`Release all ${n} parked message${n === 1 ? "" : "s"} now? This emails every one of them for real via Gmail.`))
      return;
    setNotice(null);
    start(async () => {
      const res = await runAction(() => releaseAllOutbox(), { fallback: "Release failed." });
      if (res.ok) {
        const { released, failed } = res.data ?? { released: 0, failed: 0 };
        setNotice(failed > 0 ? `Released ${released}, ${failed} failed — left as failed to retry.` : `Released ${released}.`);
      }
      setOutbox(await refreshOutbox());
    });
  }
  function skipItem(item: OutboxItem) {
    setOutbox((prev) => prev.map((o) => (o.id === item.id ? { ...o, status: "skipped" } : o)));
    start(async () => {
      await runAction(() => skipNewsletterItem(item.id), { fallback: "Could not skip that message." });
      // Re-read either way; a failed skip reverts the optimistic row.
      setOutbox(await refreshOutbox());
    });
  }

  function refreshOutboxAfterAdd() {
    start(async () => {
      setOutbox(await refreshOutbox());
    });
  }

  // ── Welcome email (an issue flagged is_welcome — at most one at a time) ──
  function promoteWelcome(id: number) {
    const target = issues.find((i) => i.id === id);
    const priorWelcome = issues.find((i) => i.isWelcome);
    if (!target) return;
    if (
      priorWelcome &&
      !confirm(`Make "${target.title}" the welcome email? It replaces "${priorWelcome.title}" in that role.`)
    )
      return;
    setNotice(null);
    // Optimistic: the star moves now and moves back if the write fails.
    const prev = issues;
    setIssues((cur) => cur.map((i) => ({ ...i, isWelcome: i.id === id })));
    start(async () => {
      await runAction(() => setWelcomeIssue(id, true), {
        fallback: "Could not set the welcome email.",
        onError: () => setIssues(prev),
      });
    });
  }
  function demoteWelcome(id: number) {
    setNotice(null);
    const prev = issues;
    setIssues((cur) => cur.map((i) => (i.id === id ? { ...i, isWelcome: false } : i)));
    start(async () => {
      await runAction(() => setWelcomeIssue(id, false), {
        fallback: "Could not clear the welcome email.",
        onError: () => setIssues(prev),
      });
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-rule-soft px-4 py-5">
        <PageHeader title="Newsletter" meta={`${activeCount} active contacts · ${queuedCount} messages queued`} filters={<Segmented aria-label="Newsletter view" value={view} onChange={v=>setView(v as "issues"|"contacts")} options={[{value:"issues",label:"Issues"},{value:"contacts",label:"Contacts",count:activeCount}]} />} />
      </div>

      {notice && (
        <div className="shrink-0 border-b border-rule bg-paper-2 px-5 py-2 text-meta text-ink-2">{notice}</div>
      )}

      {view === "contacts" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <RecipientsPanel
            recipients={recipients}
            setRecipients={setRecipients}
            groups={groups}
            setGroups={setGroups}
            activeCount={activeCount}
            pending={pending}
            start={start}
            onNotice={setNotice}
            onOutboxRefresh={refreshOutboxAfterAdd}
          />
        </div>
      ) : (
      <div className="flex min-h-0 flex-1">
      {/* Issues rail */}
      <aside
        className={`min-h-0 w-full flex-none flex-col border-r border-rule-soft bg-paper @4xl/page:w-56 ${
          mobileEditor ? "hidden @4xl/page:flex" : "flex"
        }`}
      >
        <div className="relative flex items-center gap-2 border-b border-rule px-4 py-3">
          <h2 className="flex-1 font-serif text-subheading font-semibold text-ink">Issues</h2>
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2 py-1 text-meta font-semibold text-paper hover:bg-ink-hover disabled:opacity-60"
          >
            <Plus className="size-3" strokeWidth={2} /> New
          </button>
          {picking && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPicking(false)} />
              <div className="absolute right-3 top-12 z-20 w-[220px] rounded-lg border border-rule bg-card p-1.5 shadow-lg">
                <div className="px-2 pb-1 pt-1 text-meta text-ink-3">
                  Start from a template
                </div>
                {NEWSLETTER_TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => newIssue(t.key)}
                    className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-paper-2"
                  >
                    <div className="text-body font-semibold text-ink">{t.label}</div>
                    <div className="text-meta leading-snug text-ink-3">{t.description}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {!issues.some((i) => i.isWelcome) && (
          <div className="border-b border-rule-soft bg-ai-soft/40 px-4 py-2 text-meta leading-snug text-ink-2">
            Choose a welcome issue: open a draft and select “Set as welcome email”. A past issue titled Welcome is send history.
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {issues.length === 0 ? (
            <div className="px-2 py-8 text-center text-meta text-ink-3">
              No issues yet. Start one with “New”.
            </div>
          ) : (
            // Row is a div, not a button: the delete control is itself a button
            // and nesting one inside another is invalid HTML (and breaks its
            // click handling). The title area stays the clickable target.
            issues.map((it) => (
              <div
                key={it.id}
                className={`group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded-md px-2.5 py-2 ${
                  it.id === selectedId ? "bg-accent-soft" : "hover:bg-paper"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(it.id);
                    setMode(it.status === "queued" || it.status === "sent" ? "Preview" : "Edit");
                    setMobileEditor(true);
                  }}
                  aria-label={`Open ${it.title}`}
                  aria-current={it.id === selectedId ? "true" : undefined}
                  className="col-span-2 min-w-0 w-full text-left"
                >
                  <div className="flex items-start gap-1 text-body text-ink">
                    {it.isWelcome && (
                      <Star className="size-3 shrink-0 fill-ai text-ai" strokeWidth={1.5} aria-label="Welcome email" />
                    )}
                    <span className="break-words">{it.title}</span>
                  </div>
                  <div className="text-meta text-ink-3">
                    {it.status === "sent" ? `Sent · ${it.recipientCount}` : it.createdLabel}
                  </div>
                </button>
                <Chip kind={it.isWelcome ? "ai" : it.status === "sent" ? "money" : it.status === "queued" ? "accent" : "ghost"}>
                  {it.isWelcome ? "Welcome" : it.status === "sent" ? "Sent" : it.status === "queued" ? "Queued" : "Draft"}
                </Chip>
                {/* Always rendered, not hover-only: a control you can't find is
                    the bug being fixed here, and hover-only affordances don't
                    exist at all on a phone. The welcome issue can't be deleted
                    (server-enforced) — demote it first, so no button here. */}
                {!it.isWelcome && <details className="relative shrink-0"><summary className="list-none cursor-pointer px-2 py-1 text-body [&::-webkit-details-marker]:hidden" aria-label={`More actions for ${it.title}`} title={`More actions for ${it.title}`}>…</summary><div className="absolute right-0 z-20 rounded-lg border border-rule-soft bg-card p-1 shadow-pop"><Button variant="ghost" size="sm" className="text-flag" disabled={pending} onClick={()=>removeIssue(it.id)}>Delete issue</Button></div></details>}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Editor / preview / recipients */}
      <section
        className={`min-h-0 min-w-0 flex-1 flex-col ${mobileEditor ? "flex" : "hidden @4xl/page:flex"}`}
      >
        <button
          type="button"
          onClick={() => setMobileEditor(false)}
          className="m-2 -mb-1 inline-flex min-h-11 shrink-0 w-fit items-center gap-1 rounded-md px-1.5 py-1 text-meta font-semibold text-ink-2 hover:bg-paper-2 @4xl/page:hidden"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.5} /> Back to issues
        </button>
        {!current ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Mail className="size-8 text-ink-3" strokeWidth={1.25} />
            <div className="text-body text-ink-3">Select or create an issue.</div>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-rule-soft px-4 py-2.5">
              <div className="min-w-0 w-full"><Tabs tabs={["Edit", "Design", "Preview", "Recipients", "Automations", "Outbox"]} active={["Edit", "Design", "Preview", "Recipients", "Automations", "Outbox"].indexOf(mode)} onSelect={i=>setMode((["Edit", "Design", "Preview", "Recipients", "Automations", "Outbox"] as Mode[])[i])}/></div>
              <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
                {!locked && mode === "Edit" && (
                  <button
                    type="button"
                    onClick={save}
                    disabled={pending}
                    className="inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-meta font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-60"
                  >
                    {saved ? <Check className="size-3.5 text-money" strokeWidth={2} /> : null}
                    {saved ? "Saved" : "Save"}
                  </button>
                )}
                {!locked && !current.isWelcome && (
                  <>
                    {(targetGroupIds.length > 0 || current.extraRecipients.length > 0) && (
                      <span className="text-meta text-ink-3">
                        {targetGroupIds.length > 0
                          ? `${targetGroupIds.length} audience${targetGroupIds.length === 1 ? "" : "s"}`
                          : "Everyone"}
                        {current.extraRecipients.length > 0 ? ` +${current.extraRecipients.length}` : ""} — set in
                        Recipients
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={queue}
                      disabled={pending || audienceCount === 0}
                      title={audienceCount === 0 ? "Add recipients first" : "Parks each message in the Outbox — nothing sends yet"}
                      className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-label font-semibold text-paper hover:bg-ink-hover disabled:opacity-50"
                    >
                      <Inbox className="size-3.5" strokeWidth={1.5} /> Queue for {audienceCount}
                    </button>
                  </>
                )}
                {current.isWelcome && <Chip kind="ai">Welcome email</Chip>}
                {current.status === "queued" && <Chip kind="info">Queued</Chip>}
                {sent && <Chip kind="money">Sent · {current.recipientCount}</Chip>}
              </div>
            </div>

            {current.status === "queued" && <div className="shrink-0 border-b border-rule bg-info-soft px-4 py-2"><p className="text-body text-ink-2">Queued — review the email below. Editing is locked; nothing has been emailed. Release requires owner approval.</p><Button variant="secondary" size="sm" className="mt-2" onClick={() => setMode("Outbox")}>Open Outbox · {queuedCount} queued</Button></div>}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {mode === "Edit" && (
                <div className="mx-auto max-w-[620px] space-y-4">
                  <div>
                    <label className="text-meta text-ink-3">Title / subject</label>
                    <input
                      value={current.title}
                      onChange={(e) => patchCurrent({ title: e.target.value })}
                      disabled={locked}
                      className="mt-1 w-full rounded-md border border-rule bg-paper px-3 py-2 font-serif text-heading font-semibold text-ink outline-none focus:border-accent disabled:bg-paper-2"
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <label className="flex-1 text-meta text-ink-3">Intro</label>
                      {!locked && (
                        <button
                          type="button"
                          onClick={draftTheIntro}
                          disabled={pending}
                          className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai-soft px-2 py-0.5 text-meta font-semibold text-ai-2 hover:bg-ai-soft/70 disabled:opacity-60"
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
                      className="mt-1 w-full resize-y rounded-md border border-rule bg-paper px-3 py-2 text-body text-ink outline-none focus:border-accent disabled:bg-paper-2"
                    />
                  </div>

                  {/* Blocks */}
                  <div className="space-y-3">
                    <div className="text-meta text-ink-3">Sections</div>
                    {current.blocks.map((b, idx) => (
                      <BlockEditor
                        key={idx}
                        block={b}
                        index={idx}
                        total={current.blocks.length}
                        locked={locked}
                        onChange={(patch) =>
                          patchBlocks((bs) => bs.map((x, i) => (i === idx ? { ...x, ...patch } : x)))
                        }
                        onRemove={() => patchBlocks((bs) => bs.filter((_, i) => i !== idx))}
                        onMove={(dir) =>
                          patchBlocks((bs) => {
                            const to = idx + dir;
                            if (to < 0 || to >= bs.length) return bs;
                            const next = [...bs];
                            [next[idx], next[to]] = [next[to], next[idx]];
                            return next;
                          })
                        }
                        onNotice={setNotice}
                      />
                    ))}

                    {!locked && (
                      <AddBlockBar
                        pending={pending}
                        recentJobs={data.recentJobs}
                        onAdd={(block) => patchBlocks((b) => [...b, block])}
                        onAddJob={addJobBlock}
                      />
                    )}
                  </div>
                </div>
              )}

              {mode === "Design" && (
                <DesignPanel
                  settings={current.settings}
                  locked={locked}
                  onChange={(patch) => patchCurrent({ settings: { ...current.settings, ...patch } })}
                />
              )}

              {mode === "Automations" && (
                <SequencePanel
                  sequences={sequences}
                  issues={issues}
                  groups={groups}
                  pending={pending}
                  onChanged={setSequences}
                  onNotice={setNotice}
                  start={start}
                />
              )}

              {mode === "Preview" && <IssuePreview issue={current} baseUrl={data.baseUrl} />}

              {mode === "Outbox" && (
                <OutboxPanel
                  outbox={outbox}
                  pending={pending}
                  onRelease={releaseItem}
                  onReleaseAll={releaseAll}
                  onSkip={skipItem}
                />
              )}

              {mode === "Recipients" && (
                <AudiencePanel
                  issueId={current.id}
                  extraRecipients={current.extraRecipients}
                  onExtraRecipientsChange={(list) => patchCurrent({ extraRecipients: list })}
                  groups={groups}
                  targetGroupIds={targetGroupIds}
                  setTargetGroupIds={setTargetGroups}
                  pending={pending}
                  start={start}
                  locked={locked}
                />
              )}
            </div>

            {/* Destructive issue actions stay in the menu at every status.
                Welcome issues must be demoted before deletion (server-enforced). */}
            {(mode === "Edit" || mode === "Design") && (
              <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-rule px-5 py-2">
                {current.isWelcome ? (
                  <button
                    type="button"
                    onClick={() => demoteWelcome(current.id)}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-rule px-2.5 py-1 text-meta font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
                  >
                    <Star className="size-3.5" strokeWidth={1.5} /> Remove as welcome email
                  </button>
                ) : (
                  <>
                    {current.status === "draft" && (
                      <button
                        type="button"
                        onClick={() => promoteWelcome(current.id)}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-md border border-rule px-2.5 py-1 text-meta font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-50"
                      >
                        <Star className="size-3.5" strokeWidth={1.5} /> Set as welcome email
                      </button>
                    )}
                    <details className="relative">
                      <summary aria-label="Issue actions" title="Issue actions" className="list-none cursor-pointer rounded-md border border-rule px-3 py-2 text-body [&::-webkit-details-marker]:hidden">…</summary>
                      <div className="absolute bottom-full right-0 z-20 mb-1 rounded-md border border-rule bg-card p-1 shadow-pop">
                    <button
                      type="button"
                      onClick={() => removeIssue(current.id)}
                      disabled={pending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-rule px-2.5 py-1 text-meta font-semibold text-ink-2 hover:border-flag hover:bg-flag-soft hover:text-flag disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.5} />
                      {current.status === "sent"
                        ? "Remove from list"
                        : current.status === "queued"
                          ? "Discard queued issue"
                          : "Delete draft"}
                    </button>
                      </div>
                    </details>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </section>
      </div>
      )}
    </div>
  );
}

/** True-to-life preview: renders the SAME html the recipient will get, inside an
 *  iframe. The iframe is the important part — email HTML is a self-contained
 *  document with its own inline styling, and dropping it into the app's DOM would
 *  let Tailwind's reset restyle it, so the preview would flatter the email and
 *  hide exactly the layout problems it exists to catch. */
function IssuePreview({ issue, baseUrl }: { issue: NewsletterIssue; baseUrl: string }) {
  const [width, setWidth] = useState<"desktop" | "mobile">("mobile");
  const previewRef = useRef<HTMLDivElement>(null);
  const chosen = useRef(false);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!chosen.current) setWidth(entry.contentRect.width < 600 ? "mobile" : "desktop");
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The tracking pixel and unsubscribe link are deliberately omitted: there is no
  // outbox row to attribute an open to, and no recipient to unsubscribe.
  const html = renderIssueHtml(
    { title: issue.title, intro: issue.intro, blocks: issue.blocks, settings: issue.settings },
    { baseUrl },
  );

  return (
    <div ref={previewRef} className="mx-auto min-w-0 max-w-[720px] space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-meta text-ink-3">Preview</span>
        <div className="ml-auto flex gap-1">
          {(["desktop", "mobile"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => { chosen.current = true; setWidth(w); }}
              className={`rounded-md px-2 py-0.5 text-meta font-semibold capitalize ${
                width === w ? "bg-ink text-paper" : "text-ink-3 hover:bg-paper-2"
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-center">
        <iframe
          title="Newsletter preview"
          // sandbox with no allow-* : the preview must never run script or
          // navigate the app, even though we generated the markup ourselves.
          sandbox=""
          srcDoc={`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0">${html}</body>`}
          className="h-[70vh] rounded-lg border border-rule bg-white transition-all"
          style={{ width: width === "mobile" ? 380 : "100%", maxWidth: "100%" }}
        />
      </div>
      <p className="text-center text-meta text-ink-3">
        Photos load from this server, so recipients see them only once the issue is sent from a
        reachable address.
      </p>
    </div>
  );
}

/** The parked-send outbox: nothing here has been emailed. Queued/failed rows can
 *  be Released (the only real send) or Skipped; released rows show open receipts. */
function OutboxPanel({
  outbox,
  pending,
  onRelease,
  onReleaseAll,
  onSkip,
}: {
  outbox: OutboxItem[];
  pending: boolean;
  onRelease: (item: OutboxItem) => void;
  onReleaseAll: () => void;
  onSkip: (item: OutboxItem) => void;
}) {
  const pendingRows = outbox.filter((o) => o.status === "queued" || o.status === "failed");
  const doneRows = outbox.filter((o) => o.status === "released" || o.status === "skipped");

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent-soft/60 px-3 py-2">
        <Inbox className="mt-0.5 size-4 text-accent-2" strokeWidth={1.5} />
        <p className="text-meta leading-snug text-ink-2">
          Everything here is <b>parked</b> — no email has been sent. Review each message and press{" "}
          <b>Release</b> to actually email that person via Gmail, or <b>Discard</b> to drop it.
        </p>
      </div>

      {pendingRows.length === 0 ? (
        <div className="px-2 py-8 text-center text-meta text-ink-3">Nothing waiting to send.</div>
      ) : (
        <>
          <div className="text-right">
            <button
              type="button"
              onClick={onReleaseAll}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-meta font-semibold text-white hover:bg-accent-2 disabled:opacity-50"
            >
              <Send className="size-3.5" strokeWidth={1.5} /> Release all {pendingRows.length}
            </button>
          </div>
          <Card className="overflow-hidden p-0">
          {pendingRows.map((o, i) => (
            <div key={o.id} className={`px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-ink">{o.name || o.email}</div>
                  <div className="truncate text-meta text-ink-3">
                    {o.email} · {o.kind === "greeting" ? "Welcome greeting" : o.issueTitle ?? "Issue"}
                  </div>
                </div>
                {o.status === "failed" && <Chip kind="flag">Failed</Chip>}
                <button
                  type="button"
                  onClick={() => onSkip(o)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border border-rule px-2 py-1 text-meta font-semibold text-ink-3 hover:bg-paper-2 disabled:opacity-50"
                >
                  <Trash2 className="size-3" strokeWidth={1.5} /> Discard
                </button>
                <button
                  type="button"
                  onClick={() => onRelease(o)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-meta font-semibold text-white hover:bg-accent-2 disabled:opacity-50"
                >
                  <Send className="size-3" strokeWidth={1.5} /> {o.status === "failed" ? "Retry" : "Release"}
                </button>
              </div>
              <div className="mt-1 truncate text-meta text-ink-3">{o.subject}</div>
              {o.error && <div className="mt-1 text-meta text-flag">{o.error}</div>}
            </div>
          ))}
          </Card>
        </>
      )}

      {doneRows.length > 0 && (
        <div>
          <div className="mb-1.5 text-meta text-ink-3">History</div>
          <Card className="overflow-hidden p-0">
            {doneRows.map((o, i) => (
              <div key={o.id} className={`flex items-center gap-2 px-4 py-2.5 ${i ? "border-t border-rule-soft" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-ink-2">{o.name || o.email}</div>
                  <div className="truncate text-meta text-ink-3">
                    {o.kind === "greeting" ? "Welcome greeting" : o.issueTitle ?? "Issue"}
                  </div>
                </div>
                {o.status === "skipped" ? (
                  <Chip kind="ghost">skipped</Chip>
                ) : (
                  <>
                    <span className="text-meta text-ink-3">
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
