"use client";

import { useRef, useState, useTransition } from "react";
import { Upload, FileText, Check } from "lucide-react";
import { Eyebrow, Chip } from "@/components/ui";
import { uploadSubDocument } from "@/lib/actions/sub-docs";
import { SUB_DOC_TYPES } from "@/lib/sub-doc-types";

interface DocRow {
  id: number;
  docLabel: string;
  expiresLabel: string | null;
  when: string;
}

/** Sub-portal document upload — W-9 / COI / signed agreement. A COI expiry date
 *  feeds the reminder engine. Mirrors SubLogComposer; revalidates on success. */
export function SubDocs({ slug, docs }: { slug: string; docs: DocRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [docType, setDocType] = useState<string>("coi");
  const formRef = useRef<HTMLFormElement>(null);

  const inputCls =
    "rounded-md border border-rule bg-card px-2 py-1 text-[12px] text-ink-2 outline-none focus:border-accent";

  return (
    <div>
      <Eyebrow muted>Paperwork on file</Eyebrow>

      {docs.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-1.5">
              <Check className="size-3 flex-none text-money" strokeWidth={2} />
              <span className="flex-1 text-[12px] text-ink-2">{d.docLabel}</span>
              {d.expiresLabel && <Chip kind="ghost">exp {d.expiresLabel}</Chip>}
              <span className="font-mono text-[10px] text-ink-3">{d.when}</span>
            </div>
          ))}
        </div>
      )}

      <form
        ref={formRef}
        className="mt-3 flex flex-col gap-2 border-t border-rule pt-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(async () => {
            setError("");
            const r = await uploadSubDocument(slug, fd);
            if (r.ok) {
              formRef.current?.reset();
              setFileName("");
              setDocType("coi");
            } else {
              setError(r.error ?? "Could not upload.");
            }
          });
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select name="docType" value={docType} onChange={(e) => setDocType(e.target.value)} className={inputCls}>
            {SUB_DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {docType === "coi" && (
            <label className="flex items-center gap-1 text-[11px] text-ink-3">
              Expires
              <input name="expires" type="date" className={inputCls} />
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-paper-2">
            <FileText className="size-3" strokeWidth={1.75} />
            {fileName || "Choose file"}
            <input
              name="file"
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
            />
          </label>
          <div className="flex-1" />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-3 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
          >
            <Upload className="size-3" strokeWidth={1.75} />
            {pending ? "Uploading…" : "Upload"}
          </button>
        </div>
        {error && <div className="text-[11px] text-flag">{error}</div>}
      </form>
    </div>
  );
}
