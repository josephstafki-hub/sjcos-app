"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Image as ImageIcon, Upload, Download, Eye, EyeOff } from "lucide-react";
import { Card } from "@/components/ui";
import { uploadProjectFile, uploadLeadFile, setFileClientVisibility } from "@/lib/actions/files";

interface ProjectFile {
  id: string;
  name: string;
  type: "doc" | "img" | "folder";
  sizeLabel: string;
  modifiedLabel: string;
  clientVisible: boolean;
}

/** Real Files tab, shared by projects (slug) and leads (leadSlug) — upload a
 *  blob (owner-gated, scoped accordingly) and download uploads via
 *  /api/files/[id]. Each row carries a share toggle: publishing a file puts it
 *  on the client dashboard's Documents page and emails the client; the eye-off
 *  pulls it back. Curated showcase names are shown muted below as a reference
 *  index. */
export function ProjectFiles({
  slug,
  leadSlug,
  files,
  showcase,
}: {
  slug?: string;
  leadSlug?: string;
  files: ProjectFile[];
  showcase: string[];
}) {
  const [rows, setRows] = useState(files);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const [toggling, startToggle] = useTransition();
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
      const res = leadSlug ? await uploadLeadFile(leadSlug, fd) : await uploadProjectFile(slug!, fd);
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
            clientVisible: false,
          },
          ...prev,
        ]);
      } else {
        setError(res.error);
      }
    });
  }

  /** Flip a file's dashboard visibility. Publishing emails the client — show
   *  the delivery note so the owner knows whether anything actually went out. */
  function toggleShare(f: ProjectFile) {
    setError(null);
    setNotice(null);
    const to = !f.clientVisible;
    startToggle(async () => {
      const res = await setFileClientVisibility(f.id, to);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === f.id ? { ...r, clientVisible: to } : r)));
      setNotice(to ? (res.delivery?.note ?? "Published.") : `"${f.name}" removed from the client dashboard.`);
      router.refresh();
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
            No files uploaded yet.
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
                {f.clientVisible && !pending && (
                  <span className="flex-none rounded bg-money/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-money">
                    On dashboard
                  </span>
                )}
                <span className="flex-none font-mono text-[11px] text-ink-3">{f.sizeLabel}</span>
                {pending ? (
                  <span className="flex-none font-mono text-[11px] text-ink-4">saving…</span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleShare(f)}
                      disabled={toggling}
                      title={
                        f.clientVisible
                          ? "Remove from the client dashboard"
                          : "Publish to the client dashboard (emails the client)"
                      }
                      className={`flex-none rounded p-0.5 disabled:opacity-50 ${
                        f.clientVisible ? "text-money hover:text-ink" : "text-ink-3 hover:text-ink"
                      }`}
                      aria-label={f.clientVisible ? "Unpublish from dashboard" : "Publish to dashboard"}
                    >
                      {f.clientVisible ? (
                        <Eye className="size-3.5" strokeWidth={1.5} />
                      ) : (
                        <EyeOff className="size-3.5" strokeWidth={1.5} />
                      )}
                    </button>
                    <a
                      href={`/api/files/${f.id}`}
                      target="_blank"
                      rel="noopener"
                      className="flex-none rounded p-0.5 text-ink-3 hover:text-ink"
                      aria-label="Download"
                    >
                      <Download className="size-3.5" strokeWidth={1.5} />
                    </a>
                  </>
                )}
              </div>
            );
          })
        )}
      </Card>

      {error && <p className="mt-2 text-[12px] text-flag">{error}</p>}
      {notice && <p className="mt-2 text-[12px] text-money">{notice}</p>}

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
