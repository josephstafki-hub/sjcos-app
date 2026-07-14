"use client";

// Project "Documents" area (doc-templates plan, Phase 6). Lists template drafts
// for the project, lets the owner create one from any project-scoped template,
// fill/override its fields (auto values shown read-only with an unlock toggle;
// AI narrative fields get a "Draft with AI" button), render PDF+DOCX, and submit
// for signature. Submitting is the only step that sends — it reuses the existing
// owner-gated e-sign flow. Lives under the Sign-offs tab.

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, ChevronDown, Sparkles, Check, Clock, Ban, FileDown } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { fmtUsd, dollarsToCents, centsToInput } from "@/lib/cost-book-units";
import type { TemplateManifest } from "@/lib/doc-templates/registry";
import {
  createDocDraftAction,
  updateDocDraftFieldsAction,
  renderDocDraftAction,
  submitDocDraftForSignatureAction,
  voidDocDraftAction,
  cloneDocDraftAction,
  draftDocNarrative,
} from "@/lib/actions/doc-drafts";

export interface DocDraftItem {
  id: number;
  template_key: string;
  title: string;
  status: string;
  field_values: Record<string, unknown>;
  fill_report: Record<string, string>;
  missing: string[];
  pdf_file_id: string | null;
  docx_file_id: string | null;
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

export function ProjectDocuments({
  slug,
  leadSlug,
  drafts,
  templates,
}: {
  slug?: string;
  leadSlug?: string;
  drafts: DocDraftItem[];
  templates: TemplateManifest[];
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create(templateKey: string) {
    setError(null);
    setMenuOpen(false);
    startTransition(async () => {
      const res = await createDocDraftAction(templateKey, leadSlug ? { leadSlug } : { slug });
      if (res.ok && "id" in res) {
        setOpenId(res.id as number);
        router.refresh();
      } else if (!res.ok) {
        setError(res.error);
      }
    });
  }

  return (
    <div className="max-w-[820px] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-serif text-[17px] font-semibold text-ink">Documents</h3>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            AI-fillable templates · {drafts.length} draft{drafts.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
          >
            <Plus className="size-3" strokeWidth={2} /> New document <ChevronDown className="size-3" strokeWidth={2} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-10 mt-1 w-60 overflow-hidden rounded-md border border-rule bg-card shadow-lg">
              {templates.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => create(t.key)}
                  className="block w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-paper-2"
                >
                  {t.title}
                  <span className="ml-1 text-[10px] text-ink-3">{t.docClass === "legal" ? "· legal" : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <div className="text-[12px] text-flag">{error}</div>}

      {drafts.length === 0 ? (
        <Card kind="dashed" className="p-8 text-center">
          <FileText className="mx-auto size-5 text-ink-3" strokeWidth={1.5} />
          <div className="mt-2 font-serif text-[15px] font-semibold text-ink-2">No document drafts yet</div>
          <div className="mt-1 text-[12px] text-ink-3">
            Start a contract, change order, estimate, or lien release from a template — fill it, render it, then send for signature.
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {drafts.map((d) => (
            <DraftCard
              key={d.id}
              draft={d}
              open={openId === d.id}
              onToggle={() => setOpenId((v) => (v === d.id ? null : d.id))}
              pending={pending}
              startTransition={startTransition}
              onError={setError}
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

function DraftCard({
  draft,
  open,
  onToggle,
  pending,
  startTransition,
  onError,
}: {
  draft: DocDraftItem;
  open: boolean;
  onToggle: () => void;
  pending: boolean;
  startTransition: (cb: () => Promise<void> | void) => void;
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState<Record<string, boolean>>({});
  const locked = draft.status === "submitted" || draft.status === "signed" || draft.status === "void";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    onError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) onError(res.error);
      router.refresh();
    });
  };

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const edits: Record<string, unknown> = {};
    for (const f of draft.manifest.fields) {
      if (f.kind === "table") continue;
      // Auto fields are only editable when explicitly unlocked.
      if (f.source === "auto" && !unlocked[f.key]) continue;
      if (f.source === "ai") continue; // AI fields save via their own textarea below
      if (!fd.has(f.key)) continue;
      const raw = String(fd.get(f.key) ?? "");
      if (f.kind === "money_cents") {
        if (raw.trim() === "") continue;
        edits[f.key] = dollarsToCents(raw);
      } else {
        edits[f.key] = raw;
      }
    }
    // AI narrative fields are plain textareas — owner may also hand-edit them.
    for (const f of draft.manifest.fields) {
      if (f.source === "ai" && fd.has(f.key)) edits[f.key] = String(fd.get(f.key) ?? "");
    }
    run(() => updateDocDraftFieldsAction(draft.id, edits));
  }

  const fileHref = (id: string | null) => (id ? `/api/files/${id}` : null);

  return (
    <Card className="p-3.5">
      <div className="flex items-start gap-3">
        <StatusIcon status={draft.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={onToggle} className="truncate font-serif text-[15px] font-semibold text-ink hover:text-accent-2">
              {draft.title}
            </button>
            <Chip kind="ghost">{draft.manifest.title}</Chip>
            <Chip kind={STATUS_KIND[draft.status] ?? "ghost"}>{STATUS_LABEL[draft.status] ?? draft.status}</Chip>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
            {draft.missing.length > 0 ? (
              <span className="text-flag">Still need: {draft.missing.join(", ")}</span>
            ) : (
              <span>All required fields filled</span>
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
        <button type="button" onClick={onToggle} className="rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper-2">
          {open ? "Close" : locked ? "View" : "Edit"}
        </button>
      </div>

      {open && (
        <div className="mt-3 border-t border-rule-soft pt-3">
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {draft.manifest.fields
                .filter((f) => f.kind !== "table" && !f.key.startsWith("company_"))
                .map((f) => (
                  <FieldRow
                    key={f.key}
                    field={f}
                    value={draft.field_values[f.key]}
                    mark={draft.fill_report[f.key]}
                    unlocked={!!unlocked[f.key]}
                    locked={locked}
                    onUnlock={() => setUnlocked((u) => ({ ...u, [f.key]: !u[f.key] }))}
                    onDraftAI={
                      f.source === "ai"
                        ? () => run(() => draftDocNarrative(draft.id, f.key))
                        : undefined
                    }
                    pending={pending}
                  />
                ))}
            </div>

            {!locked && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="submit" disabled={pending} className="rounded-md border border-rule bg-card px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-paper-2 disabled:opacity-60">
                  Save fields
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => renderDocDraftAction(draft.id))}
                  className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
                >
                  Render PDF + DOCX
                </button>
                {draft.status === "rendered" && SIGNABLE.has(draft.template_key) && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => submitDocDraftForSignatureAction(draft.id))}
                    className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
                  >
                    Send for signature
                  </button>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button type="button" disabled={pending} onClick={() => run(() => cloneDocDraftAction(draft.id))} className="text-[11px] font-semibold text-ink-3 hover:text-ink">
                    Clone
                  </button>
                  <button type="button" disabled={pending} onClick={() => run(() => voidDocDraftAction(draft.id))} className="text-[11px] font-semibold text-ink-3 hover:text-flag">
                    Void
                  </button>
                </div>
              </div>
            )}
          </form>
          <div className="mt-2 text-[10px] text-ink-3">
            Auto values come from the project/estimate; unlock a field to override it. Legal text lives in code — this form only fills the blanks. Sending stays owner-gated.
          </div>
        </div>
      )}
    </Card>
  );
}

function FieldRow({
  field,
  value,
  mark,
  unlocked,
  locked,
  onUnlock,
  onDraftAI,
  pending,
}: {
  field: TemplateManifest["fields"][number];
  value: unknown;
  mark: string | undefined;
  unlocked: boolean;
  locked: boolean;
  onUnlock: () => void;
  onDraftAI?: () => void;
  pending: boolean;
}) {
  const isMoney = field.kind === "money_cents";
  const display = isMoney && typeof value === "number" ? fmtUsd(value) : value == null ? "" : String(value);
  const editable = !locked && (field.source !== "auto" || unlocked);
  const inputCls = "w-full rounded-md border border-rule bg-card px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none";
  const span = field.kind === "narrative" ? "sm:col-span-2" : "";

  return (
    <label className={`block ${span}`}>
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
        {field.label}
        {field.required && <span className="text-flag">*</span>}
        {field.source === "auto" && (
          <button type="button" onClick={onUnlock} className="text-[10px] font-normal text-accent-2 hover:underline">
            {unlocked ? "lock" : "override"}
          </button>
        )}
        {field.source === "ai" && onDraftAI && !locked && (
          <button type="button" onClick={onDraftAI} disabled={pending} className="inline-flex items-center gap-0.5 text-[10px] font-normal text-accent-2 hover:underline disabled:opacity-60">
            <Sparkles className="size-2.5" strokeWidth={2} /> Draft with AI
          </button>
        )}
        {mark && <span className="ml-auto text-[9px] font-normal uppercase tracking-wide text-ink-3">{mark}</span>}
      </span>

      {!editable ? (
        <div className="rounded-md border border-rule-soft bg-paper-2 px-2.5 py-1.5 text-[13px] text-ink-2">{display || "—"}</div>
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
