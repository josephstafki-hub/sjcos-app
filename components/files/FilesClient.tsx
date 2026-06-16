"use client";

import { useState, useTransition } from "react";
import {
  Search,
  Folder,
  ChevronDown,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  List,
  LayoutGrid,
  Filter,
  Plus,
  Eye,
  Share2,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { AiBubble, Card, Chip } from "@/components/ui";
import { summarizeFile } from "@/lib/actions/files";
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

export function FilesClient({ data }: { data: FilesData }) {
  const [selectedId, setSelectedId] = useState(data.selectedId);
  const [typeFilter, setTypeFilter] = useState("All");
  const [summary, setSummary] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [pending, startSummarize] = useTransition();
  const preview = data.previews[selectedId];

  // Selecting a different file clears the previous file's AI summary.
  function selectFile(id: string) {
    setSelectedId(id);
    setSummary(null);
  }

  function runSummarize() {
    startSummarize(async () => {
      setSummary(await summarizeFile(selectedId));
    });
  }

  return (
    <div className="flex h-full">
      {/* ─── Tree rail ────────────────────────────────────────────── */}
      <aside className="w-[230px] flex-none overflow-y-auto border-r border-rule bg-paper-2 p-3">
        <Card kind="soft" className="mb-3 flex items-center gap-1.5 px-2.5 py-1.5">
          <Search className="size-3 text-ink-4" strokeWidth={1.5} />
          <span className="text-[11px] text-ink-4">Search files…</span>
        </Card>

        <RailLabel>Spaces</RailLabel>
        <div className="flex flex-col gap-0.5">
          {data.spaces.map((s) => (
            <button
              key={s}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] text-ink-2 transition-colors hover:bg-paper-3"
            >
              <Folder className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
              <span className="truncate">{s}</span>
            </button>
          ))}
        </div>

        <div className="my-2 border-t border-rule" />

        <RailLabel>Projects</RailLabel>
        <div className="flex flex-col gap-0.5">
          {["2024", "2025"].map((y) => (
            <button
              key={y}
              className="flex items-center gap-1 rounded px-2 py-1 text-left text-[12px] text-ink-2 transition-colors hover:bg-paper-3"
            >
              <ChevronRight className="size-3 flex-none text-ink-4" strokeWidth={1.5} />
              <Folder className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
              <span>{y}</span>
            </button>
          ))}
          <div className="flex items-center gap-1 px-2 py-1 text-[12px] font-medium text-ink">
            <ChevronDown className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
            <Folder className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
            <span>2026</span>
          </div>
          {data.projects.map((p) => (
            <button
              key={p.name}
              className={[
                "flex items-center gap-1.5 rounded py-1 pl-7 pr-2 text-left text-[12px] transition-colors",
                p.active
                  ? "bg-accent-soft font-medium text-accent-2"
                  : "text-ink-2 hover:bg-paper-3",
              ].join(" ")}
            >
              <Folder className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* ─── File list ────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-rule px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <h1 className="font-serif text-[20px] font-semibold text-ink">{data.folderTitle}</h1>
              <div className="text-[11px] text-ink-3">{data.folderMeta}</div>
            </div>
            <Chip kind="solid">
              <List className="mr-0.5 inline size-2.5" strokeWidth={2} />
              List
            </Chip>
            <Chip kind="ghost">
              <LayoutGrid className="mr-0.5 inline size-2.5" strokeWidth={2} />
              Grid
            </Chip>
            <button className="inline-flex items-center gap-1 rounded-md border border-ink-4 px-2 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-paper-2">
              <Filter className="size-3" strokeWidth={1.5} />
              Filter
            </button>
            <button className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-[12px] font-semibold text-ink transition-colors hover:bg-paper-2">
              <Plus className="size-3" strokeWidth={1.5} />
              Upload
            </button>
          </div>
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

        <div className="flex-1 overflow-y-auto">
          {data.files.map((f) => (
            <FileListRow
              key={f.id}
              file={f}
              selected={f.id === selectedId}
              onSelect={() => selectFile(f.id)}
            />
          ))}
        </div>
      </section>

      {/* ─── Preview ──────────────────────────────────────────────── */}
      <aside className="w-[280px] flex-none overflow-y-auto border-l border-rule bg-paper-2 p-3.5">
        {preview && (
          <>
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
              <button
                onClick={() => setOpened(true)}
                className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-paper-3"
              >
                <Eye className="size-3" strokeWidth={1.5} />
                Open
              </button>
              <button className="inline-flex items-center gap-1 rounded-md border border-ink-4 px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:bg-paper-3">
                <Share2 className="size-3" strokeWidth={1.5} />
                Share
              </button>
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
