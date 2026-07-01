"use client";

import { useRef, useState, useTransition } from "react";
import { Upload, FileText, Image as ImageIcon } from "lucide-react";
import { uploadClientFile } from "@/lib/actions/portal";

interface UploadRow {
  id: string;
  name: string;
  isImage: boolean;
  when: string;
}

/** Client-portal file upload (Phase-3 5-depth). A client shares a photo or
 *  document with Joe; it lands in the project's Files tab. Revalidates on
 *  success so the list below updates. */
export function ClientUploads({ uploads }: { uploads: UploadRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="mt-2">
      {uploads.length > 0 && (
        <div className="mb-2 flex flex-col gap-1.5">
          {uploads.map((u) => (
            <a
              key={u.id}
              href={`/api/portal/project-file/${u.id}`}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-1.5 text-ink-2 hover:text-accent-2"
            >
              {u.isImage ? (
                <ImageIcon className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
              ) : (
                <FileText className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
              )}
              <span className="min-w-0 flex-1 truncate text-[12px]">{u.name}</span>
              <span className="font-mono text-[10px] text-ink-3">{u.when}</span>
            </a>
          ))}
        </div>
      )}

      <form
        ref={formRef}
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(async () => {
            setError("");
            const r = await uploadClientFile(fd);
            if (r?.ok) {
              formRef.current?.reset();
              setFileName("");
            } else {
              setError(r?.error ?? "Could not upload.");
            }
          });
        }}
      >
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-paper-3">
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
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
        >
          <Upload className="size-3" strokeWidth={1.75} />
          {pending ? "Uploading…" : "Share"}
        </button>
        {error && <div className="w-full text-[11px] text-flag">{error}</div>}
      </form>
    </div>
  );
}
