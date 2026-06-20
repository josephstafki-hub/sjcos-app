"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Image as ImageIcon, Upload, Download } from "lucide-react";
import { Card } from "@/components/ui";
import { uploadProjectFile } from "@/lib/actions/files";

interface ProjectFile {
  id: string;
  name: string;
  type: "doc" | "img" | "folder";
  sizeLabel: string;
  modifiedLabel: string;
}

/** Real project Files tab — upload a blob (owner-gated, scoped to the project)
 *  and download existing uploads via /api/files/[id]. Curated showcase names
 *  are shown muted below as a reference index. */
export function ProjectFiles({
  slug,
  files,
  showcase,
}: {
  slug: string;
  files: ProjectFile[];
  showcase: string[];
}) {
  const [rows, setRows] = useState(files);
  const [error, setError] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    startUpload(async () => {
      const res = await uploadProjectFile(slug, fd);
      if (res.ok) {
        router.refresh();
        // Optimistic row so it appears before the refresh lands.
        setRows((prev) => [
          {
            id: `pending-${Date.now()}`,
            name: file.name,
            type: file.type.startsWith("image/") ? "img" : "doc",
            sizeLabel: "—",
            modifiedLabel: "just now",
          },
          ...prev,
        ]);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="max-w-[680px]">
      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-rule bg-paper-2 px-4 py-2.5">
          <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            {rows.length} uploaded
          </span>
          <input ref={inputRef} type="file" onChange={onPick} className="hidden" />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 rounded-md bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper transition-colors hover:bg-[#232a1e] disabled:opacity-50"
          >
            <Upload className="size-3" strokeWidth={1.75} />
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-ink-3">
            No files uploaded for this project yet.
          </div>
        ) : (
          rows.map((f, i) => {
            const Icon = f.type === "img" ? ImageIcon : FileText;
            const pending = f.id.startsWith("pending-");
            return (
              <div
                key={f.id}
                className={`flex items-center gap-2.5 px-4 py-2.5 ${i ? "border-t border-rule-soft" : ""}`}
              >
                <Icon className="size-3.5 flex-none text-ink-3" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{f.name}</span>
                <span className="flex-none font-mono text-[11px] text-ink-3">{f.sizeLabel}</span>
                {pending ? (
                  <span className="flex-none font-mono text-[11px] text-ink-4">saving…</span>
                ) : (
                  <a
                    href={`/api/files/${f.id}`}
                    target="_blank"
                    rel="noopener"
                    className="flex-none rounded p-0.5 text-ink-3 hover:text-ink"
                    aria-label="Download"
                  >
                    <Download className="size-3.5" strokeWidth={1.5} />
                  </a>
                )}
              </div>
            );
          })
        )}
      </Card>

      {error && <p className="mt-2 text-[12px] text-flag">{error}</p>}

      {showcase.length > 0 && (
        <Card className="mt-3.5 overflow-hidden p-0 opacity-80">
          <div className="border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            Index · Drive mirror pending
          </div>
          {showcase.map((f, i) => (
            <div
              key={f}
              className={`flex items-center gap-2 px-4 py-2.5 ${i ? "border-t border-rule-soft" : ""}`}
            >
              <FileText className="size-3.5 flex-none text-ink-4" strokeWidth={1.5} />
              <span className="flex-1 truncate text-[13px] text-ink-3">{f}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
