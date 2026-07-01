"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Sparkles, Copy, Check, Trash2, Send } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { MarketingDraft } from "@/lib/marketing";
import { generateDraft, updateDraft, markPosted, deleteDraft } from "@/lib/actions/marketing";

/** /marketing — AI-drafted social + blog posts. Owner generates from a project,
 *  edits inline, copies, and marks posted (manual posting — no social API). */
export function MarketingClient({
  drafts,
  projects,
}: {
  drafts: MarketingDraft[];
  projects: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(projects[0]?.slug ?? "");
  const [kind, setKind] = useState("social");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function generate() {
    if (!slug) {
      setError("Pick a project to draft about.");
      return;
    }
    setError("");
    startTransition(async () => {
      const r = await generateDraft(slug, kind);
      if (!r.ok) setError(r.error ?? "Couldn't draft.");
      else router.refresh();
    });
  }

  const selectCls =
    "rounded-md border border-rule bg-card px-2.5 py-1.5 text-[13px] text-ink-2 outline-none focus:border-accent";

  return (
    <div className="mx-auto max-w-[860px] px-7 pb-16 pt-6">
      <div className="mb-4 flex items-center gap-2">
        <Megaphone className="size-5 text-accent" strokeWidth={1.75} />
        <div className="flex-1">
          <h1 className="font-serif text-[30px] font-medium leading-none text-accent-2">Marketing</h1>
          <div className="mt-1 text-[11px] text-ink-3">AI-drafted posts — you review and post them yourself.</div>
        </div>
      </div>

      {/* Generate */}
      <Card className="mb-5 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-4 flex-none text-accent" strokeWidth={1.75} />
          <select value={slug} onChange={(e) => setSlug(e.target.value)} className={`${selectCls} min-w-[180px] flex-1`}>
            <option value="">Pick a project…</option>
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={selectCls}>
            <option value="social">Social post</option>
            <option value="blog">Blog post</option>
          </select>
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
          >
            {pending ? "Drafting…" : "Draft a post"}
          </button>
        </div>
        {error && <div className="mt-1.5 text-[12px] text-flag">{error}</div>}
      </Card>

      {drafts.length === 0 ? (
        <Card kind="dashed" className="p-8 text-center text-[13px] text-ink-3">
          No drafts yet. Draft a social or blog post from a project above — a social post also auto-drafts when a job completes.
        </Card>
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftCard({ draft }: { draft: MarketingDraft }) {
  const router = useRouter();
  const [body, setBody] = useState(draft.body);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const dirty = body !== draft.body;

  function copy() {
    navigator.clipboard?.writeText(body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  function save() {
    startTransition(async () => {
      await updateDraft(draft.id, body);
      router.refresh();
    });
  }
  function post() {
    startTransition(async () => {
      await markPosted(draft.id);
      router.refresh();
    });
  }
  function remove() {
    startTransition(async () => {
      await deleteDraft(draft.id);
      router.refresh();
    });
  }

  return (
    <Card className="p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Chip kind={draft.kind === "blog" ? "accent" : "ghost"}>{draft.kindLabel}</Chip>
        <span className="flex-1 truncate font-serif text-[14px] font-semibold text-ink">
          {draft.projectName || draft.title || "Post"}
        </span>
        {draft.status === "posted" ? (
          <Chip kind="money" dot>posted</Chip>
        ) : (
          <span className="font-mono text-[10px] text-ink-3">{draft.createdLabel}</span>
        )}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={draft.kind === "blog" ? 8 : 4}
        className="w-full resize-y rounded-md border border-rule bg-paper px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-accent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2"
        >
          {copied ? <Check className="size-3 text-money" strokeWidth={2} /> : <Copy className="size-3" strokeWidth={1.75} />}
          {copied ? "Copied" : "Copy"}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-md border border-accent bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent-2 hover:bg-accent-soft/70 disabled:opacity-60"
          >
            Save edits
          </button>
        )}
        <div className="flex-1" />
        {draft.status !== "posted" && (
          <button
            type="button"
            onClick={post}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2 py-1 text-[11px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
          >
            <Send className="size-3" strokeWidth={1.75} /> Mark posted
          </button>
        )}
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label="Delete draft"
          className="rounded-md border border-rule bg-card px-1.5 py-1 text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-60"
        >
          <Trash2 className="size-3.5" strokeWidth={1.5} />
        </button>
      </div>
    </Card>
  );
}
