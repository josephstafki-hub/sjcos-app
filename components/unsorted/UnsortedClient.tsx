"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Building2, Camera, Download, FileText, Loader2, Mail, MessageSquareText, MoreHorizontal, PenLine, RefreshCw, Search, Send, Sparkles, Undo2, X } from "lucide-react";
import { Button, EmptyState, PageHeader, Segmented, Card, Chip, Lightbox, type ChipKind, type LightboxPhoto } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import { fileUnsortedAction, noteUnsortedAction, rereadUnsortedAction, undoUnsortedAction, type FileUnsortedInput } from "@/lib/actions/unsorted";
import type { DocKind, ProjectChoice, UnsortedDocRow } from "@/lib/unsorted-docs-core";

export interface DocFile {
  id: string;
  name: string;
  mime_type: string;
  size_label: string;
}

const KIND_LABEL: Record<DocKind, string> = { invoice: "Invoice", receipt: "Receipt", rebate: "Rebate", statement: "Statement", other: "Other" };
const KIND_CHIP: Record<DocKind, ChipKind> = { invoice: "info", receipt: "money", rebate: "info", statement: "default", other: "ghost" };
const KINDS = Object.keys(KIND_LABEL) as DocKind[];

const money = (cents: number | null | undefined) =>
  cents == null ? "" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }) : "";
const vendorOf = (d: UnsortedDocRow) => d.vendor_label || d.from_label.replace(/<[^>]*>/, "").replace(/"/g, "").trim() || "Unknown sender";
/** Where it came from: a phone scan, a text, or email. */
const sourceOf = (d: UnsortedDocRow): "scan" | "text" | "email" =>
  d.source_ref.startsWith("scan:") ? "scan" : d.source_ref.startsWith("sms:") ? "text" : "email";
/** A read started this long ago with no answer is stuck (a restart mid-read). */
const STUCK_MS = 3 * 60_000;
const readingNow = (d: UnsortedDocRow) =>
  d.extract_state === "reading" && Date.now() - Date.parse(d.extract_started_at ?? d.created_at) < STUCK_MS;
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

export function UnsortedClient({
  docs,
  resolved,
  projects,
  files,
  initialTab,
  openId,
}: {
  docs: UnsortedDocRow[];
  resolved: UnsortedDocRow[];
  projects: ProjectChoice[];
  files: Record<string, DocFile>;
  initialTab: "sort" | "filed";
  openId: number | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  // Docs put away in this tab but not yet gone from the server props.
  const [hidden, setHidden] = useState<Set<number>>(() => new Set());
  const open = useMemo(() => docs.filter((d) => !hidden.has(d.id)), [docs, hidden]);
  const [selectedId, setSelectedId] = useState<number | null>(openId);
  const selected = open.find((d) => d.id === selectedId) ?? open[0] ?? null;
  const [last, setLast] = useState<{ id: number; label: string } | null>(null);
  const [busy, start] = useTransition();
  const byslug = useMemo(() => new Map(projects.map((p) => [p.slug, p])), [projects]);
  // A card's photo thumbnail open in the same viewer as project Files.
  const [viewer, setViewer] = useState<{ photos: LightboxPhoto[]; index: number } | null>(null);

  const pending = open.filter((d) => d.status === "pending").length;

  function advanceFrom(id: number) {
    const i = open.findIndex((d) => d.id === id);
    const next = open[i + 1] ?? open[i - 1] ?? null;
    setSelectedId(next?.id ?? null);
  }

  function file(doc: UnsortedDocRow, input: FileUnsortedInput, label: string) {
    start(async () => {
      const r = await runAction(() => fileUnsortedAction(doc.id, input), { fallback: "Couldn't file that." });
      if (!r.ok) return;
      advanceFrom(doc.id);
      setHidden((h) => new Set(h).add(doc.id));
      setLast({ id: doc.id, label });
      router.refresh();
    });
  }

  function note(doc: UnsortedDocRow, text: string) {
    start(async () => {
      const r = await runAction(() => noteUnsortedAction(doc.id, text), { fallback: "Couldn't send that to the agent." });
      if (!r.ok) return;
      advanceFrom(doc.id);
      setLast(null);
      router.refresh();
    });
  }

  function undo(id: number) {
    start(async () => {
      const r = await runAction(() => undoUnsortedAction(id), { fallback: "Couldn't undo that." });
      if (!r.ok) return;
      setHidden((h) => {
        const n = new Set(h);
        n.delete(id);
        return n;
      });
      setLast(null);
      setSelectedId(id);
      setTab("sort");
      router.refresh();
    });
  }

  // Claude is reading a photo: look again every few seconds until it answers.
  const anyReading = open.some(readingNow);
  useEffect(() => {
    if (!anyReading) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [anyReading, router]);

  function reread(id: number) {
    start(async () => {
      const r = await runAction(() => rereadUnsortedAction(id), { fallback: "Couldn't start reading it." });
      if (r.ok) router.refresh();
    });
  }

  // j / k (or arrows) move through the list when no field has focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (tab !== "sort" || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || !selected) return;
      const i = open.findIndex((d) => d.id === selected.id);
      if (e.key === "j" || e.key === "ArrowDown") {
        const n = open[i + 1];
        if (n) setSelectedId(n.id);
        e.preventDefault();
      } else if (e.key === "k" || e.key === "ArrowUp") {
        const p = open[i - 1];
        if (p) setSelectedId(p.id);
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, open, selected]);

  return (
    <div className="[&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-focus [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-focus [&_input]:focus-visible:outline-2 [&_input]:focus-visible:outline-focus [&_select]:focus-visible:outline-2 [&_select]:focus-visible:outline-focus mx-auto flex min-h-full max-w-[1240px] flex-col gap-6 px-4 py-6 @2xl/page:px-5 @5xl/page:px-8">
      <PageHeader title="Unsorted" meta={<span className="block whitespace-normal break-words">Invoices and receipts from email, scans and texts that need a job. Choose where each goes to attach it and log the cost.</span>} actions={<Button href="/scan" variant="secondary" icon={Camera}>Scan receipt</Button>} filters={<Segmented aria-label="Unsorted views" className="max-sm:h-12 [&_button]:max-sm:h-11" value={tab} onChange={t => setTab(t as "sort" | "filed")} options={[{value:"sort",label:"To sort",count:pending || undefined},{value:"filed",label:"Filed lately"}]} />} />

      {last && tab === "sort" && (
        <div className="flex items-center gap-2 rounded-lg border border-rule bg-money-soft px-3 py-2 text-body text-ink">
          <span role="status" className="min-w-0 flex-1">{last.label}</span>
          <Button onClick={() => undo(last.id)} disabled={busy} variant="ghost" icon={Undo2}>Undo</Button>
          <Button onClick={() => setLast(null)} icon={X} iconOnly aria-label="Dismiss" title="Dismiss" />
        </div>
      )}

      {tab === "filed" ? (
        <FiledList docs={resolved} files={files} busy={busy} onUndo={undo} onView={(photos, index) => setViewer({ photos, index })} />
      ) : !selected ? (
        <EmptyState icon={FileText} title="All sorted" description="Receipts and invoices that need a job will appear here. Scan a receipt to add one, or open Filed lately to undo a filing." />
      ) : (
        // Sized by the page's own width (container queries), not the window's:
        // the operator panel can take half the screen.
        <div className="min-h-0 flex-1">
        <div className="grid gap-3 @4xl/page:grid-cols-[minmax(0,1fr)_300px] @5xl/page:grid-cols-[230px_minmax(0,1fr)_320px]">
          <Card className="flex overflow-x-auto p-0 @4xl/page:col-span-2 @5xl/page:col-span-1 @5xl/page:block @5xl/page:max-h-[82vh] @5xl/page:overflow-y-auto">
            <div className="sticky top-0 hidden border-b border-rule bg-paper-2 px-3 py-2 tabular-nums text-meta text-ink-3 @5xl/page:block">
              {open.length} document{open.length === 1 ? "" : "s"}
            </div>
            {open.map((d) => (
              <div
                key={d.id}
                className={`flex w-56 flex-none flex-col border-r border-rule-soft @5xl/page:w-full @5xl/page:border-b @5xl/page:border-r-0 ${d.id === selected.id ? "bg-accent-soft" : "hover:bg-paper"}`}
              >
                <button onClick={() => setSelectedId(d.id)} aria-pressed={d.id === selected.id} className="flex min-w-0 flex-col gap-0.5 px-3 pb-1.5 pt-2.5 text-left">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 break-words text-subheading font-semibold text-ink">{vendorOf(d)}</span>
                    <span className="tabular-nums text-meta text-ink-2">{money(d.amount_cents)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {sourceOf(d) === "scan" ? (
                      <Camera className="size-3 flex-none text-ink-3" aria-label="Phone scan" />
                    ) : sourceOf(d) === "text" ? (
                      <MessageSquareText className="size-3 flex-none text-ink-3" aria-label="Texted in" />
                    ) : null}
                    <Chip kind={KIND_CHIP[d.doc_kind]}>{KIND_LABEL[d.doc_kind]}</Chip>
                    {readingNow(d) && <Chip kind="ai">Reading…</Chip>}
                    {d.status === "needs_agent" && <Chip kind="ai">Claude filing</Chip>}
                    {d.status === "pending" && d.agent_note && <Chip kind="ai">Question</Chip>}
                    <span className="ml-auto tabular-nums text-meta text-ink-3">{day(d.received_at ?? d.created_at)}</span>
                  </div>
                  <div className="truncate text-meta text-ink-3">
                    {d.extracted?.job_hint ? <b className="font-semibold text-accent-2">“{d.extracted.job_hint}” · </b> : null}
                    {d.extracted?.summary || d.subject}
                  </div>
                </button>
                <DocThumbs doc={d} files={files} onView={(photos, index) => setViewer({ photos, index })} className="px-3 pb-2" />
              </div>
            ))}
          </Card>

          <details className="order-3 min-w-0 @4xl/page:order-none">
            <summary className="cursor-pointer py-3 text-label text-accent-2">Document facts & preview</summary>
            <div className="space-y-3">
            {(selected.extracted || selected.extract_state) && (
              <ReceiptFacts key={`f${selected.id}`} doc={selected} byslug={byslug} busy={busy} onReread={() => reread(selected.id)} />
            )}
            <DocPreview key={`p${selected.id}`} doc={selected} files={files} />
            </div>
          </details>
          <SortPanel key={`s${selected.id}`} doc={selected} projects={projects} byslug={byslug} busy={busy} onFile={file} onNote={note} />
        </div>
        </div>
      )}
      {viewer && (
        <Lightbox photos={viewer.photos} index={viewer.index} onClose={() => setViewer(null)} onIndexChange={(index) => setViewer({ ...viewer, index })} />
      )}
    </div>
  );
}

// ─── A card's attachments ────────────────────────────────────────────────────
// Photos as thumbnails that open the Files viewer; PDFs and the rest as links
// that open in a new tab. The email copy isn't repeated here.

const THUMBS_SHOWN = 4;

function DocThumbs({
  doc,
  files,
  onView,
  className = "",
}: {
  doc: UnsortedDocRow;
  files: Record<string, DocFile>;
  onView: (photos: LightboxPhoto[], index: number) => void;
  className?: string;
}) {
  const attached = doc.attachment_file_ids.map((id) => files[id]).filter(Boolean);
  if (!attached.length) return null;
  const photos: LightboxPhoto[] = attached
    .filter((f) => f.mime_type.startsWith("image/"))
    .map((f) => ({ id: f.id, src: `/api/files/${encodeURIComponent(f.id)}`, thumb: `/api/files/${encodeURIComponent(f.id)}?w=320`, name: f.name, caption: f.size_label, downloadHref: `/api/files/${encodeURIComponent(f.id)}?download=1` }));
  const shown = attached.slice(0, THUMBS_SHOWN);
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {shown.map((f) => {
        const src = `/api/files/${encodeURIComponent(f.id)}`;
        const i = photos.findIndex((p) => p.id === f.id);
        return i >= 0 ? (
          <button
            key={f.id}
            type="button"
            onClick={() => onView(photos, i)}
            title={f.name}
            aria-label={`View ${f.name}`}
            className="size-11 flex-none overflow-hidden rounded border border-rule bg-paper-3 hover:border-accent"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${src}?w=160`} alt="" loading="lazy" className="size-full object-cover" />
          </button>
        ) : (
          <a
            key={f.id}
            href={src}
            target="_blank"
            rel="noreferrer"
            title={`${f.name} (${f.size_label})`}
            className="inline-flex h-9 max-w-[9rem] items-center gap-1 rounded border border-rule-soft bg-paper-2 px-1.5 text-meta text-ink-2 hover:border-accent hover:text-ink"
          >
            <FileText className="size-3.5 flex-none text-ink-3" />
            <span className="truncate">{f.mime_type.startsWith("application/pdf") ? "PDF" : f.name.split(".").pop()?.toUpperCase()} · {f.name}</span>
          </a>
        );
      })}
      {attached.length > THUMBS_SHOWN && <span className="tabular-nums text-meta text-ink-3">+{attached.length - THUMBS_SHOWN}</span>}
    </div>
  );
}

// ─── What Claude read off the receipt ────────────────────────────────────────
// Shown first, above the photo: on a small texted receipt the store, the job
// written on it and the total are what you need to place it.

function ReceiptFacts({ doc, byslug, busy, onReread }: { doc: UnsortedDocRow; byslug: Map<string, ProjectChoice>; busy: boolean; onReread: () => void }) {
  const [allItems, setAllItems] = useState(false);
  const x = doc.extracted;
  const reading = readingNow(doc);
  const stuck = !reading && (doc.extract_state === "failed" || doc.extract_state === "reading");
  const canReread = doc.attachment_file_ids.length > 0;

  if (reading && !x) {
    return (
      <Card className="flex items-center gap-2.5 border-ai bg-ai-soft p-3.5 text-body text-ink-2">
        <Loader2 className="size-4 flex-none animate-spin text-ai-2" />
        Claude is reading the receipt — store, items, total and any job written on it.
      </Card>
    );
  }
  if (!x) {
    return (
      <Card className="flex flex-wrap items-center gap-2.5 p-3.5 text-body text-ink-2">
        <span className="min-w-0 flex-1">
          Claude couldn&apos;t read this one{doc.extract_error ? `: ${doc.extract_error}` : "."}
        </span>
        {canReread && (
          <button onClick={onReread} disabled={busy} className="inline-flex items-center gap-1 font-semibold text-accent-2 hover:underline disabled:opacity-50">
            <RefreshCw className="size-3.5" /> Read again
          </button>
        )}
      </Card>
    );
  }

  const items = allItems ? x.items : x.items.slice(0, 8);
  const when = [day(x.date), x.time].filter(Boolean).join(" · ");
  return (
    <Card className="flex flex-col gap-2.5 p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 tabular-nums text-meta text-ai-2">
            <Sparkles className="size-3" /> Read off the {x.kind === "invoice" ? "invoice" : "receipt"}
            {sourceOf(doc) === "text" ? " · texted in" : sourceOf(doc) === "scan" ? " · phone scan" : ""}
          </div>
          <div className="mt-0.5 break-words text-heading font-semibold leading-tight text-ink">{x.vendor || "Unknown store"}</div>
          {x.location && <div className="truncate text-meta text-ink-3">{x.location}</div>}
        </div>
        <div className="text-right">
          <div className="tabular-nums text-title font-semibold leading-tight text-ink">{x.total_cents == null ? "—" : money(x.total_cents)}</div>
          {when && <div className="tabular-nums text-meta text-ink-3">{when}</div>}
        </div>
      </div>

      {!x.is_receipt && (
        <div className="rounded-md bg-flag-soft px-2.5 py-1.5 text-meta text-ink">This doesn&apos;t look like a receipt.</div>
      )}

      {(x.job_hint || doc.sender_note || doc.sender_project_slug) && (
        <div className="flex flex-col gap-1 rounded-md border border-accent bg-accent-soft px-2.5 py-2 text-body text-ink">
          {x.job_hint && (
            <div>
              <span className="text-ink-3">Written on it: </span>
              <b className="font-semibold">{x.job_hint}</b>
            </div>
          )}
          {doc.sender_project_slug && (
            <div>
              <span className="text-ink-3">Sender picked: </span>
              <b className="font-semibold">{byslug.get(doc.sender_project_slug)?.name ?? doc.sender_project_slug}</b>
            </div>
          )}
          {doc.sender_note && (
            <div className="flex items-start gap-1">
              <PenLine className="mt-0.5 size-3 flex-none text-ink-3" />
              <span>
                <span className="text-ink-3">{doc.from_label.replace(/^Scanned by |^Text from /, "")} wrote: </span>“{doc.sender_note}”
              </span>
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-hidden rounded-md border border-rule-soft">
          <table className="w-full text-meta">
            <thead className="bg-paper-2 tabular-nums text-meta text-ink-3">
              <tr>
                <th className="w-10 px-2 py-1 text-right font-normal">Qty</th>
                <th className="px-2 py-1 text-left font-normal">Item</th>
                <th className="w-20 px-2 py-1 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-rule-soft align-top">
                  <td className="px-2 py-1 text-right tabular-nums text-ink-2">{it.qty ?? ""}</td>
                  <td className="px-2 py-1 text-ink">
                    {it.description}
                    {it.sku && <span className="ml-1 tabular-nums text-meta text-ink-3">{it.sku}</span>}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-ink-2">{money(it.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-rule bg-paper tabular-nums text-meta text-ink-2">
              {x.subtotal_cents != null && (
                <tr>
                  <td />
                  <td className="px-2 py-0.5 text-right text-ink-3">Subtotal</td>
                  <td className="px-2 py-0.5 text-right">{money(x.subtotal_cents)}</td>
                </tr>
              )}
              {x.tax_cents != null && (
                <tr>
                  <td />
                  <td className="px-2 py-0.5 text-right text-ink-3">Tax</td>
                  <td className="px-2 py-0.5 text-right">{money(x.tax_cents)}</td>
                </tr>
              )}
              <tr className="font-semibold text-ink">
                <td />
                <td className="px-2 py-0.5 text-right">Total</td>
                <td className="px-2 py-0.5 text-right">{x.total_cents == null ? "—" : money(x.total_cents)}</td>
              </tr>
            </tfoot>
          </table>
          {x.items.length > 8 && (
            <button onClick={() => setAllItems((v) => !v)} className="w-full border-t border-rule-soft py-1 text-meta font-semibold text-accent-2 hover:bg-paper">
              {allItems ? "Show fewer" : `Show all ${x.items.length} items`}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
        {x.number && <span>#{x.number}</span>}
        {x.payment && <span>{x.payment}</span>}
        {x.notes && <span className="text-ink-2">{x.notes}</span>}
        {reading ? (
          <span className="ml-auto inline-flex items-center gap-1 text-ai-2">
            <Loader2 className="size-3 animate-spin" /> Reading again…
          </span>
        ) : (
          canReread && (
            <button onClick={onReread} disabled={busy} className="ml-auto inline-flex items-center gap-1 hover:text-ink disabled:opacity-50">
              <RefreshCw className="size-3" /> {stuck ? "Read again" : "Re-read"}
            </button>
          )
        )}
      </div>
    </Card>
  );
}

// ─── Preview ─────────────────────────────────────────────────────────────────

function DocPreview({ doc, files }: { doc: UnsortedDocRow; files: Record<string, DocFile> }) {
  const tabs = [...doc.attachment_file_ids, ...(doc.email_file_id ? [doc.email_file_id] : [])].map((id) => files[id]).filter(Boolean);
  // A purchase whose only attachments are rebate forms (Menards' "11% Rebate"
  // PDF) has its items and total in the email body — open on the email.
  const rebateFormsOnly =
    doc.doc_kind !== "rebate" && !!doc.email_file_id && tabs.some((t) => t.id !== doc.email_file_id) &&
    tabs.every((t) => t.id === doc.email_file_id || /rebate/i.test(t.name));
  const [active, setActive] = useState((rebateFormsOnly ? doc.email_file_id : tabs[0]?.id) ?? null);
  const f = tabs.find((t) => t.id === active) ?? tabs[0];
  const isEmail = (x: DocFile) => x.id === doc.email_file_id;
  const src = f ? `/api/files/${encodeURIComponent(f.id)}` : "";

  return (
    <Card className="flex min-h-[420px] flex-col overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-1 border-b border-rule bg-paper-2 px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`inline-flex max-w-[220px] items-center gap-1.5 rounded-md px-2 py-1 text-meta ${t.id === f?.id ? "bg-card font-semibold text-ink shadow-card" : "text-ink-3 hover:text-ink"}`}
          >
            {isEmail(t) ? <Mail className="size-3.5 flex-none" /> : <FileText className="size-3.5 flex-none" />}
            <span className="truncate">{isEmail(t) ? "Email" : t.name}</span>
          </button>
        ))}
        {f && (
          <a href={`${src}?download=1`} className="ml-auto inline-flex size-9 max-sm:size-11 items-center justify-center rounded-md text-meta text-ink-3 hover:bg-hover hover:text-ink" aria-label="Download document" title="Download">
            <Download className="size-3.5" />
          </a>
        )}
      </div>
      <div className="min-h-0 flex-1 bg-paper">
        {!f ? (
          <div className="grid h-full place-items-center p-6 text-center text-body text-ink-3">
            No copy was saved with this one.{doc.subject && <> Subject: “{doc.subject}”.</>}
          </div>
        ) : f.mime_type.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={f.name} className="mx-auto max-h-[80vh] w-auto object-contain" />
        ) : f.mime_type.startsWith("application/pdf") ? (
          <iframe key={f.id} src={src} title={f.name} className="h-[62vh] w-full @2xl/page:h-[80vh]" />
        ) : f.mime_type.startsWith("text/html") ? (
          // The email is sanitized on the way in and served under a sandbox CSP;
          // the empty sandbox here keeps scripts and forms off as well.
          <iframe key={f.id} src={src} title="Email" sandbox="" className="h-[62vh] w-full @2xl/page:h-[80vh] bg-white" />
        ) : (
          <div className="grid h-full place-items-center p-6 text-body text-ink-3">
            <a href={`${src}?download=1`} className="inline-flex items-center gap-1.5 font-semibold text-accent-2 hover:underline">
              <Download className="size-4" /> {f.name} ({f.size_label})
            </a>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Where does it go ────────────────────────────────────────────────────────

function matches(p: ProjectChoice, q: string): boolean {
  const hay = `${p.name} ${p.client_name} ${p.address} ${p.slug}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

function SortPanel({
  doc,
  projects,
  byslug,
  busy,
  onFile,
  onNote,
}: {
  doc: UnsortedDocRow;
  projects: ProjectChoice[];
  byslug: Map<string, ProjectChoice>;
  busy: boolean;
  onFile: (doc: UnsortedDocRow, input: FileUnsortedInput, label: string) => void;
  onNote: (doc: UnsortedDocRow, text: string) => void;
}) {
  const [kind, setKind] = useState<DocKind>(doc.doc_kind);
  const [amount, setAmount] = useState(doc.amount_cents == null ? "" : (doc.amount_cents / 100).toFixed(2));
  const [vendor, setVendor] = useState(vendorOf(doc));
  const costable = kind === "invoice" || kind === "receipt";
  const amountCents = amount.trim() === "" ? null : Math.round(Number(amount.replace(/[$,\s]/g, "")) * 100);
  const amountOk = amountCents === null || Number.isFinite(amountCents);
  const [logCost, setLogCost] = useState(costable && doc.amount_cents != null);
  const willLog = costable && logCost && amountCents != null && amountOk && amountCents !== 0;
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const suggestions = doc.suggestions.map((s) => ({ ...s, project: byslug.get(s.project_slug) })).filter((s) => s.project);
  const hits = q.trim() ? projects.filter((p) => matches(p, q)).slice(0, 6) : [];

  function toProject(p: ProjectChoice) {
    if (!amountOk) return;
    const what = willLog ? `${money(amountCents)} ${kind === "invoice" ? "owed" : "spent"} logged; Claude is putting it under the right trade. ` : "";
    onFile(doc, { target: { to: "project", projectSlug: p.slug }, logCost: willLog, kind, amountCents, vendorLabel: vendor }, `${vendor} → ${p.name}. ${what}Files attached.`);
  }
  function toOverhead() {
    onFile(doc, { target: { to: "overhead" }, kind, amountCents: amountOk ? amountCents : undefined, vendorLabel: vendor }, `${vendor} → Overhead.`);
  }
  function dismiss() {
    onFile(doc, { target: { to: "dismiss" }, kind, vendorLabel: vendor }, `${vendor} set aside — not a business cost.`);
  }
  function sendNote() {
    const text = q.trim();
    if (text) onNote(doc, text);
  }

  // 1–5 picks a guess, o = overhead, / = search — when no field has focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (busy || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= suggestions.length) {
        e.preventDefault();
        toProject(suggestions[n - 1].project!);
      } else if (e.key === "o") {
        e.preventDefault();
        toOverhead();
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="order-2 flex min-w-0 flex-col gap-3 @4xl/page:order-none">
      <Card className="p-3.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="break-words text-subheading font-semibold text-ink">{vendorOf(doc)}</div>
            <div className="break-words text-meta text-ink-3">{doc.from_label}</div>
          </div>
          <div className="text-right">
            <div className="tabular-nums text-subheading font-semibold text-ink">{money(doc.amount_cents)}</div>
            <div className="tabular-nums text-meta text-ink-3">{day(doc.doc_date ?? doc.received_at)}{doc.doc_number && ` · #${doc.doc_number}`}</div>
          </div>
        </div>
        {(doc.summary || doc.why_unsure) && (
          <div className="mt-2.5 rounded-md border border-ai bg-ai-soft px-2.5 py-2 text-meta text-ink-2">
            <div className="mb-0.5 flex items-center gap-1 tabular-nums text-meta text-ai-2">
              <Sparkles className="size-3" /> {doc.staged_by || "Agent"}
            </div>
            {doc.summary && <p>{doc.summary}</p>}
            {doc.why_unsure && <p className="mt-1 text-ink-3">Not sure because: {doc.why_unsure}</p>}
          </div>
        )}
        {doc.status === "needs_agent" && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-paper-2 px-2.5 py-2 text-meta text-ink-2">
            <Bot className="mt-0.5 size-3.5 flex-none animate-pulse text-ai-2" />
            <span>
              Claude is filing it from your note: “{doc.owner_note}”. Usually under a minute — or pick a spot yourself.
            </span>
          </div>
        )}
        {doc.status === "pending" && doc.agent_note && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md border border-ai bg-ai-soft px-2.5 py-2 text-meta text-ink">
            <Bot className="mt-0.5 size-3.5 flex-none text-ai-2" />
            <span>
              <b className="font-semibold">Claude asks:</b> {doc.agent_note}
              {doc.owner_note && <span className="block text-ink-3">Your note was “{doc.owner_note}”.</span>}
            </span>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-3.5">
        <div className="tabular-nums text-meta text-ink-3">Where does it go?</div>
        <p className="text-meta text-ink-2">Choose a destination below to file this document.</p>
        {suggestions.map((s, i) => (
          <button
            key={s.project_slug}
            disabled={busy}
            onClick={() => toProject(s.project!)}
            className="group flex items-start gap-2.5 rounded-lg border border-rule bg-card px-3 py-2 text-left hover:border-accent hover:bg-accent-soft disabled:opacity-50"
          >
            <kbd className="mt-0.5 grid size-5 flex-none place-items-center rounded border border-rule bg-paper-2 tabular-nums text-meta text-ink-3">{i + 1}</kbd>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-subheading font-semibold text-ink">File to {s.project!.name}</span>
              <span className="block text-meta leading-snug text-ink-3">{s.reason || s.project!.client_name}</span>
            </span>
          </button>
        ))}
        <button
          disabled={busy}
          onClick={toOverhead}
          className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left disabled:opacity-50 ${doc.overhead_likely ? "border-accent bg-accent-soft" : "border-rule bg-card hover:border-accent hover:bg-accent-soft"}`}
        >
          <kbd className="grid size-5 flex-none place-items-center rounded border border-rule bg-paper-2 tabular-nums text-meta text-ink-3">O</kbd>
          <Building2 className="size-3.5 flex-none text-ink-3" />
          <span className="flex-1 text-body font-semibold text-ink">File as overhead</span>
          <span className="text-meta text-ink-3">company, not a job</span>
        </button>

        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-ink-3" />
          <input
            aria-label="Find a project or tell the agent"
            ref={searchRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHi(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHi((h) => Math.min(h + 1, Math.max(hits.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHi((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (hits[hi]) toProject(hits[hi]);
                else sendNote();
              } else if (e.key === "Escape") {
                setQ("");
                e.currentTarget.blur();
              }
            }}
            placeholder="Another project, or tell the agent…"
            className="w-full rounded-lg border border-rule bg-paper py-2 pl-8 pr-2 text-body text-ink placeholder:text-ink-3"
          />
          {q.trim() && (
            <div className="mt-1 overflow-hidden rounded-lg border border-rule bg-card">
              {hits.map((p, i) => (
                <button
                  key={p.slug}
                  disabled={busy}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => toProject(p)}
                  className={`flex w-full flex-col px-3 py-1.5 text-left ${i === hi ? "bg-accent-soft" : ""}`}
                >
                  <span className="break-words text-body font-semibold text-ink">{p.name}</span>
                  <span className="truncate text-meta text-ink-3">{[p.client_name, p.address].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
              <button
                disabled={busy}
                onClick={sendNote}
                className={`flex w-full items-center gap-2 border-t border-rule-soft px-3 py-2 text-left text-meta text-ai-2 hover:bg-ai-soft ${hits.length === 0 ? "bg-ai-soft" : ""}`}
              >
                <Send className="size-3.5 flex-none" />
                <span className="min-w-0 flex-1 truncate">Tell the agent: “{q.trim()}”</span>
              </button>
            </div>
          )}
        </div>
      </Card>

      <details className="rounded-lg border border-rule-soft bg-card p-3.5 text-body">
        <summary className="cursor-pointer text-label text-accent-2">Edit filing details</summary>
        <div className="grid grid-cols-[70px_1fr] items-center gap-x-2 gap-y-1.5">
          <label className="text-ink-3" htmlFor="u-kind">Type</label>
          <select
            id="u-kind"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as DocKind;
              setKind(k);
              setLogCost((k === "invoice" || k === "receipt") && amount.trim() !== "");
            }}
            className="h-9 min-w-0 max-sm:h-11 rounded-md border border-rule bg-card px-2 text-ink"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <label className="text-ink-3" htmlFor="u-vendor">From</label>
          <input id="u-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} className="h-9 min-w-0 max-sm:h-11 rounded-md border border-rule bg-card px-2 text-ink" />
          <label className="text-ink-3" htmlFor="u-amt">Amount</label>
          <input
            id="u-amt"
            value={amount}
            inputMode="decimal"
            placeholder="0.00"
            onChange={(e) => setAmount(e.target.value)}
            className={`h-9 min-w-0 max-sm:h-11 rounded-md border bg-card px-2 tabular-nums text-ink ${amountOk ? "border-rule" : "border-flag"}`}
          />
        </div>
        {costable && (
          <label className="mt-1 flex items-start gap-2 text-ink-2">
            <input type="checkbox" checked={logCost} onChange={(e) => setLogCost(e.target.checked)} className="mt-0.5" />
            <span>
              Log the cost on the job
              <span className="block text-meta text-ink-3">
                {kind === "invoice" ? "As a bill owed (Money › Overview)." : "As an expense paid by card."}{" "}
                Untick if it&apos;s already entered.
              </span>
            </span>
          </label>
        )}
        <details className="relative mt-1 self-start">
          <summary className="flex min-h-9 max-sm:min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-label font-semibold text-ink-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"><MoreHorizontal className="size-4" /> More actions</summary>
          <div className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-lg border border-rule-soft bg-card p-1 shadow-pop">
            <Button variant="ghost" onClick={dismiss} disabled={busy} className="h-auto min-h-9 w-full justify-start whitespace-normal py-2 text-left text-flag">Not a business cost — set it aside</Button>
          </div>
        </details>
      </details>
    </div>
  );
}

// ─── Filed lately ────────────────────────────────────────────────────────────

function FiledList({
  docs,
  files,
  busy,
  onUndo,
  onView,
}: {
  docs: UnsortedDocRow[];
  files: Record<string, DocFile>;
  busy: boolean;
  onUndo: (id: number) => void;
  onView: (photos: LightboxPhoto[], index: number) => void;
}) {
  if (!docs.length) {
    return <EmptyState icon={FileText} title="No documents filed yet" description="Receipts and invoices appear here after you file them to a job, overhead, or set them aside. You can undo a filing here." />;
  }
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-rule bg-paper-2 px-4 py-2 tabular-nums text-meta text-ink-3">
        Filed lately · by you and the agents
      </div>
      {docs.map((d, i) => (
        <div key={d.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 ${i ? "border-t border-rule-soft" : ""}`}>
          <div className="min-w-[12rem] flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="max-w-full break-words text-subheading font-semibold text-ink">{vendorOf(d)}</span>
              <Chip kind={KIND_CHIP[d.doc_kind]}>{KIND_LABEL[d.doc_kind]}</Chip>
              <span className="tabular-nums text-meta text-ink-2">{money(d.amount_cents)}</span>
            </div>
            <div className="truncate text-meta text-ink-3">{d.subject}</div>
            <DocThumbs doc={d} files={files} onView={onView} className="mt-1" />
          </div>
          <div className="max-w-[26rem] text-meta text-ink-2">
            {d.status === "dismissed" ? (
              <span className="text-ink-3">Set aside</span>
            ) : d.filed_to === "overhead" ? (
              "Overhead"
            ) : d.filed_project_slug ? (
              <Link href={`/projects/${d.filed_project_slug}`} className="font-semibold text-accent-2 hover:underline">
                {d.filed_project_name}
              </Link>
            ) : (
              "Project removed"
            )}
            {d.cost_source && <span className="text-ink-3"> · cost logged</span>}
            {d.agent_note ? (
              <span className="mt-0.5 flex items-start gap-1 text-meta text-ai-2">
                <Bot className="mt-px size-3 flex-none" /> {d.agent_note}
              </span>
            ) : (
              d.cost_source &&
              d.resolved_by === "owner" && (
                <span className="mt-0.5 flex items-center gap-1 text-meta text-ink-3">
                  <Bot className="size-3 flex-none animate-pulse text-ai-2" /> Claude is putting the cost under the right trade…
                </span>
              )
            )}
          </div>
          <div className="w-28 text-right tabular-nums text-meta text-ink-3">
            {d.resolved_by === "owner" ? "you" : d.resolved_by} · {day(d.resolved_at)}
          </div>
          <Button onClick={() => onUndo(d.id)} disabled={busy} variant="secondary" icon={Undo2}>Undo</Button>
        </div>
      ))}
    </Card>
  );
}
