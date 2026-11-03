"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Copy, Megaphone, Sparkles } from "lucide-react";
import { Button, Card, Chip, EmptyState, PageHeader, Segmented } from "@/components/ui";
import type { MarketingDraft } from "@/lib/marketing";
import { deleteDraft, generateDraft, markDraft, markPosted, updateDraft } from "@/lib/actions/marketing";
import { runAction } from "@/lib/run-action";
import { PostPhotos } from "./PostPhotos";
import { PostPreview } from "./PostPreview";

const input = "min-w-0 rounded-md border border-rule bg-card px-3 py-2 text-body text-ink";

/** /marketing — AI-drafted social + blog posts. Draft from a project, edit the
 *  headline and copy (with a rendered preview), then copy it, download the
 *  photos the client OK'd and post it by hand. */
export function MarketingClient({
  drafts,
  projects,
  isOwner,
}: {
  drafts: MarketingDraft[];
  projects: { slug: string; name: string }[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(projects[0]?.slug ?? "");
  const [kind, setKind] = useState("social");
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const open = drafts.filter((d) => d.status !== "posted").length;

  function generate() {
    if (!slug) return setError("Choose a project to draft about.");
    setError("");
    start(async () => {
      const r = await runAction(() => generateDraft(slug, kind), { fallback: "Couldn't draft a post." });
      if (!r.ok) setError(r.error ?? "Couldn't draft a post.");
      else router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 @3xl/page:px-6">
      <PageHeader
        title="Marketing"
        meta={`${open} ${open === 1 ? "post" : "posts"} not posted yet · Copy the text, download the photos, post it yourself.`}
      />

      <Card className="p-4">
        <h2 className="mb-3 text-subheading font-semibold">Draft from a project</h2>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Project" value={slug} onChange={(e) => setSlug(e.target.value)} className={`${input} w-full @3xl/page:w-auto @3xl/page:flex-1`}>
            <option value="">Choose a project…</option>
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </select>
          <select aria-label="Post type" value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
            <option value="social">Social post</option>
            <option value="blog">Blog post</option>
          </select>
          <Button variant="ai" icon={Sparkles} disabled={pending || !slug} onClick={generate}>
            {pending ? "Drafting…" : "Draft a post"}
          </Button>
        </div>
        {error && <p role="alert" className="mt-2 text-body text-flag">{error}</p>}
      </Card>

      {drafts.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Your posts start here"
          description="Choose a project above to draft a social or blog post. A social post also drafts itself when a job is completed."
        />
      ) : (
        <div className="divide-y divide-rule-soft">
          {drafts.map((draft, i) => (
            <DraftRow key={draft.id} draft={draft} isOwner={isOwner} initiallyOpen={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftRow({ draft, isOwner, initiallyOpen }: { draft: MarketingDraft; isOwner: boolean; initiallyOpen: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [body, setBody] = useState(draft.body);
  const [title, setTitle] = useState(draft.title);
  const [view, setView] = useState("edit");
  const [feedback, setFeedback] = useState("");
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const dirty = body !== draft.body || title !== draft.title;
  // Locked once it's marked posted (Move to drafts to change it).
  const posted = draft.status === "posted";
  const editable = !posted;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done = "Saved") =>
    start(async () => {
      const r = await runAction(fn, { onError: setFeedback });
      if (r.ok) {
        setFeedback(done);
        router.refresh();
      }
    });

  async function copy() {
    try {
      await navigator.clipboard.writeText(title.trim() && draft.kind === "blog" ? `${title}\n\n${body}` : body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="py-4">
      <div className="flex items-start gap-3">
        <button type="button" className="min-h-11 min-w-0 flex-1 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
          <h2 className="text-subheading font-semibold">{draft.title || draft.projectName || "Post"}</h2>
          <p className="mt-1 text-meta text-ink-3">
            {draft.kindLabel}
            {draft.projectName ? ` · ${draft.projectName}` : ""} · {draft.createdLabel}
          </p>
        </button>
        <span className="self-center text-meta text-ink-3 max-sm:hidden">{open ? "Hide post" : "Open post"}</span>
        <ChevronRight aria-hidden="true" className={`size-4 shrink-0 self-center text-ink-3 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="self-center">{posted ? <Chip kind="money" dot>posted</Chip> : <Chip kind="ghost">Draft</Chip>}</span>
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          {draft.projectSlug && (
            <Link href={`/projects/${draft.projectSlug}`} className="text-body text-accent-2 hover:underline">
              Source project · {draft.projectName} →
            </Link>
          )}
          <p role="status" className={`text-meta ${feedback && feedback !== "Saved" && !pending ? "text-flag" : "text-ink-2"}`}>
            {pending ? "Saving…" : feedback || (dirty ? "Unsaved changes" : editable ? "Saved" : "Posted. Move it back to drafts to edit it.")}
          </p>

          <Segmented
            aria-label="Post view"
            value={view}
            onChange={setView}
            options={[{ value: "edit", label: "Edit" }, { value: "preview", label: "Preview" }]}
            className="h-12 [&_button]:h-11"
          />
          {view === "edit" ? (
            <div className="space-y-3">
              <label className="block text-label text-ink-2">
                Headline
                <input disabled={pending || !editable} value={title} onChange={(e) => { setTitle(e.target.value); setFeedback(""); }} className={`${input} mt-1.5 w-full`} />
              </label>
              {draft.copyError && <p role="status" className="text-body text-warn">{draft.copyError}</p>}
              <label className="block text-label text-ink-2">
                Post copy
                <textarea
                  disabled={pending || !editable}
                  value={body}
                  onChange={(e) => { setBody(e.target.value); setFeedback(""); }}
                  rows={draft.kind === "blog" ? 10 : 4}
                  className={`${input} mt-2 w-full resize-y leading-relaxed`}
                />
              </label>
            </div>
          ) : (
            <PostPreview title={title} body={body} />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon={copied ? Check : Copy} disabled={!body.trim()} onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
            {dirty && (
              <>
                <Button size="sm" disabled={pending || !body.trim() || !title.trim()} onClick={() => run(() => updateDraft(draft.id, body, title))}>
                  Save edits
                </Button>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => { setBody(draft.body); setTitle(draft.title); setFeedback(""); }}>
                  Revert
                </Button>
              </>
            )}
            {!posted && (
              <Button variant="secondary" size="sm" disabled={pending || dirty || !body.trim()} title={dirty ? "Save your edits first" : undefined} onClick={() => run(() => markPosted(draft.id), "Marked posted")}>
                Mark posted
              </Button>
            )}
            {posted && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => markDraft(draft.id), "Moved back to drafts")}>
                Move to drafts
              </Button>
            )}
            <details className="relative ml-auto">
              <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md px-3 text-body hover:bg-hover [&::-webkit-details-marker]:hidden">
                Post actions
              </summary>
              <div className="absolute right-0 z-10 rounded-lg border border-rule-soft bg-card p-1 shadow-pop">
                <Button variant="ghost" size="sm" className="text-flag" disabled={pending} onClick={() => { if (confirm("Delete this draft?")) run(() => deleteDraft(draft.id), "Deleted"); }}>
                  Delete draft
                </Button>
              </div>
            </details>
          </div>

          <PostPhotos draft={draft} isOwner={isOwner} />
        </div>
      )}
    </section>
  );
}
