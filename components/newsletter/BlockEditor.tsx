"use client";

// Per-block editor for the newsletter builder (P7-N). A block used to be a fixed
// heading+body pair; it can now be text, a photo, a button, a divider or a pull
// quote, so the editing affordances have to change with the kind rather than
// showing two textareas for everything.

import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, ImagePlus, Link2, Loader2, Plus, X } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { AI_NAME } from "@/lib/ai-name";
import { uploadIssueImage, fetchLinkImage } from "@/lib/actions/newsletter";
import type { BlockKind, NewsletterBlock, RecentJob } from "@/lib/newsletter";

const input =
  "w-full rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent disabled:bg-paper-2";

const KIND_LABEL: Record<BlockKind, string> = {
  text: "Text",
  image: "Photo",
  button: "Button",
  divider: "Divider",
  quote: "Quote",
};

export function BlockEditor({
  block,
  index,
  total,
  locked,
  onChange,
  onRemove,
  onMove,
  onNotice,
}: {
  block: NewsletterBlock;
  index: number;
  total: number;
  locked: boolean;
  onChange: (patch: Partial<NewsletterBlock>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onNotice: (msg: string | null) => void;
}) {
  const kind: BlockKind = block.kind ?? "text";

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Chip kind="ghost">{KIND_LABEL[kind]}</Chip>
        {block.projectSlug && <Chip kind="ghost">{block.projectSlug}</Chip>}
        <div className="ml-auto flex items-center gap-0.5">
          {!locked && (
            <>
              <button
                type="button"
                onClick={() => onMove(-1)}
                disabled={index === 0}
                className="rounded p-0.5 text-ink-4 hover:bg-paper-2 hover:text-ink-2 disabled:opacity-25"
                aria-label="Move up"
              >
                <ChevronUp className="size-3.5" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={() => onMove(1)}
                disabled={index === total - 1}
                className="rounded p-0.5 text-ink-4 hover:bg-paper-2 hover:text-ink-2 disabled:opacity-25"
                aria-label="Move down"
              >
                <ChevronDown className="size-3.5" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="rounded p-0.5 text-ink-4 hover:text-flag"
                aria-label="Remove section"
              >
                <X className="size-3.5" strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </div>

      {kind === "divider" && (
        <div className="py-1">
          <div className="border-t border-rule" />
          <p className="mt-1.5 text-[11px] text-ink-3">A horizontal rule between sections.</p>
        </div>
      )}

      {kind === "text" && (
        <>
          <input
            value={block.heading}
            onChange={(e) => onChange({ heading: e.target.value })}
            disabled={locked}
            placeholder="Section heading"
            className="mb-1.5 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 font-serif text-[15px] font-semibold text-ink outline-none hover:border-rule-soft focus:border-accent disabled:opacity-70"
          />
          <textarea
            value={block.body}
            onChange={(e) => onChange({ body: e.target.value })}
            disabled={locked}
            rows={3}
            placeholder="What happened, what you'd tell a client…"
            className={`${input} resize-y`}
          />
        </>
      )}

      {kind === "quote" && (
        <>
          <textarea
            value={block.body}
            onChange={(e) => onChange({ body: e.target.value })}
            disabled={locked}
            rows={2}
            placeholder="“They finished a day early and cleaned up better than we left it.”"
            className={`${input} resize-y italic`}
          />
          <input
            value={block.heading}
            onChange={(e) => onChange({ heading: e.target.value })}
            disabled={locked}
            placeholder="Who said it — optional"
            className={`${input} mt-1.5`}
          />
        </>
      )}

      {kind === "image" && (
        <ImageBlock block={block} locked={locked} onChange={onChange} onNotice={onNotice} />
      )}

      {kind === "button" && (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <input
              value={block.buttonLabel ?? ""}
              onChange={(e) => onChange({ buttonLabel: e.target.value })}
              disabled={locked}
              placeholder="Book an estimate"
              className={input}
            />
            <select
              value={block.align ?? "center"}
              onChange={(e) => onChange({ align: e.target.value as "left" | "center" })}
              disabled={locked}
              className="rounded-md border border-rule bg-paper px-2 py-1.5 text-[12px] text-ink-2 outline-none focus:border-accent"
            >
              <option value="center">Center</option>
              <option value="left">Left</option>
            </select>
          </div>
          <input
            value={block.buttonUrl ?? ""}
            onChange={(e) => onChange({ buttonUrl: e.target.value })}
            disabled={locked}
            placeholder="sjcarpentryllc.com/contact"
            className={`${input} font-mono text-[12px]`}
          />
          <p className="text-[11px] text-ink-3">
            Both fields are required — a button with no link is dropped when the issue is sent.
          </p>
        </div>
      )}
    </Card>
  );
}

/** Photo block: upload → publish → store the token. The upload happens
 *  immediately (not on issue save) because the token is what the block stores,
 *  and holding the File in React state until save would lose it on a reload. */
function ImageBlock({
  block,
  locked,
  onChange,
  onNotice,
}: {
  block: NewsletterBlock;
  locked: boolean;
  onChange: (patch: Partial<NewsletterBlock>) => void;
  onNotice: (msg: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState(block.buttonUrl ?? "");

  async function upload(file: File) {
    setBusy(true);
    onNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("alt", block.imageAlt ?? "");
      const res = await uploadIssueImage(form);
      if (res.ok && res.data) onChange({ imageToken: res.data.token });
      else onNotice(res.ok ? "Upload failed." : res.error);
    } catch {
      onNotice("Upload failed — try a smaller image.");
    } finally {
      setBusy(false);
    }
  }

  async function pullFromLink() {
    const url = linkUrl.trim();
    if (!url) return;
    setBusy(true);
    onNotice(null);
    try {
      const res = await fetchLinkImage(url);
      if (res.ok && res.data) {
        // The link becomes the click-through — tapping the photo opens the
        // page it was pulled from, same as a button block's URL.
        onChange({
          imageToken: res.data.token,
          imageAlt: block.imageAlt?.trim() || res.data.title,
          buttonUrl: url,
        });
        setLinkOpen(false);
      } else onNotice(res.ok ? "Couldn't fetch a preview from that link." : res.error);
    } catch {
      onNotice("Couldn't fetch a preview from that link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {block.imageToken ? (
        /* eslint-disable-next-line @next/next/no-img-element -- the asset route is
           deliberately outside the Next image pipeline: it must stay a plain,
           publicly-fetchable URL that mail clients can load. */
        <img
          src={`/api/newsletter/img/${block.imageToken}`}
          alt={block.imageAlt ?? ""}
          className="max-h-[220px] w-full rounded-md border border-rule object-cover"
        />
      ) : (
        <div className="flex h-[110px] items-center justify-center rounded-md border border-dashed border-rule text-[12px] text-ink-3">
          No photo yet
        </div>
      )}

      {!locked && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                <ImagePlus className="size-3.5" strokeWidth={1.5} />
              )}
              {busy ? "Working…" : block.imageToken ? "Replace photo" : "Upload photo"}
            </button>
            <button
              type="button"
              onClick={() => setLinkOpen((o) => !o)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 disabled:opacity-60"
            >
              <Link2 className="size-3.5" strokeWidth={1.5} /> Pull from a link
            </button>
          </div>
          {linkOpen && (
            <div className="space-y-1">
              <div className="flex gap-1.5">
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && pullFromLink()}
                  disabled={busy}
                  placeholder="sjcarpentryllc.com/blog/whatever-post"
                  className={`${input} font-mono text-[12px]`}
                />
                <button
                  type="button"
                  onClick={pullFromLink}
                  disabled={busy || !linkUrl.trim()}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
                >
                  Fetch
                </button>
              </div>
              <p className="text-[11px] text-ink-3">
                Pulls the page&apos;s preview image (og:image) and title. Tapping the photo will
                open that link — same as a button block&apos;s URL.
              </p>
            </div>
          )}
        </>
      )}

      <input
        value={block.caption ?? ""}
        onChange={(e) => onChange({ caption: e.target.value })}
        disabled={locked}
        placeholder="Caption — optional"
        className={input}
      />
      <input
        value={block.imageAlt ?? ""}
        onChange={(e) => onChange({ imageAlt: e.target.value })}
        disabled={locked}
        placeholder="Describe the photo (shown when images are blocked)"
        className={input}
      />
      <p className="text-[11px] text-ink-3">
        Most clients block images until the reader allows them — the description is what they see
        first.
      </p>

      {block.buttonUrl && (
        <div className="flex items-center gap-1.5 rounded-md bg-paper-2 px-2.5 py-1.5 text-[11px] text-ink-2">
          <Link2 className="size-3 shrink-0 text-ink-4" strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate font-mono">{block.buttonUrl}</span>
          {!locked && (
            <button
              type="button"
              onClick={() => onChange({ buttonUrl: "" })}
              className="shrink-0 text-ink-4 hover:text-flag"
              aria-label="Remove link"
            >
              <X className="size-3" strokeWidth={2} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The row of "add a…" affordances under the block list. */
export function AddBlockBar({
  pending,
  recentJobs,
  onAdd,
  onAddJob,
}: {
  pending: boolean;
  recentJobs: RecentJob[];
  onAdd: (block: NewsletterBlock) => void;
  onAddJob: (slug: string) => void;
}) {
  const kinds: BlockKind[] = ["text", "image", "button", "quote", "divider"];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() =>
            onAdd({
              kind: k,
              heading: "",
              body: "",
              ...(k === "button" ? { align: "center" as const } : {}),
            })
          }
          className="inline-flex items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2"
        >
          <Plus className="size-3.5" strokeWidth={2} /> {KIND_LABEL[k]}
        </button>
      ))}
      {recentJobs.length > 0 && (
        <select
          value=""
          onChange={(e) => onAddJob(e.target.value)}
          disabled={pending}
          className="rounded-md border border-rule bg-paper px-2 py-1 text-[12px] text-ink-2 outline-none focus:border-accent"
        >
          <option value="">+ Add from a completed job…</option>
          {recentJobs.map((j) => (
            <option key={j.slug} value={j.slug}>
              {j.name}
              {j.city ? ` — ${j.city}` : ""}
            </option>
          ))}
        </select>
      )}
      {pending && <span className="text-[11px] text-ink-3">{AI_NAME} drafting…</span>}
    </div>
  );
}
