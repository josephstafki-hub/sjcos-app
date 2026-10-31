"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  Search,
  Folder,
  FileText,
  Image as ImageIcon,
  Plus,
  X,
  MoreHorizontal,
  ExternalLink,
  Download,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Button,
  Chip,
  PageHeader,
  Segmented,
  EmptyState,
  TableWrapper,
  Table,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TablePrimaryCell,
  TableCell,
} from "@/components/ui";
import {
  uploadFile,
  trashBrowserFile,
  restoreDeletedFile,
} from "@/lib/actions/files";
import { runAction } from "@/lib/run-action";
import type { FilesData, FileRow } from "@/lib/files";
const matches: Record<string, (f: FileRow) => boolean> = {
  All: () => true,
  Contracts: (f) => /CONTRACT|SCOPE|ESTIMATE|SELECTION/i.test(f.tag),
  Drawings: (f) => /DRAWING|RENDER|FLOOR/i.test(f.tag),
  Photos: (f) => f.type === "img",
  Invoices: (f) => /INVOICE/i.test(f.tag),
  "AI tags": (f) => f.ai,
};
export function FilesClient({ data }: { data: FilesData }) {
  const [folder, setFolder] = useState(""),
    [filter, setFilter] = useState("All"),
    [view, setView] = useState("list"),
    [q, setQ] = useState(""),
    [trash, setTrash] = useState(false),
    [selected, setSelected] = useState(""),
    [page, setPage] = useState(0),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null),
    opener = useRef<HTMLElement | null>(null);
  const files = data.files.filter(
    (f) =>
      (!folder || f.projectKey === folder) &&
      (matches[filter] ?? matches.All)(f) &&
      `${f.name} ${f.tag} ${f.projectKey}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  const trashFiles = data.trash.filter(
    (f) =>
      (!folder || f.projectKey === folder) &&
      `${f.name} ${f.projectKey}`.toLowerCase().includes(q.toLowerCase()),
  );
  const current = files.find((f) => f.id === selected);
  const count = trash ? trashFiles.length : files.length;
  const offset = Math.min(page, Math.max(0, Math.ceil(count / 50) - 1)) * 50;
  function reset() {
    setPage(0);
    setSelected("");
  }
  function close() {
    setSelected("");
    opener.current?.focus();
  }
  useEffect(() => {
    if (!selected) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSelected("");
        opener.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [selected]);
  function select(id: string, el: HTMLElement) {
    opener.current = el;
    setSelected(id);
  }
  function remove(f: FileRow) {
    start(async () => {
      setError("");
      const r = await runAction(() => trashBrowserFile(f.id));
      if (r.ok) {
        setSelected("");
        setNotice(`${f.name} moved to Trash. Restore it within 30 days.`);
      } else setError(r.error ?? "Couldn't move the file to Trash.");
    });
  }
  function restore(id: string) {
    start(async () => {
      const r = await runAction(() => restoreDeletedFile(id));
      if (r.ok) setNotice("File restored.");
      else setError(r.error ?? "Couldn't restore the file.");
    });
  }
  return (
    <div className="relative min-h-full">
      <div className="flex min-h-full">
        <aside className="hidden w-56 shrink-0 border-r border-rule-soft px-3 py-6 @4xl/page:block">
          <h2 className="mb-3 px-2 text-label font-semibold text-ink-3">
            Folders
          </h2>
          <button
            onClick={() => {
              setFolder("");
              reset();
            }}
            className={`mb-1 flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-body ${!folder ? "bg-selected" : "hover:bg-hover"}`}
          >
            <Folder className="size-4 shrink-0" />
            All files
          </button>
          <div className="max-h-[75vh] overflow-y-auto">
            {data.projects.map((p) => (
              <button
                key={p.slug}
                onClick={() => {
                  setFolder(p.slug);
                  reset();
                }}
                className={`flex min-h-9 w-full items-start gap-2 rounded-md px-2 py-2 text-left text-body ${folder === p.slug ? "bg-selected" : "hover:bg-hover"}`}
              >
                <Folder className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 pb-16 pt-6 @2xl/page:px-6">
          <PageHeader
            title="Files"
            meta={`${data.files.length.toLocaleString()} files · ${data.projects.length} project folders`}
            actions={
              <>
                <Segmented
                  aria-label="File display"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: "list", label: "List" },
                    { value: "grid", label: "Grid" },
                  ]}
                />
                <Button
                  icon={Plus}
                  disabled={pending}
                  onClick={() => input.current?.click()}
                >
                  {pending ? "Working…" : "Upload"}
                </Button>
              </>
            }
          />
          <input
            ref={input}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const fd = new FormData();
              fd.set("file", file);
              fd.set("project_key", folder);
              start(async () => {
                const r = await runAction(() => uploadFile(fd));
                if (r.ok) setNotice("File uploaded.");
                else setError(r.error ?? "Couldn't upload the file.");
              });
            }}
          />
          <div className="my-5 flex flex-wrap items-center gap-3">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-rule bg-card px-3">
              <Search className="size-4 shrink-0 text-ink-3" />
              <input
                type="search"
                aria-label="Search files"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  reset();
                }}
                placeholder="Search files…"
                className="w-full min-w-0 bg-transparent text-body outline-none"
              />
            </label>
            <Segmented
              aria-label="File status"
              value={trash ? "trash" : "files"}
              onChange={(v) => {
                setTrash(v === "trash");
                reset();
              }}
              options={[
                { value: "files", label: "Files" },
                { value: "trash", label: "Trash", count: data.trash.length },
              ]}
            />
          </div>
          <div className="mb-4 flex flex-wrap gap-3">
            <select
              aria-label="Project folder"
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value);
                reset();
              }}
              className="h-9 min-w-0 max-w-full rounded-md border border-rule bg-card px-2 text-body @4xl/page:hidden"
            >
              <option value="">All project folders</option>
              {data.projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
            {!trash && (
              <select
                aria-label="File type"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  reset();
                }}
                className="h-9 rounded-md border border-rule bg-card px-2 text-body"
              >
                {data.typeFilters.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            )}
            <span className="self-center text-meta text-ink-3">
              {count.toLocaleString()} {trash ? "in Trash" : "shown"}
            </span>
          </div>
          {notice && (
            <p role="status" className="mb-3 text-body text-ok">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="mb-3 text-body text-flag">
              {error}
            </p>
          )}
          {trash ? (
            <TableWrapper className="overflow-visible!">
              <Table density="compact" className="table-fixed">
                <TableHead>
                  <TableRow>
                    <TableHeader>Deleted file</TableHeader>
                    <TableHeader className="w-24 @max-2xl/page:hidden">
                      Deleted
                    </TableHeader>
                    <TableHeader className="w-24">
                      <span className="sr-only">Restore</span>
                    </TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {trashFiles.slice(offset, offset + 50).map((f) => (
                    <TableRow key={f.id}>
                      <TablePrimaryCell meta={f.projectKey || "General files"}>
                        {f.name}
                      </TablePrimaryCell>
                      <TableCell className="whitespace-nowrap @max-2xl/page:hidden">
                        {f.deleted}
                      </TableCell>
                      <TableCell numeric>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() => restore(f.id)}
                        >
                          Restore
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!count && (
                <EmptyState
                  title="Trash is empty"
                  description="Deleted uploads stay here for 30 days so you can restore them."
                />
              )}
            </TableWrapper>
          ) : view === "list" ? (
            <TableWrapper className="overflow-visible!">
              <Table density="compact" className="table-fixed">
                <TableHead>
                  <TableRow>
                    <TableHeader>Name</TableHeader>
                    <TableHeader className="w-36 @max-5xl/page:hidden">
                      Job
                    </TableHeader>
                    <TableHeader className="w-36 @max-xl/page:hidden">
                      Type
                    </TableHeader>
                    <TableHeader className="w-28 @max-2xl/page:hidden">
                      Modified
                    </TableHeader>
                    <TableHeader numeric className="w-20 @max-5xl/page:hidden">
                      Size
                    </TableHeader>
                    <TableHeader className="w-18">
                      <span className="sr-only">Actions</span>
                    </TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {files.slice(offset, offset + 50).map((f) => (
                    <TableRow key={f.id} selected={current?.id === f.id}>
                      <TablePrimaryCell
                        className="min-w-0!"
                        meta={
                          <span className="@xl/page:hidden">
                            {f.tag} · {f.size}
                          </span>
                        }
                      >
                        <button
                          onClick={(e) => select(f.id, e.currentTarget)}
                          className="flex w-full items-center gap-2 text-left font-medium hover:underline"
                        >
                          {f.type === "img" ? (
                            <ImageIcon className="size-4 shrink-0 text-ink-3" />
                          ) : (
                            <FileText className="size-4 shrink-0 text-ink-3" />
                          )}
                          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                            {f.name}
                          </span>
                        </button>
                      </TablePrimaryCell>
                      <TableCell className="@max-5xl/page:hidden">
                        <span className="line-clamp-1">
                          {data.projects.find((p) => p.slug === f.projectKey)
                            ?.name ||
                            f.projectKey ||
                            "General"}
                        </span>
                      </TableCell>
                      <TableCell className="@max-xl/page:hidden">
                        <span className="block break-words text-meta text-ink-3" title={f.tag}>{f.tag}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-meta text-ink-3 @max-2xl/page:hidden">
                        <span className="block whitespace-normal" title={f.modified}>{f.modified}</span>
                      </TableCell>
                      <TableCell
                        numeric
                        className="whitespace-nowrap text-meta @max-5xl/page:hidden"
                      >
                        {f.size}
                      </TableCell>
                      <TableCell>
                        <FileMenu
                          file={f}
                          pending={pending}
                          remove={() => remove(f)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!count && (
                <EmptyState
                  title="No matching files"
                  description="Try another search or folder, or upload a file to keep it here."
                />
              )}
            </TableWrapper>
          ) : (
            <div className="grid grid-cols-2 gap-3 @2xl/page:grid-cols-3 @4xl/page:grid-cols-4 @6xl/page:grid-cols-6">
              {files.slice(offset, offset + 50).map((f) => (
                <div
                  key={f.id}
                  className="relative rounded-lg border border-rule-soft bg-card"
                >
                  <button
                    className="w-full p-2 text-left"
                    onClick={(e) => select(f.id, e.currentTarget)}
                  >
                    {f.type === "img" && f.hasBlob ? (
                      /* eslint-disable-next-line @next/next/no-img-element */ <img
                        loading="lazy"
                        src={`/api/files/${f.id}?w=320`}
                        alt=""
                        className="aspect-square w-full rounded-md object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center rounded-md bg-paper-2">
                        <FileText className="size-8 text-ink-3" />
                      </div>
                    )}
                    <div className="mt-2 line-clamp-2 pr-6 text-body">
                      {f.name}
                    </div>
                    <div className="mt-1 text-meta text-ink-3">{f.size}</div>
                  </button>
                  <div className="absolute bottom-2 right-2">
                    <FileMenu
                      file={f}
                      pending={pending}
                      remove={() => remove(f)}
                    />
                  </div>
                </div>
              ))}
              {!count && (
                <div className="col-span-full">
                  <EmptyState
                    title="No matching files"
                    description="Try another search or folder, or upload a file."
                  />
                </div>
              )}
            </div>
          )}
          {count > 50 && (
            <div className="mt-4 flex items-center justify-between text-meta text-ink-3">
              <span>
                {offset + 1}–{Math.min(offset + 50, count)} of{" "}
                {count.toLocaleString()}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={ChevronLeft}
                  disabled={!offset}
                  onClick={() => setPage(Math.max(0, page - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={ChevronRight}
                  disabled={offset + 50 >= count}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
      {current && (
        <div
          className="absolute inset-0 z-30 flex justify-end bg-ink/15"
          onClick={close}
        >
          <section
            role="dialog"
            aria-label={`Preview ${current.name}`}
            className="sticky top-0 h-[calc(100dvh-48px)] min-h-96 w-full max-w-full overflow-y-auto border-l border-rule bg-card p-4 shadow-pop @xl/page:max-w-80"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <h2 className="min-w-0 flex-1 break-words font-serif text-heading">
                {current.name}
              </h2>
              <Button
                icon={X}
                iconOnly
                aria-label="Close preview"
                title="Close preview"
                onClick={close}
              />
            </div>
            <FileContent file={current} />
            <dl className="my-4 space-y-3 text-body">
              {[
                [
                  "Project",
                  data.projects.find((p) => p.slug === current.projectKey)
                    ?.name ||
                    current.projectKey ||
                    "General files",
                ],
                ["Type", current.tag],
                ["Modified", current.modified],
                ["Size", current.size],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[80px_1fr] gap-3">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
            {current.hasBlob && (
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/files/${current.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-rule px-3 text-label hover:bg-hover"
                >
                  <ExternalLink className="size-3.5" />
                  Open
                </a>
                <a
                  href={`/api/files/${current.id}?download=1`}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-rule px-3 text-label hover:bg-hover"
                >
                  <Download className="size-3.5" />
                  Download
                </a>
                <FileMenu
                  file={current}
                  pending={pending}
                  remove={() => remove(current)}
                />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function FileMenu({
  file,
  pending,
  remove,
}: {
  file: FileRow;
  pending: boolean;
  remove: () => void;
}) {
  return (
    <details className="relative">
      <summary
        aria-label={`Actions for ${file.name}`}
        title="File actions"
        className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md hover:bg-hover max-sm:size-11 [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal className="size-4" />
      </summary>
      <div className="absolute right-0 z-40 mt-1 w-44 rounded-lg border border-rule-soft bg-card p-1 shadow-pop">
        {file.hasBlob ? (
          <>
            <a
              href={`/api/files/${file.id}?download=1`}
              className="flex h-9 items-center rounded px-2 text-body hover:bg-hover"
            >
              Download
            </a>
            <button
              onClick={remove}
              disabled={pending}
              className="h-9 w-full rounded px-2 text-left text-body text-flag hover:bg-hover"
            >
              Move to Trash
            </button>
          </>
        ) : (
          <p className="px-2 py-2 text-meta text-ink-3">No file attached</p>
        )}
      </div>
    </details>
  );
}
function FileContent({ file }: { file: FileRow }) {
  const [text, setText] = useState(""),
    [failed, setFailed] = useState(false);
  const isText =
    /^text\/(?!html)|json|xml/.test(file.mimeType) ||
    /\.(txt|csv|md)$/i.test(file.name);
  useEffect(() => {
    setText("");
    setFailed(false);
    if (!file.hasBlob || !isText) return;
    const controller = new AbortController();
    fetch(`/api/files/${file.id}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        if (Number(r.headers.get("content-length")) > 1024 * 1024)
          throw Error();
        return r.text();
      })
      .then(setText)
      .catch((e) => {
        if (e.name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, [file.id, file.hasBlob, isText]);
  if (!file.hasBlob)
    return (
      <EmptyState
        compact
        title="No file attached"
        description="This entry is an index record. Upload the original to view its contents."
      />
    );
  if (failed)
    return (
      <EmptyState
        compact
        title="Preview unavailable"
        description="Use Open or Download to view this file."
      />
    );
  if (file.type === "img")
    return (
      /* eslint-disable-next-line @next/next/no-img-element */ <img
        src={`/api/files/${file.id}?w=640`}
        onError={() => setFailed(true)}
        alt={file.name}
        className="max-h-96 w-full rounded-md object-contain"
      />
    );
  if (isText)
    return (
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-rule-soft bg-paper p-3 text-body font-sans">
        {text || "Loading preview…"}
      </pre>
    );
  if (/pdf|html/.test(file.mimeType) || /\.pdf$/i.test(file.name))
    return (
      <iframe
        title={`Contents of ${file.name}`}
        sandbox=""
        src={`/api/files/${file.id}`}
        className="h-96 w-full rounded-md border border-rule-soft"
      />
    );
  return (
    <EmptyState
      compact
      title="Open this file to view it"
      description="This format doesn't have an inline preview. Use Open or Download below."
    />
  );
}
