"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload, Download, Eye, EyeOff, User } from "lucide-react";
import { Card, Lightbox, type LightboxPhoto } from "@/components/ui";
import { uploadProjectFile, uploadLeadFile, setFileClientVisibility } from "@/lib/actions/files";
import type { ProjectFile } from "@/lib/projects";

/** Real Files tab, shared by projects (slug) and leads (leadSlug) — upload a
 *  blob (owner-gated, scoped accordingly) and download uploads via
 *  /api/files/[id]. Photos get a thumbnail strip up top and open in the
 *  Lightbox viewer (zoom / pan / prev-next / download); image rows show a
 *  thumbnail and open the same viewer. Each row carries a share toggle:
 *  publishing a file puts it on the client dashboard's Documents page and
 *  emails the client; the eye-off pulls it back. Curated showcase names are
 *  shown muted below as a reference index. */
export function ProjectFiles({
  slug,
  leadSlug,
  files,
  showcase,
  photosOnly = false,
  title,
}: {
  slug?: string;
  leadSlug?: string;
  files: ProjectFile[];
  showcase: string[];
  /** Render only the photo strip + image rows (used by the Client portal tab). */
  photosOnly?: boolean;
  /** Header label override, e.g. "Client uploads". */
  title?: string;
}) {
  const [rows, setRows] = useState(files);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const [toggling, startToggle] = useTransition();
  const [viewer, setViewer] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const visibleRows = photosOnly ? rows.filter((f) => f.type === "img") : rows;

  const photos: LightboxPhoto[] = useMemo(
    () =>
      rows
        .filter((f) => f.type === "img" && !f.id.startsWith("pending-"))
        .map((f) => ({
          id: f.id,
          src: `/api/files/${f.id}`,
          thumb: `/api/files/${f.id}?w=320`,
          name: f.name,
          caption: [f.subtitle, f.uploadedLabel].filter(Boolean).join(" · "),
        })),
    [rows],
  );
  const photoIndex = (id: string) => photos.findIndex((p) => p.id === id);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!picked.length) return;
    setError(null);
    startUpload(async () => {
      for (const file of picked) {
        const fd = new FormData();
        fd.append("file", file);
        const res = leadSlug ? await uploadLeadFile(leadSlug, fd) : await uploadProjectFile(slug!, fd);
        if (res.ok) {
          // Optimistic row so it appears before the refresh lands.
          setRows((prev) => [
            {
              id: `pending-${Date.now()}-${file.name}`,
              name: file.name,
              type: file.type.startsWith("image/") ? "img" : "doc",
              sizeLabel: "—",
              modifiedLabel: "just now",
              clientVisible: false,
              clientUpload: false,
              subtitle: "",
              uploadedLabel: "",
              fromLead: false,
            },
            ...prev,
          ]);
        } else {
          setError(res.error);
          break;
        }
      }
      router.refresh();
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
      {photos.length > 0 && (
        <Card className="mb-3.5 p-3">
          <div className="flex items-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
              Photos · {photos.length}
            </span>
            <div className="flex-1" />
            <span className="text-[11px] text-ink-4">Click to view · scroll or double-click to zoom</span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1 sm:grid-cols-6">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setViewer(i)}
                title={p.name}
                aria-label={`View ${p.name}`}
                className="aspect-square overflow-hidden rounded-[3px] border border-rule bg-paper-3 transition-colors hover:border-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt={p.name} loading="lazy" className="size-full object-cover" />
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-rule bg-paper-2 px-4 py-2.5">
          <span className="flex-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            {title ?? `${visibleRows.length} uploaded`}
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={photosOnly ? "image/*" : undefined}
            onChange={onPick}
            className="hidden"
          />
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

        {visibleRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-ink-3">
            {photosOnly ? "No photos yet." : "No files uploaded yet."}
          </div>
        ) : (
          visibleRows.map((f, i) => {
            const pending = f.id.startsWith("pending-");
            const isImg = f.type === "img";
            const idx = isImg && !pending ? photoIndex(f.id) : -1;
            return (
              <div
                key={f.id}
                data-focus={`file-${f.id}`}
                className={`flex items-center gap-2.5 px-4 py-2 ${i ? "border-t border-rule-soft" : ""}`}
              >
                {isImg && !pending ? (
                  <button
                    type="button"
                    onClick={() => setViewer(idx)}
                    aria-label={`View ${f.name}`}
                    className="size-9 flex-none overflow-hidden rounded border border-rule bg-paper-3 hover:border-accent"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/files/${f.id}?w=160`}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  </button>
                ) : (
                  <span className="flex size-9 flex-none items-center justify-center rounded border border-rule-soft bg-paper-2">
                    <FileText className="size-3.5 text-ink-3" strokeWidth={1.5} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {isImg && !pending ? (
                    <button
                      type="button"
                      onClick={() => setViewer(idx)}
                      className="block max-w-full truncate text-left text-[13px] text-ink-2 hover:text-ink hover:underline"
                    >
                      {f.name}
                    </button>
                  ) : (
                    <div className="truncate text-[13px] text-ink-2">{f.name}</div>
                  )}
                  <div className="flex items-center gap-1.5 truncate font-mono text-[10px] text-ink-4">
                    {f.clientUpload && (
                      <span className="inline-flex items-center gap-0.5 text-accent-2">
                        <User className="size-2.5" strokeWidth={1.75} />
                        client
                      </span>
                    )}
                    {f.uploadedLabel && <span>{f.uploadedLabel}</span>}
                    {f.fromLead && <span className="text-ink-4">· lead stage</span>}
                  </div>
                </div>
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
                      href={`/api/files/${f.id}?download=1`}
                      className="flex-none rounded p-0.5 text-ink-3 hover:text-ink"
                      aria-label="Download"
                      title="Download"
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

      {!photosOnly && showcase.length > 0 && (
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

      {viewer !== null && photos[viewer] && (
        <Lightbox photos={photos} index={viewer} onClose={() => setViewer(null)} onIndexChange={setViewer} />
      )}
    </div>
  );
}
