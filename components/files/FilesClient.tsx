"use client";

import { useRef, useState, useTransition } from "react";
import {
  Search,
  Folder,
  ChevronLeft,
  FileText,
  Image as ImageIcon,
  List,
  LayoutGrid,
  Plus,
  Eye,
  Download,
  Share2,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { AiBubble, AckButton, Card, Chip } from "@/components/ui";
import { summarizeFile, uploadFile } from "@/lib/actions/files";
import type { FilesData, FileRow, FileType } from "@/lib/files";

const TYPE_ICON: Record<FileType, LucideIcon> = {
  doc: FileText,
  img: ImageIcon,
  folder: Folder,
};

/** Small-caps mono section label for the light rails. */
function RailLabel({ children }: { children: string }) {
  return (
    <div className="px-1 pb-1 pt-2 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
      {children}
    </div>
  );
}

// Tree-rail folder selection. `projectKey` filters the list to that project's
// files; `label` is what the header shows. Spaces/year folders carry no
// projectKey, so they match nothing yet (honest empty state until Drive mirror).
type FolderSel = { label: string; projectKey?: string };

// Maps a type-filter chip to a predicate over a file row.
const TYPE_MATCH: Record<string, (f: FileRow) => boolean> = {
  All: () => true,
  Contracts: (f) => /CONTRACT|SCOPE|ESTIMATE|SELECTION|^CO ·/i.test(f.tag),
  Drawings: (f) => /DRAWING|RENDER|FLOOR/i.test(f.tag),
  Photos: (f) => /photo/i.test(f.tag),
  Invoices: (f) => /INVOICE/i.test(f.tag),
  "AI tags": (f) => f.ai,
};

export function FilesClient({ data }: { data: FilesData }) {
  // Default to "All files" so every real file is visible; picking a project in
  // the rail filters to that project's files.
  const [folder, setFolder] = useState<FolderSel>({ label: "All files" });
  const [typeFilter, setTypeFilter] = useState("All");
  const [view, setView] = useState<"list" | "grid">("list");
  const [summary, setSummary] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [pending, startSummarize] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setUploadError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("project_key", folder.projectKey ?? "");
    startUpload(async () => {
      const res = await uploadFile(fd);
      if (!res.ok) setUploadError(res.error);
    });
  }

  const matchType = TYPE_MATCH[typeFilter] ?? (() => true);
  const visibleFiles = data.files.filter(
    (f) => (!folder.projectKey || f.projectKey === folder.projectKey) && matchType(f),
  );

  // Keep the selected file valid as filters narrow the list.
  const selectableId = visibleFiles.some((f) => f.id === data.selectedId)
    ? data.selectedId
    : visibleFiles[0]?.id ?? "";
  const [selectedId, setSelectedId] = useState(data.selectedId);
  // Mobile master/detail: below lg, show the file list OR the preview, not both.
  const [mobilePreview, setMobilePreview] = useState(false);
  const effectiveId = visibleFiles.some((f) => f.id === selectedId)
    ? selectedId
    : selectableId;
  const preview = data.previews[effectiveId];

  function pickFolder(sel: FolderSel) {
    setFolder(sel);
    setSummary(null);
  }

  // Selecting a different file clears the previous file's AI summary.
  function selectFile(id: string) {
    setSelectedId(id);
    setSummary(null);
    setMobilePreview(true);
  }

  function runSummarize() {
    startSummarize(async () => {
      setSummary(await summarizeFile(effectiveId));
    });
  }

  return (
    <div className="flex h-full">
      {/* ─── Tree rail ────────────────────────────────────────────── */}
      <aside className="hidden w-[230px] flex-none overflow-y-auto border-r border-rule bg-paper-2 p-3 lg:block">
        <Card kind="soft" className="mb-3 flex items-center gap-1.5 px-2.5 py-1.5">
          <Search className="size-3 text-ink-4" strokeWidth={1.5} />
          <span className="text-[11px] text-ink-4">Search files…</span>
        </Card>

        <button
          onClick={() => pickFolder({ label: "All files" })}
          className={[
            "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] transition-colors",
            !folder.projectKey
              ? "bg-accent-soft font-medium text-accent-2"
              : "text-ink-2 hover:bg-paper-3",
          ].join(" ")}
        >
          <Folder className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
          <span className="truncate">All files</span>
        </button>

        <div className="my-2 border-t border-rule" />

        <RailLabel>Projects</RailLabel>
        <div className="flex flex-col gap-0.5">
          {data.projects.length > 0 ? (
            data.projects.map((p) => (
              <button
                key={p.slug}
                onClick={() => pickFolder({ label: p.name, projectKey: p.slug })}
                className={[
                  "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] transition-colors",
                  folder.projectKey === p.slug
                    ? "bg-accent-soft font-medium text-accent-2"
                    : "text-ink-2 hover:bg-paper-3",
                ].join(" ")}
              >
                <Folder className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
                <span className="truncate">{p.name}</span>
              </button>
            ))
          ) : (
            <div className="px-2 py-1 text-[11px] text-ink-4">No project files yet.</div>
          )}
        </div>
      </aside>

      {/* ─── File list ────────────────────────────────────────────── */}
      <section
        className={[
          "min-w-0 flex-col lg:flex lg:flex-1",
          mobilePreview ? "hidden" : "flex flex-1",
        ].join(" ")}
      >
        <div className="border-b border-rule px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <h1 className="font-serif text-[20px] font-semibold text-ink">
                {folder.label}
              </h1>
              <div className="text-[11px] text-ink-3">
                {visibleFiles.length} item{visibleFiles.length === 1 ? "" : "s"}
                {folder.projectKey ? " · stored on server" : ""}
              </div>
            </div>
            <button onClick={() => setView("list")} aria-pressed={view === "list"}>
              <Chip kind={view === "list" ? "solid" : "ghost"}>
                <List className="mr-0.5 inline size-2.5" strokeWidth={2} />
                List
              </Chip>
            </button>
            <button onClick={() => setView("grid")} aria-pressed={view === "grid"}>
              <Chip kind={view === "grid" ? "solid" : "ghost"}>
                <LayoutGrid className="mr-0.5 inline size-2.5" strokeWidth={2} />
                Grid
              </Chip>
            </button>
            <input ref={fileInputRef} type="file" onChange={onPickFile} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-paper-3 disabled:opacity-60"
            >
              <Plus className="size-3" strokeWidth={1.75} />
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
          {uploadError && (
            <div className="mt-1 text-[11px] text-flag">{uploadError}</div>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {data.typeFilters.map((t) => {
              const isAi = t === "AI tags";
              const active = typeFilter === t;
              return (
                <button key={t} onClick={() => setTypeFilter(t)}>
                  <Chip kind={active ? "solid" : isAi ? "ai" : "ghost"}>{t}</Chip>
                </button>
              );
            })}
          </div>
        </div>

        {/* Column headers */}
        <div className="flex items-center gap-3 border-b border-rule-soft px-5 py-2 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
          <span className="w-6">Type</span>
          <span className="flex-1">Name</span>
          <span className="hidden w-[120px] md:block">Stage / tag</span>
          <span className="w-[64px]">Modified</span>
          <span className="hidden w-[56px] text-right sm:block">Size</span>
        </div>

        {visibleFiles.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 p-10 text-center">
            <Folder className="size-6 text-ink-4" strokeWidth={1.25} />
            <div className="text-[13px] font-medium text-ink-2">No files here yet</div>
            <div className="max-w-[280px] text-[11px] text-ink-3">
              {folder.projectKey
                ? `Nothing in ${folder.label} matches “${typeFilter}”.`
                : `No files match “${typeFilter}”. Upload one, or generate docs from a project.`}
            </div>
          </div>
        ) : view === "list" ? (
          <div className="flex-1 overflow-y-auto">
            {visibleFiles.map((f) => (
              <FileListRow
                key={f.id}
                file={f}
                selected={f.id === effectiveId}
                onSelect={() => selectFile(f.id)}
              />
            ))}
          </div>
        ) : (
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto p-4 lg:grid-cols-3">
            {visibleFiles.map((f) => (
              <FileGridCard
                key={f.id}
                file={f}
                selected={f.id === effectiveId}
                onSelect={() => selectFile(f.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ─── Preview ──────────────────────────────────────────────── */}
      <aside
        className={[
          "w-full flex-none overflow-y-auto border-l border-rule bg-paper-2 p-3.5 lg:w-[280px]",
          mobilePreview ? "block" : "hidden lg:block",
        ].join(" ")}
      >
        {preview && (
          <>
            <button
              onClick={() => setMobilePreview(false)}
              className="-ml-1 mb-2 inline-flex items-center gap-1 rounded p-0.5 text-[12px] text-ink-3 hover:bg-paper-3 lg:hidden"
            >
              <ChevronLeft className="size-4" strokeWidth={1.5} />
              Files
            </button>
            <div className="mb-3 flex aspect-[8.5/11] items-center justify-center rounded border border-ink-3 bg-paper-3">
              <span className="px-3 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
                {preview.thumbLabel}
              </span>
            </div>
            <h2 className="font-serif text-[14px] font-semibold text-ink">{preview.name}</h2>
            <div className="mt-0.5 text-[11px] text-ink-3">{preview.subtitle}</div>

            <div className="my-3 border-t border-rule" />

            <div className="flex flex-col gap-1.5">
              {preview.meta.map((m) => (
                <div key={m.label} className="flex items-center gap-2">
                  <span className="flex-1 text-[12px] text-ink-2">{m.label}</span>
                  {m.chip ? (
                    <Chip kind={m.chip}>{m.value}</Chip>
                  ) : (
                    <span className="font-mono text-[10px] text-ink-3">{m.value}</span>
                  )}
                </div>
              ))}
            </div>

            <div className="my-3 border-t border-rule" />

            <RailLabel>AI tags</RailLabel>
            <div className="mt-1 flex flex-wrap gap-1">
              {preview.aiTags.map((t) => (
                <Chip key={t} kind="ai">
                  {t}
                </Chip>
              ))}
            </div>

            <div className="my-3 border-t border-rule" />

            <div className="flex flex-wrap gap-1.5">
              {preview.hasBlob ? (
                <a
                  href={`/api/files/${effectiveId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-paper-3"
                >
                  <Eye className="size-3" strokeWidth={1.5} />
                  Open
                </a>
              ) : (
                <button
                  onClick={() => setOpened(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-paper-3"
                >
                  <Eye className="size-3" strokeWidth={1.5} />
                  Open
                </button>
              )}
              {preview.hasBlob ? (
                <a
                  href={`/api/files/${effectiveId}`}
                  download
                  className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-paper-3"
                >
                  <Download className="size-3" strokeWidth={1.5} />
                  Download
                </a>
              ) : (
                <AckButton
                  variant="subtle"
                  icon={<Share2 className="size-3" strokeWidth={1.75} />}
                  label="Share"
                  ackLabel="Link copied"
                  className="px-2 py-1 text-[11px]"
                />
              )}
              <button
                onClick={runSummarize}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-md border border-ai bg-ai px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-ai-2 disabled:opacity-60"
              >
                <Sparkles className="size-3" strokeWidth={1.5} />
                {pending ? "Summarizing…" : "Summarize"}
              </button>
            </div>

            {summary && (
              <AiBubble className="mt-3">{summary}</AiBubble>
            )}
          </>
        )}
      </aside>

      {/* Open overlay — enlarged document preview (no real blob to stream yet). */}
      {opened && preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6"
          onClick={() => setOpened(false)}
        >
          <button
            onClick={() => setOpened(false)}
            aria-label="Close"
            className="absolute right-5 top-5 text-paper/80 hover:text-paper"
          >
            <X className="size-6" strokeWidth={1.5} />
          </button>
          <figure
            className="flex w-full max-w-[620px] flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex aspect-[8.5/11] w-full max-w-[460px] items-center justify-center rounded border border-paper/15 bg-paper-3/95 px-6 text-center font-mono text-[12px] uppercase tracking-[0.12em] text-ink-3">
              {preview.thumbLabel}
            </div>
            <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper/70">
              {preview.name} · {preview.subtitle}
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}

function FileGridCard({
  file: f,
  selected,
  onSelect,
}: {
  file: FileRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = TYPE_ICON[f.type];
  return (
    <button
      onClick={onSelect}
      className={[
        "flex flex-col gap-2 rounded-md border p-3 text-left transition-colors",
        selected ? "border-accent bg-accent-soft" : "border-rule bg-card hover:bg-paper-2",
      ].join(" ")}
    >
      <div className="flex items-start justify-between">
        <Icon className={`size-5 ${f.ai ? "text-ai-2" : "text-ink-2"}`} strokeWidth={1.5} />
        <Chip kind={f.ai ? "ai" : "ghost"}>{f.tag}</Chip>
      </div>
      <span className="truncate text-[12.5px] font-medium text-ink">{f.name}</span>
      <span className="font-mono text-[10px] text-ink-3">
        {f.modified} · {f.size}
      </span>
    </button>
  );
}

function FileListRow({
  file: f,
  selected,
  onSelect,
}: {
  file: FileRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = TYPE_ICON[f.type];
  return (
    <button
      onClick={onSelect}
      className={[
        "flex w-full items-center gap-3 border-b border-rule-soft px-5 py-2 text-left transition-colors",
        selected ? "bg-accent-soft" : "hover:bg-paper-2",
      ].join(" ")}
    >
      <span className="w-6">
        <Icon
          className={`size-3.5 ${f.ai ? "text-ai-2" : "text-ink-2"}`}
          strokeWidth={1.5}
        />
      </span>
      <span className="flex-1 truncate text-[13px] text-ink">{f.name}</span>
      <span className="hidden w-[120px] md:block">
        <Chip kind={f.ai ? "ai" : "ghost"}>{f.tag}</Chip>
      </span>
      <span className="w-[64px] font-mono text-[11px] text-ink-2">{f.modified}</span>
      <span className="hidden w-[56px] text-right font-mono text-[11px] text-ink-3 sm:block">
        {f.size}
      </span>
    </button>
  );
}
