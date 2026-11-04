"use client";

// One document-type's list + editor within the top-level Documents tab (one
// instance per template — Contract, Change Order, etc. — via PanelSections in
// app/projects/[slug]/page.tsx). Replaces the old all-templates ProjectDocuments
// list: the editor is modeled on the lead rough-estimate generator
// (components/leads/LeadEstimate.tsx) — always open, no field lock/unlock
// ceremony, and a live inline PDF preview that refreshes on save. "Save &
// preview" merges what used to be two separate clicks (Save fields, then
// Render PDF + DOCX); sending stays its own deliberate, never-automatic step.
//
// There's no separate Signatures tab anymore — a document's status chip here
// ("Signed", "Sent for signature", …) IS the signed/not-signed label. Editing a
// sent/signed draft prompts to confirm first (it voids the signature request);
// deleting a never-sent draft removes it outright, but a sent/signed one can
// only be voided, keeping the audit trail.

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Sparkles, Check, Clock, Ban, FileDown, PenLine, RefreshCw, TriangleAlert } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { dollarsToCents, centsToInput, fmtUsd } from "@/lib/cost-book-units";
import type { TemplateManifest } from "@/lib/doc-templates/registry";
import {
  createDocDraftAction,
  updateDocDraftFieldsAction,
  renderDocDraftAction,
  submitDocDraftForSignatureAction,
  retryDocDraftSignatureDeliveryAction,
  prepareInPersonSigningAction,
  setDocDraftVisibilityAction,
  voidDocDraftAction,
  deleteDocDraftAction,
  unlockDocDraftForEditAction,
  draftDocNarrative,
} from "@/lib/actions/doc-drafts";
import type { SignatureDelivery } from "@/lib/esign-types";
import { runAction } from "@/lib/run-action";

export interface DocDraftItem {
  id: number;
  template_key: string;
  title: string;
  status: string;
  client_visible: boolean;
  field_values: Record<string, unknown>;
  fill_report: Record<string, string>;
  missing: string[];
  pdf_file_id: string | null;
  docx_file_id: string | null;
  /** Linked signature request (once sent for signature); anchors ?focus= deep links. */
  signature_request_id?: number | null;
  /** The estimate a Formal Estimate copy was made from — its lines and totals come from it. */
  estimate_id?: number | null;
  /** Formal Estimate only: the estimate's lines changed since this PDF was made. */
  lines_changed?: boolean;
  createdAtLabel: string;
  signerName: string;
  signedName: string | null;
  signedAtLabel: string | null;
  sentAtLabel: string | null;
  declineReason: string | null;
  manifest: TemplateManifest;
  delivery?: SignatureDelivery;
}

const STATUS_KIND: Record<string, "money" | "accent" | "flag" | "ghost"> = {
  signed: "money",
  submitted: "accent",
  rendered: "ghost",
  draft: "ghost",
  void: "ghost",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  rendered: "Rendered",
  submitted: "Awaiting signature",
  signed: "Signed",
  void: "Voided",
};
// Which template keys can be submitted for signature (invoice_doc cannot).
const SIGNABLE = new Set(["contract", "precon", "lien_release", "completion_cert", "change_order", "estimate_doc"]);
// A Formal Estimate copy's lines and totals come from its estimate (every
// render pulls them in), so the editor shows them read-only.
// lib/doc-templates/fill-validate.ts ESTIMATE_LINE_FIELDS
const ESTIMATE_LINE_FIELDS = new Set(["line_items_table", "subtotal", "total"]);
const fromEstimateLines = (d: DocDraftItem) => d.template_key === "estimate_doc" && !!d.estimate_id;

/** For templates that are GENERATED FROM one record — the Formal Estimate and
 *  Contract from an estimate's lines, the Change Order from a change order,
 *  the Invoice from an invoice — the panel offers the job's records to pick
 *  from instead of creating a blank draft that can never render.
 *  docs/estimates-and-change-orders.md. */
export interface DocSourcePicker {
  /** Which FillScope key the chosen id goes under. */
  scopeKey: "estimateId" | "changeOrderId" | "invoiceId";
  /** One line under the header: what this document is made from, and where that lives. */
  explainer: string;
  /** Label on the picker ("Estimate"). */
  label: string;
  options: { id: number; label: string }[];
  /** Shown instead of the New button when there is nothing to pick from. */
  empty: ReactNode;
}

export function DocTypePanel({
  slug,
  leadSlug,
  projectSlug,
  templateKey,
  manifest,
  drafts,
  source,
  estimateId,
  heading,
  note,
}: {
  slug?: string;
  leadSlug?: string;
  /** Converted project, for the lead Formal Estimate handoff. */
  projectSlug?: string;
  templateKey: string;
  manifest: TemplateManifest;
  drafts: DocDraftItem[];
  source?: DocSourcePicker;
  /** Shown inside one estimate (Documents › Formal Estimate): the client's PDF
   *  of that estimate, made from its lines — no header, no picker. */
  estimateId?: number;
  /** Header override (default: the template title). */
  heading?: string;
  /** One line under the header when there's no source picker. */
  note?: string;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState(false);
  const [sourceId, setSourceId] = useState<number | null>(source?.options[0]?.id ?? null);

  // Failures toast via runAction; there's no inline error line at this level.
  function create(fromId?: number) {
    const scope = leadSlug ? { leadSlug } : { slug };
    if (estimateId != null) {
      Object.assign(scope, { estimateId });
    } else if (source) {
      if (fromId == null) return;
      Object.assign(scope, { [source.scopeKey]: fromId });
    }
    startTransition(async () => {
      const res = await runAction(() => createDocDraftAction(templateKey, scope), { fallback: "Couldn't create the document." });
      if (res.ok && "id" in res) {
        setPicking(false);
        setEditingId(res.id as number);
        router.refresh();
      }
    });
  }

  function edit(d: DocDraftItem) {
    if (d.status === "submitted" || d.status === "signed") {
      const ok = window.confirm(
        `This document has already been ${d.status === "signed" ? "signed" : "sent"} — editing it will void ` +
          "the signature request. The client will need to sign a new version. Continue?",
      );
      if (!ok) return;
      startTransition(async () => {
        const res = await runAction(() => unlockDocDraftForEditAction(d.id), { fallback: "Couldn't unlock the document." });
        if (res.ok) {
          setEditingId(d.id);
          router.refresh();
        }
      });
      return;
    }
    setEditingId(d.id);
  }

  function remove(d: DocDraftItem) {
    const sent = d.status === "submitted" || d.status === "signed";
    const msg = sent
      ? "This document has been sent/signed — it can't be deleted, only voided (the record is kept). Void it?"
      : "Delete this document draft? This can't be undone.";
    if (!window.confirm(msg)) return;
    startTransition(async () => {
      await runAction(() => (sent ? voidDocDraftAction(d.id) : deleteDocDraftAction(d.id)), {
        fallback: sent ? "Couldn't void the document." : "Couldn't delete the document.",
      });
      router.refresh();
    });
  }

  /** Re-render a Formal Estimate copy — the render pulls in the estimate's
   *  current lines. Nothing is emailed; a published copy is simply replaced. */
  function update(d: DocDraftItem) {
    setNotice(null);
    startTransition(async () => {
      const res = await runAction(() => renderDocDraftAction(d.id), { fallback: "Couldn't update the PDF." });
      if (!res.ok) return;
      setNotice(
        d.client_visible
          ? "PDF updated from the lines. The client's dashboard now shows the new one; nothing was emailed."
          : "PDF updated from the lines.",
      );
      router.refresh();
    });
  }

  /** Publish/unpublish a document on the client dashboard. Publishing emails
   *  the client — surface the delivery note so "sent" is never a guess. */
  function publish(d: DocDraftItem, to: boolean) {
    setNotice(null);
    startTransition(async () => {
      const res = await runAction(() => setDocDraftVisibilityAction(d.id, to), {
        fallback: to ? "Couldn't publish the document." : "Couldn't unpublish the document.",
      });
      if (!res.ok) return;
      setNotice(to ? (res.delivery?.note ?? "Published.") : "Removed from the client dashboard.");
      router.refresh();
    });
  }

  function retry(d: DocDraftItem) {
    setNotice(null);
    startTransition(async () => {
      const res = await runAction(() => retryDocDraftSignatureDeliveryAction(d.id), { fallback: "Couldn't retry the signature email." });
      if (res.ok) setNotice(res.delivery.note);
      router.refresh();
    });
  }

  if (leadSlug && templateKey === "estimate_doc") {
    return (
      <Card className="p-4">
        <h3 className="font-serif text-heading font-semibold text-ink">Formal Estimate</h3>
        <p className="mt-1 text-label text-ink-3">
          A lead uses the Rough estimate. The Formal Estimate is prepared on the project after conversion.
        </p>
        <Link
          href={projectSlug ? `/projects/${projectSlug}?tab=Documents&focus=formal-estimate` : `/leads/${leadSlug}?tab=Rough%20estimate`}
          className="mt-2 inline-block text-label font-semibold text-accent-2 hover:underline"
        >
          {projectSlug ? "Open the project's Formal Estimate →" : "Open Rough estimate →"}
        </Link>
      </Card>
    );
  }

  const editing = editingId != null ? drafts.find((d) => d.id === editingId) ?? null : null;
  const rows = drafts.map((d) => (
    <DraftRow
      key={d.id}
      draft={d}
      pending={pending}
      soft={estimateId != null}
      onEdit={() => edit(d)}
      onDelete={() => remove(d)}
      onPublish={(to) => publish(d, to)}
      onUpdate={() => update(d)}
      onRetry={() => retry(d)}
    />
  ));

  // Inside one estimate: the client's PDF of it, and a button to make one.
  if (estimateId != null) {
    const hasLiveCopy = drafts.some((d) => d.status !== "void");
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-meta text-ink-3">Client PDF</span>
          {!editing && !hasLiveCopy && (
            <button
              type="button"
              onClick={() => create()}
              disabled={pending}
              className="inline-flex flex-none items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-meta font-semibold text-paper hover:bg-ink-hover disabled:opacity-60"
            >
              <Plus className="size-3" strokeWidth={2} /> {pending ? "Making…" : "Make client PDF"}
            </button>
          )}
        </div>
        {notice && <div className="text-label text-money">{notice}</div>}
        {editing ? (
          <DraftEditor key={editing.id} draft={editing} onClose={() => setEditingId(null)} />
        ) : drafts.length === 0 ? (
          <div className="text-label text-ink-3">No client PDF yet. Make one when the lines are ready; it&rsquo;s printed from them.</div>
        ) : (
          <div className="space-y-2">{rows}</div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-[820px] space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 @2xl/page:flex-row">
        <div className="min-w-0">
          <h3 className="font-serif text-heading font-semibold text-ink">{heading ?? manifest.title}</h3>
          <div className="mt-0.5 text-meta text-ink-3">
            {drafts.length} document{drafts.length === 1 ? "" : "s"}
          </div>
          {source ? (
            <div className="mt-1 text-label text-ink-3">{source.explainer}</div>
          ) : (
            note && <div className="mt-1 text-label text-ink-3">{note}</div>
          )}
        </div>
        {!editing && !note && (!source || source.options.length > 0) && (
          <button
            type="button"
            onClick={() => (source ? setPicking((v) => !v) : create())}
            disabled={pending}
            className="inline-flex flex-none items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-label font-semibold text-paper hover:bg-ink-hover disabled:opacity-60"
          >
            <Plus className="size-3" strokeWidth={2} /> {picking ? "Cancel" : `New ${manifest.title}`}
          </button>
        )}
      </div>

      {source && source.options.length === 0 && !editing && (
        <Card kind="dashed" className="p-3.5 text-label text-ink-2">{source.empty}</Card>
      )}

      {source && picking && !editing && (
        <Card className="p-3.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create(sourceId ?? undefined);
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex min-w-[260px] flex-1 flex-col gap-1">
              <span className="text-meta text-ink-3">{source.label}</span>
              <select
                value={sourceId ?? ""}
                onChange={(e) => setSourceId(Number(e.target.value))}
                className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-body text-ink outline-none focus:border-accent"
              >
                {source.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={pending || sourceId == null}
              className="rounded-md border border-accent bg-accent px-3 py-1.5 text-label font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
            >
              {pending ? "Creating…" : `Create ${manifest.title}`}
            </button>
          </form>
        </Card>
      )}

      {notice && <div className="text-label text-money">{notice}</div>}

      {editing ? (
        <DraftEditor key={editing.id} draft={editing} onClose={() => setEditingId(null)} />
      ) : drafts.length === 0 ? (
        <Card kind="dashed" className="p-8 text-center">
          <FileText className="mx-auto size-5 text-ink-3" strokeWidth={1.5} />
          <div className="mt-2 font-serif text-subheading font-semibold text-ink-2">No {manifest.title.toLowerCase()} yet</div>
          <div className="mt-1 text-label text-ink-3">
            Start one from the template, fill it in, and send it for signature when it&rsquo;s ready.
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">{rows}</div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "signed") return <Check className="size-3.5 text-money" strokeWidth={2} />;
  if (status === "void") return <Ban className="size-3.5 text-ink-3" strokeWidth={1.75} />;
  if (status === "submitted") return <Clock className="size-3.5 text-accent" strokeWidth={1.75} />;
  return <FileText className="size-3.5 text-ink-3" strokeWidth={1.75} />;
}

function DraftRow({
  draft,
  pending,
  soft,
  onEdit,
  onDelete,
  onPublish,
  onUpdate,
  onRetry,
}: {
  draft: DocDraftItem;
  pending: boolean;
  /** Sitting inside another card (the estimate) — a quieter surface. */
  soft?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: (to: boolean) => void;
  onUpdate: () => void;
  onRetry: () => void;
}) {
  const fileHref = (id: string | null) => (id ? `/api/files/${id}` : null);
  const failedDelivery = draft.status === "submitted" && draft.delivery?.status === "failed";
  const canRetry = draft.status === "submitted" && !["sent", "pending"].includes(draft.delivery?.status ?? "unknown");
  const sentOrSigned = draft.status === "submitted" || draft.status === "signed";
  const editable = draft.status === "draft" || draft.status === "rendered";
  const stale = !!draft.lines_changed && draft.status !== "void";
  // Publishable once a PDF exists (rendered/submitted/signed) and not voided —
  // and, for a Formal Estimate copy, only while it matches the lines.
  const canPublish = !!draft.pdf_file_id && draft.status !== "void" && (!stale || draft.client_visible);
  // Print (or re-print) a Formal Estimate copy from the estimate's current lines.
  const canUpdate = fromEstimateLines(draft) && editable && (stale || !draft.pdf_file_id);

  return (
    <Card
      kind={soft ? "soft" : "default"}
      className="p-3.5"
      data-focus={draft.signature_request_id ? `signature-${draft.signature_request_id}` : `draft-${draft.id}`}
    >
      <div className="flex flex-col gap-3 @4xl/page:flex-row @4xl/page:items-start">
        <StatusIcon status={draft.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-serif text-subheading font-semibold text-ink">{draft.title}</span>
            <Chip kind={failedDelivery ? "flag" : STATUS_KIND[draft.status] ?? "ghost"}>{failedDelivery ? "Email not delivered" : STATUS_LABEL[draft.status] ?? draft.status}</Chip>
            {draft.client_visible && (
              <Chip kind="money" dot>
                On dashboard
              </Chip>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-meta text-ink-3">
            {draft.status === "signed" && draft.signedName ? (
              <span>
                Signed by {draft.signedName}
                {draft.signedAtLabel ? ` · ${draft.signedAtLabel}` : ""}
              </span>
            ) : draft.status === "submitted" ? (
              <span>
                {draft.delivery?.status === "sent" ? "Emailed to " : "Awaiting signature from "}{draft.signerName || "client"}
              </span>
            ) : (
              <span>Created {draft.createdAtLabel}</span>
            )}
            {fileHref(draft.pdf_file_id) && (
              <a href={fileHref(draft.pdf_file_id)!} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-semibold text-accent-2 hover:underline">
                <FileText className="size-3" strokeWidth={1.75} /> PDF
              </a>
            )}
            {fileHref(draft.docx_file_id) && (
              <a href={fileHref(draft.docx_file_id)!} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-semibold text-accent-2 hover:underline">
                <FileDown className="size-3" strokeWidth={1.75} /> DOCX
              </a>
            )}
          </div>
          {draft.status === "submitted" && draft.delivery?.status !== "sent" && (
            <p className="mt-1.5 text-label text-flag">
              {draft.delivery?.note || "Email delivery is unconfirmed. Retry the email or have the client sign in person."}
            </p>
          )}
          {stale && (
            <div className="mt-1.5 flex items-start gap-1.5 text-label text-flag">
              <TriangleAlert className="mt-0.5 size-3.5 flex-none" strokeWidth={1.75} />
              <span>
                {draft.status === "signed"
                  ? "The estimate's lines changed after the client signed this PDF."
                  : draft.status === "submitted"
                    ? "The estimate's lines changed after this PDF went out for signature. Edit it to send a new version; the client signs again."
                    : `The estimate's lines changed since this PDF was made. Update PDF to bring them in${
                        draft.client_visible ? " (the client's dashboard still shows the old one)" : ""
                      }.`}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 @4xl/page:flex-none">
          {canRetry && (
            <button type="button" onClick={onRetry} disabled={pending} className="rounded-md border border-rule bg-card px-2 py-1 text-meta font-semibold text-ink-2 disabled:opacity-60">
              Retry email
            </button>
          )}
          {canUpdate && (
            <button
              type="button"
              onClick={onUpdate}
              disabled={pending}
              title="Print the PDF again from the estimate's current lines (nothing is emailed)"
              className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent px-2 py-1 text-meta font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
            >
              <RefreshCw className="size-3" strokeWidth={2} />
              {draft.pdf_file_id ? "Update PDF" : "Make PDF"}
            </button>
          )}
          {draft.status === "submitted" && draft.signature_request_id && (
            <Link
              href={`/sign/${draft.signature_request_id}`}
              title="Client is here? Open this document on this device for them to sign now"
              className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-meta font-semibold text-ink-2 hover:bg-paper-2"
            >
              <PenLine className="size-3" strokeWidth={2} />
              Sign in person
            </Link>
          )}
          {canPublish && (
            <button
              type="button"
              onClick={() => onPublish(!draft.client_visible)}
              disabled={pending}
              title={
                draft.client_visible
                  ? "Remove from the client dashboard"
                  : "Publish to the client dashboard (emails the client)"
              }
              className={
                draft.client_visible
                  ? "rounded-md border border-rule bg-card px-2 py-1 text-meta font-semibold text-ink-3 hover:bg-paper-2 disabled:opacity-60"
                  : "rounded-md border border-accent bg-accent px-2 py-1 text-meta font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
              }
            >
              {draft.client_visible ? "Unpublish" : "Publish"}
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            disabled={pending}
            className="rounded-md border border-rule bg-card px-2 py-1 text-meta font-semibold text-ink-3 hover:bg-paper-2 disabled:opacity-60"
          >
            Edit
          </button>
          {draft.status !== "void" && (
            <details className="relative">
              <summary aria-label={`More actions for ${draft.title}`} className="flex size-7 cursor-pointer list-none items-center justify-center rounded-md border border-rule text-body hover:bg-hover">…</summary>
              <div className="absolute right-0 z-30 mt-1 min-w-32 rounded-lg border border-rule-soft bg-card p-1 shadow-pop">
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded-md border border-rule bg-card px-2 py-1 text-meta font-semibold text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-60"
            >
              {sentOrSigned ? "Void" : "Delete"}
            </button>
              </div>
            </details>
          )}
        </div>
      </div>
    </Card>
  );
}

function DraftEditor({ draft, onClose }: { draft: DocDraftItem; onClose: () => void }) {
  const router = useRouter();
  const [previewVer, setPreviewVer] = useState(0);
  const [saving, startSave] = useTransition();
  const [sending, startSend] = useTransition();
  const [drafting, startDraftAi] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  // What actually happened to the outbound email. Kept distinct from `error`:
  // the request IS recorded either way, so a failed email is a warning about
  // delivery, not a failed send.
  const [delivery, setDelivery] = useState<{ sent: boolean; note: string } | null>(null);

  function buildEdits(fd: FormData): Record<string, unknown> {
    const edits: Record<string, unknown> = {};
    for (const f of draft.manifest.fields) {
      if (f.kind === "table" || !fd.has(f.key)) continue;
      const raw = String(fd.get(f.key) ?? "");
      if (f.kind === "money_cents") {
        if (raw.trim() === "") continue;
        edits[f.key] = dollarsToCents(raw);
      } else {
        edits[f.key] = raw;
      }
    }
    return edits;
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const edits = buildEdits(new FormData(e.currentTarget));
    startSave(async () => {
      const res1 = await runAction(() => updateDocDraftFieldsAction(draft.id, edits), { fallback: "Couldn't save the fields." });
      if (!res1.ok) return setError(res1.error);
      const res2 = await runAction(() => renderDocDraftAction(draft.id), { fallback: "Couldn't render the preview." });
      if (!res2.ok) setError(res2.error);
      setPreviewVer((v) => v + 1);
      router.refresh();
    });
  }

  function draftAi(fieldKey: string) {
    setError(null);
    startDraftAi(async () => {
      const res = await runAction(() => draftDocNarrative(draft.id, fieldKey), { fallback: "Couldn't draft that field." });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function send() {
    setError(null);
    setDelivery(null);
    startSend(async () => {
      const res = await runAction(() => submitDocDraftForSignatureAction(draft.id, override), { fallback: "Couldn't send the document." });
      if (!res.ok) setError(res.error);
      else {
        setDelivery(res.delivery);
        router.refresh();
      }
    });
  }

  // Client is here: create the request without emailing and open the
  // in-person signing screen on this device.
  function signInPerson() {
    setError(null);
    setDelivery(null);
    startSend(async () => {
      const res = await runAction(() => prepareInPersonSigningAction(draft.id, override), { fallback: "Couldn't prepare the document for signing." });
      if (!res.ok) setError(res.error);
      else router.push(`/sign/${res.signatureRequestId}`);
    });
  }

  const canSend = draft.status === "rendered" && SIGNABLE.has(draft.template_key) && !draft.lines_changed;
  const linesLocked = fromEstimateLines(draft);
  const awaitingSignature = draft.status === "submitted" && !!draft.signature_request_id;
  const showGateOverride = draft.template_key === "contract";
  const busy = saving || sending || drafting;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="font-serif text-subheading font-semibold text-ink">{draft.title}</span>
          <Chip kind={STATUS_KIND[draft.status] ?? "ghost"}>{STATUS_LABEL[draft.status] ?? draft.status}</Chip>
        </div>
        <button type="button" onClick={onClose} className="text-meta font-semibold text-ink-3 hover:text-ink">
          Close
        </button>
      </div>

      {draft.missing.length > 0 && (
        <div className="mt-1 text-meta text-flag">Still need: {draft.missing.map(key => draft.manifest.fields.find(field => field.key === key)?.label || key.replaceAll("_", " ")).join(", ")}</div>
      )}
      {linesLocked && (
        <div className="mt-1 text-meta text-ink-3">
          The lines and totals come from the estimate. Change them there; Save &amp; preview prints the current lines.
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="mt-3 grid grid-cols-1 gap-3 @xl/page:grid-cols-2">
          {draft.manifest.fields
            .filter((f) => f.kind !== "table" && !f.key.startsWith("company_"))
            .map((f) => (
              <FieldRow
                key={f.key}
                field={f}
                value={draft.field_values[f.key]}
                mark={draft.fill_report[f.key]}
                onDraftAI={f.source === "ai" ? () => draftAi(f.key) : undefined}
                pending={busy}
                fromLines={linesLocked && ESTIMATE_LINE_FIELDS.has(f.key)}
              />
            ))}
        </div>

        {showGateOverride && (
          <label className="flex items-center gap-1.5 text-meta text-ink-3">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Override the pre-con approval gate (design / selections / estimate sign-offs) and send anyway
          </label>
        )}

        {error && <div className="text-label text-flag">{error}</div>}

        {delivery && (
          <div className={`text-label ${delivery.sent ? "text-money" : "text-flag"}`}>
            {delivery.sent ? "Sent · " : "Recorded, but not delivered · "}
            {delivery.note}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-label font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save & preview"}
          </button>
          {canSend && (
            <button
              type="button"
              onClick={send}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-ink bg-ink px-3 py-1.5 text-label font-semibold text-paper hover:bg-ink-hover disabled:opacity-60"
            >
              {sending ? "Sending…" : draft.template_key === "contract" ? "Send Contract" : "Send for signature"}
            </button>
          )}
          {canSend && (
            <button
              type="button"
              onClick={signInPerson}
              disabled={busy}
              title="Open this document on this device for the client to sign right now — nothing is emailed"
              className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-card px-3 py-1.5 text-label font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-60"
            >
              <PenLine className="size-3.5" strokeWidth={2} />
              {sending ? "Preparing…" : "Sign in person"}
            </button>
          )}
          {awaitingSignature && (
            <Link
              href={`/sign/${draft.signature_request_id}`}
              title="Open this document on this device for the client to sign right now"
              className="inline-flex items-center gap-1.5 rounded-md border border-rule bg-card px-3 py-1.5 text-label font-semibold text-ink-2 hover:bg-paper-2"
            >
              <PenLine className="size-3.5" strokeWidth={2} />
              Sign in person
            </Link>
          )}
        </div>
      </form>

      <div className="mt-4">
        <div className="mb-1 text-meta text-ink-3">
          Preview · what the client will see
        </div>
        <iframe
          key={previewVer}
          src={`/api/doc-drafts/${draft.id}/preview?v=${previewVer}`}
          title={`${draft.title} preview`}
          className="h-[560px] w-full rounded-md border border-rule bg-paper"
        />
      </div>
    </Card>
  );
}

function FieldRow({
  field,
  value,
  mark,
  onDraftAI,
  pending,
  fromLines,
}: {
  field: TemplateManifest["fields"][number];
  value: unknown;
  mark: string | undefined;
  onDraftAI?: () => void;
  pending: boolean;
  /** Read-only: comes from the estimate's lines (a Formal Estimate copy). */
  fromLines?: boolean;
}) {
  const isMoney = field.kind === "money_cents";
  const display = isMoney && typeof value === "number" ? fmtUsd(value) : value == null ? "" : String(value);
  const inputCls =
    "w-full rounded-md border border-rule bg-card px-2.5 py-1.5 text-body text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none";
  const span = field.kind === "narrative" ? "@xl/page:col-span-2" : "";

  return (
    <label className={`block ${span}`}>
      <span className="mb-1 flex items-center gap-1.5 text-meta font-semibold text-ink-2">
        {field.label}
        {field.required && <span className="text-flag">*</span>}
        {fromLines ? (
          <span className="text-meta font-normal text-ink-3">from the lines</span>
        ) : (
          field.source === "auto" && <span className="text-meta font-normal text-ink-3">auto</span>
        )}
        {field.source === "ai" && onDraftAI && (
          <button type="button" onClick={onDraftAI} disabled={pending} className="inline-flex items-center gap-0.5 text-meta font-normal text-accent-2 hover:underline disabled:opacity-60">
            <Sparkles className="size-2.5" strokeWidth={2} /> Draft with AI
          </button>
        )}
        {mark && <span className="ml-auto text-meta font-normal tracking-wide text-ink-3">{mark}</span>}
      </span>

      {fromLines ? (
        <div className={`${inputCls} bg-paper-2 text-ink-2`}>{display || "—"}</div>
      ) : field.kind === "narrative" ? (
        <textarea name={field.key} defaultValue={display} rows={4} className={`${inputCls} resize-y`} />
      ) : field.kind === "enum" ? (
        <select name={field.key} defaultValue={display} className={inputCls}>
          <option value="">—</option>
          {(field.enumValues ?? []).map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      ) : isMoney ? (
        <input name={field.key} defaultValue={typeof value === "number" ? centsToInput(value) : ""} inputMode="decimal" placeholder="0.00" className={inputCls} />
      ) : (
        <input name={field.key} defaultValue={display} className={inputCls} />
      )}
    </label>
  );
}
