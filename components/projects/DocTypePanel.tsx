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

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Sparkles, Check, Clock, Ban, FileDown } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { dollarsToCents, centsToInput, fmtUsd } from "@/lib/cost-book-units";
import type { TemplateManifest } from "@/lib/doc-templates/registry";
import {
  createDocDraftAction,
  updateDocDraftFieldsAction,
  renderDocDraftAction,
  submitDocDraftForSignatureAction,
  setDocDraftVisibilityAction,
  voidDocDraftAction,
  deleteDocDraftAction,
  unlockDocDraftForEditAction,
  draftDocNarrative,
} from "@/lib/actions/doc-drafts";

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
  createdAtLabel: string;
  signerName: string;
  signedName: string | null;
  signedAtLabel: string | null;
  sentAtLabel: string | null;
  declineReason: string | null;
  manifest: TemplateManifest;
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
  submitted: "Sent for signature",
  signed: "Signed",
  void: "Voided",
};
// Which template keys can be submitted for signature (invoice_doc cannot).
const SIGNABLE = new Set(["contract", "precon", "lien_release", "completion_cert", "change_order", "estimate_doc"]);

export function DocTypePanel({
  slug,
  leadSlug,
  templateKey,
  manifest,
  drafts,
}: {
  slug?: string;
  leadSlug?: string;
  templateKey: string;
  manifest: TemplateManifest;
  drafts: DocDraftItem[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createDocDraftAction(templateKey, leadSlug ? { leadSlug } : { slug });
      if (res.ok && "id" in res) {
        setEditingId(res.id as number);
        router.refresh();
      } else if (!res.ok) {
        setError(res.error);
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
      setError(null);
      startTransition(async () => {
        const res = await unlockDocDraftForEditAction(d.id);
        if (res.ok) {
          setEditingId(d.id);
          router.refresh();
        } else {
          setError(res.error);
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
    setError(null);
    startTransition(async () => {
      const res = sent ? await voidDocDraftAction(d.id) : await deleteDocDraftAction(d.id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  /** Publish/unpublish a document on the client dashboard. Publishing emails
   *  the client — surface the delivery note so "sent" is never a guess. */
  function publish(d: DocDraftItem, to: boolean) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await setDocDraftVisibilityAction(d.id, to);
      if (!res.ok) setError(res.error);
      else {
        setNotice(to ? (res.delivery?.note ?? "Published.") : "Removed from the client dashboard.");
        router.refresh();
      }
    });
  }

  const editing = editingId != null ? drafts.find((d) => d.id === editingId) ?? null : null;

  return (
    <div className="max-w-[820px] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-serif text-[17px] font-semibold text-ink">{manifest.title}</h3>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            {drafts.length} document{drafts.length === 1 ? "" : "s"}
          </div>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
          >
            <Plus className="size-3" strokeWidth={2} /> New {manifest.title}
          </button>
        )}
      </div>

      {error && <div className="text-[12px] text-flag">{error}</div>}
      {notice && <div className="text-[12px] text-money">{notice}</div>}

      {editing ? (
        <DraftEditor key={editing.id} draft={editing} onClose={() => setEditingId(null)} />
      ) : drafts.length === 0 ? (
        <Card kind="dashed" className="p-8 text-center">
          <FileText className="mx-auto size-5 text-ink-3" strokeWidth={1.5} />
          <div className="mt-2 font-serif text-[15px] font-semibold text-ink-2">No {manifest.title.toLowerCase()} yet</div>
          <div className="mt-1 text-[12px] text-ink-3">
            Start one from the template, fill it in, and send it for signature when it&rsquo;s ready.
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {drafts.map((d) => (
            <DraftRow
              key={d.id}
              draft={d}
              pending={pending}
              onEdit={() => edit(d)}
              onDelete={() => remove(d)}
              onPublish={(to) => publish(d, to)}
            />
          ))}
        </div>
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
  onEdit,
  onDelete,
  onPublish,
}: {
  draft: DocDraftItem;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: (to: boolean) => void;
}) {
  const fileHref = (id: string | null) => (id ? `/api/files/${id}` : null);
  const sentOrSigned = draft.status === "submitted" || draft.status === "signed";
  // Publishable once a PDF exists (rendered/submitted/signed) and not voided.
  const canPublish = !!draft.pdf_file_id && draft.status !== "void";

  return (
    <Card
      className="p-3.5"
      data-focus={draft.signature_request_id ? `signature-${draft.signature_request_id}` : `draft-${draft.id}`}
    >
      <div className="flex items-start gap-3">
        <StatusIcon status={draft.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-serif text-[15px] font-semibold text-ink">{draft.title}</span>
            <Chip kind={STATUS_KIND[draft.status] ?? "ghost"}>{STATUS_LABEL[draft.status] ?? draft.status}</Chip>
            {draft.client_visible && (
              <Chip kind="money" dot>
                On dashboard
              </Chip>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
            {draft.status === "signed" && draft.signedName ? (
              <span>
                Signed by {draft.signedName}
                {draft.signedAtLabel ? ` · ${draft.signedAtLabel}` : ""}
              </span>
            ) : draft.status === "submitted" ? (
              <span>
                Sent to {draft.signerName || "client"}
                {draft.sentAtLabel ? ` · ${draft.sentAtLabel}` : ""}
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
        </div>
        <div className="flex flex-none items-center gap-1.5">
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
                  ? "rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper-2 disabled:opacity-60"
                  : "rounded-md border border-accent bg-accent px-2 py-1 text-[11px] font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
              }
            >
              {draft.client_visible ? "Unpublish" : "Publish"}
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            disabled={pending}
            className="rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper-2 disabled:opacity-60"
          >
            Edit
          </button>
          {draft.status !== "void" && (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-60"
            >
              {sentOrSigned ? "Void" : "Delete"}
            </button>
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
      const res1 = await updateDocDraftFieldsAction(draft.id, edits);
      if (!res1.ok) return setError(res1.error);
      const res2 = await renderDocDraftAction(draft.id);
      if (!res2.ok) setError(res2.error);
      setPreviewVer((v) => v + 1);
      router.refresh();
    });
  }

  function draftAi(fieldKey: string) {
    setError(null);
    startDraftAi(async () => {
      const res = await draftDocNarrative(draft.id, fieldKey);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function send() {
    setError(null);
    setDelivery(null);
    startSend(async () => {
      const res = await submitDocDraftForSignatureAction(draft.id, override);
      if (!res.ok) setError(res.error);
      else {
        setDelivery(res.delivery);
        router.refresh();
      }
    });
  }

  const canSend = draft.status === "rendered" && SIGNABLE.has(draft.template_key);
  const showGateOverride = draft.template_key === "contract";
  const busy = saving || sending || drafting;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="font-serif text-[15px] font-semibold text-ink">{draft.title}</span>
          <Chip kind={STATUS_KIND[draft.status] ?? "ghost"}>{STATUS_LABEL[draft.status] ?? draft.status}</Chip>
        </div>
        <button type="button" onClick={onClose} className="text-[11px] font-semibold text-ink-3 hover:text-ink">
          Close
        </button>
      </div>

      {draft.missing.length > 0 && (
        <div className="mt-1 text-[11px] text-flag">Still need: {draft.missing.join(", ")}</div>
      )}

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              />
            ))}
        </div>

        {showGateOverride && (
          <label className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Override the pre-con approval gate (design / selections / estimate sign-offs) and send anyway
          </label>
        )}

        {error && <div className="text-[12px] text-flag">{error}</div>}

        {delivery && (
          <div className={`text-[12px] ${delivery.sent ? "text-money" : "text-flag"}`}>
            {delivery.sent ? "Sent · " : "Recorded, but not delivered · "}
            {delivery.note}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save & preview"}
          </button>
          {canSend && (
            <button
              type="button"
              onClick={send}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
            >
              {sending ? "Sending…" : draft.template_key === "contract" ? "Send Contract" : "Send for signature"}
            </button>
          )}
        </div>
      </form>

      <div className="mt-4">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
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
}: {
  field: TemplateManifest["fields"][number];
  value: unknown;
  mark: string | undefined;
  onDraftAI?: () => void;
  pending: boolean;
}) {
  const isMoney = field.kind === "money_cents";
  const display = isMoney && typeof value === "number" ? fmtUsd(value) : value == null ? "" : String(value);
  const inputCls =
    "w-full rounded-md border border-rule bg-card px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none";
  const span = field.kind === "narrative" ? "sm:col-span-2" : "";

  return (
    <label className={`block ${span}`}>
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
        {field.label}
        {field.required && <span className="text-flag">*</span>}
        {field.source === "auto" && <span className="text-[10px] font-normal text-ink-3">auto</span>}
        {field.source === "ai" && onDraftAI && (
          <button type="button" onClick={onDraftAI} disabled={pending} className="inline-flex items-center gap-0.5 text-[10px] font-normal text-accent-2 hover:underline disabled:opacity-60">
            <Sparkles className="size-2.5" strokeWidth={2} /> Draft with AI
          </button>
        )}
        {mark && <span className="ml-auto text-[9px] font-normal uppercase tracking-wide text-ink-3">{mark}</span>}
      </span>

      {field.kind === "narrative" ? (
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
