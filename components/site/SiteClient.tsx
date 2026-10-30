"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Globe, Sparkles, Copy, Check, Trash2, ImagePlus, FileText, ArrowLeft, ChevronRight } from "lucide-react";
import { Card, Chip, VoiceButton, Button, PageHeader } from "@/components/ui";
import { PostPreview } from "@/components/marketing/PostPreview";
import { mergeTranscript } from "@/lib/append-transcript";
import type { BlogPost, ComposerProject } from "@/lib/site";
import { generateDraft, updateDraft, markPosted, markDraft, deleteDraft } from "@/lib/actions/marketing";
import { runAction } from "@/lib/run-action";

// Website Content Composer (P2-4). Replaces the old mock CMS Site tab. Writes the
// blog post about a completed project (a blog draft also auto-generates on
// close-out) and asks for photos/video when none are on file. GATE: nothing here
// publishes outward — "Mark posted" only flips a status after Joe posts it to the
// website himself. No CMS API, no outbound send anywhere in this component.
export function SiteClient({
  posts,
  projects,
}: {
  posts: BlogPost[];
  projects: ComposerProject[];
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(projects[0]?.slug ?? "");
  const [selectedId, setSelectedId] = useState<number | null>(posts[0]?.id ?? null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  // Phones can't fit the posts rail + editor side by side; show one at a time
  // (selecting a post reveals the editor, back returns to the list). Desktop
  // keeps both panes — this only toggles below `lg`.
  const [mobileEditor, setMobileEditor] = useState(false);

  const selected = posts.find((p) => p.id === selectedId) ?? null;
  const projectBySlug = new Map(projects.map((p) => [p.slug, p]));

  function generate() {
    if (!slug) {
      setError("Pick a project to write about.");
      return;
    }
    setError("");
    startTransition(async () => {
      const r = await runAction(() => generateDraft(slug, "blog"), { fallback: "Couldn't draft." });
      if (!r.ok) setError(r.error ?? "Couldn't draft.");
      else {
        if (r.id != null) setSelectedId(r.id);
        setMobileEditor(true);
        router.refresh();
      }
    });
  }

  const selectCls =
    "rounded-md border border-rule bg-card px-2.5 py-1.5 text-body text-ink-2 outline-none focus:border-accent";

  return (
    <div className="flex min-h-full min-w-0">
      {/* ─── Posts rail ───────────────────────────────────────────── */}
      <aside
        className={`w-full flex-none flex-col overflow-y-auto border-r border-rule-soft bg-paper p-3.5 @5xl/page:w-56 ${
          mobileEditor ? "hidden @5xl/page:flex" : "flex"
        }`}
      >
        <div className="flex items-center gap-1.5">
          <Globe className="size-4 text-accent" strokeWidth={1.75} />
          <h2 className="flex-1 font-serif text-subheading font-semibold text-ink">Website content</h2>
        </div>
        <div className="mt-0.5 text-meta text-ink-3">
          Blog posts about completed jobs. You publish them to the site yourself.
        </div>

        {/* Compose a new post */}
        <Card className="mt-3 p-2.5">
          <div className="mb-1.5 flex items-center gap-1 text-label font-medium text-ink-3">
            <Sparkles className="size-3 text-accent" strokeWidth={1.75} /> Write a post
          </div>
          {projects.length === 0 ? (
            <div className="text-meta text-ink-3">
              No projects yet — posts are written from completed projects.
            </div>
          ) : (
            <>
              <select
                aria-label="Project"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className={`${selectCls} w-full`}
              >
                {projects.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                    {p.mediaReady ? "" : " · no photos"}
                  </option>
                ))}
              </select>
              <Button variant="ai" icon={Sparkles} onClick={generate} disabled={pending} className="mt-2 w-full">
                {pending ? "Writing…" : "Write blog post"}
              </Button>
            </>
          )}
          {error && <div className="mt-1.5 text-meta text-flag">{error}</div>}
        </Card>

        <div className="my-3 border-t border-rule" />

        {posts.length === 0 ? (
          <Card kind="dashed" className="p-4 text-center text-meta text-ink-3">
            No posts yet. Write one above — a blog post also auto-drafts when a job completes.
          </Card>
        ) : (
          <div className="flex flex-col gap-1.5">
            {posts.map((post) => {
              const proj = post.projectSlug ? projectBySlug.get(post.projectSlug) : undefined;
              const needsMedia = proj ? !proj.mediaReady : false;
              return (
                <button
                  key={post.id}
                  onClick={() => {
                    setSelectedId(post.id);
                    setMobileEditor(true);
                  }}
                  className={[
                    "rounded-md px-2.5 py-3 text-left transition-colors",
                    post.id === selectedId
                      ? "bg-selected"
                      : "hover:bg-hover",
                  ].join(" ")}
                >
                  <div className="flex flex-col items-start gap-1.5">
                    <span className="min-w-0 text-body font-semibold text-ink">
                      {post.projectName || post.title || "Untitled post"}
                    </span>
                    {post.status === "posted" ? (
                      <Chip kind="money" dot>posted</Chip>
                    ) : needsMedia ? (
                      <Chip kind="flag">needs photos</Chip>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-meta text-ink-3">{post.createdLabel}<ChevronRight aria-hidden="true" className="size-4 @5xl/page:hidden" /></div>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {/* ─── Editor ───────────────────────────────────────────────── */}
      <section
        className={`min-w-0 flex-1 flex-col overflow-y-auto bg-paper p-4 @xl/page:p-6 ${
          mobileEditor ? "flex" : "hidden @5xl/page:flex"
        }`}
      >
        <button
          type="button"
          onClick={() => setMobileEditor(false)}
          className="mb-3 -ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-meta font-semibold text-ink-2 hover:bg-paper-2 @5xl/page:hidden"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.5} /> Posts
        </button>
        {selected ? (
          <PostEditor
            key={selected.id}
            post={selected}
            project={selected.projectSlug ? projectBySlug.get(selected.projectSlug) : undefined}
          />
        ) : (
          <div className="m-auto max-w-[380px] text-center">
            <FileText className="mx-auto size-8 text-ink-3" strokeWidth={1.25} />
            <div className="mt-2 font-serif text-heading font-semibold text-ink-2">
              No post selected
            </div>
            <div className="mt-1 text-meta text-ink-3">
              Pick a post from the list, or write a new one from a completed project.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function PostEditor({ post, project }: { post: BlogPost; project?: ComposerProject }) {
  const router = useRouter();
  const [body, setBody] = useState(post.body);
  const [title, setTitle] = useState(post.title);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState("");
  const dirty = body !== post.body || title !== post.title;
  const needsPhotos = project ? project.photoCount === 0 : false;
  const needsVideo = project ? project.photoCount > 0 && project.videoCount === 0 : false;

  function copy() {
    navigator.clipboard?.writeText(body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  function save() {
    startTransition(async () => {
      await runAction(() => updateDraft(post.id, body, title), { fallback: "Couldn't save the edits.", onSuccess:()=>{setFeedback("Saved");router.refresh();},onError:setFeedback });
    });
  }
  function post_() {
    startTransition(async () => {
      await runAction(() => markPosted(post.id), { fallback: "Couldn't mark it posted." });
      router.refresh();
    });
  }
  function remove() {
    startTransition(async () => {
      await runAction(() => deleteDraft(post.id), { fallback: "Couldn't delete the post." });
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <PageHeader className="mb-5" variant="record" title={post.title || post.projectName || "Untitled post"} badge={<Chip kind={post.status==='posted'?'money':'ghost'}>{post.status==='posted'?'Posted':'Draft'}</Chip>} meta={post.projectName} />

      {post.projectSlug && <Link href={`/projects/${post.projectSlug}`} className="mb-3 block text-body text-accent-2 hover:underline">Source project · {post.projectName} →</Link>}
      <p role="status" className="mb-3 text-meta text-ink-2">{pending ? "Saving…" : feedback || (dirty ? "Unsaved changes" : "Saved")}</p>
      {/* Media ask — the post can't go live without imagery. Informational, never
          sends anything to the client. */}
      {needsPhotos && (
        <Card kind="soft" className="mb-3 flex items-start gap-2.5 border-flag/40 p-3">
          <ImagePlus className="mt-0.5 size-4 flex-none text-flag" strokeWidth={1.75} />
          <div className="text-meta leading-relaxed text-ink-2">
            <span className="font-semibold text-ink">Needs photos or video.</span> This project has
            no photos on file{project && project.videoCount > 0 ? " (video only)" : ""}, and a blog
            post shouldn&apos;t go live without them.{" "}
            {post.projectSlug ? (
              <Link
                href={`/projects/${post.projectSlug}`}
                className="font-semibold text-accent-2 underline underline-offset-2"
              >
                Add project photos →
              </Link>
            ) : (
              "Add project photos before publishing."
            )}
          </div>
        </Card>
      )}
      {needsVideo && (
        <div className="mb-3 text-meta text-ink-3">
          No video on file for this project — optional, but a short clip helps the post.
        </div>
      )}

      <label className="mb-4 block text-label text-ink-2">Headline
        <input disabled={pending} value={title} onChange={e=>{setTitle(e.target.value);setFeedback("");}} className="mt-1.5 w-full rounded-md border border-rule bg-card px-3 py-2 text-body text-ink focus:border-accent" />
      </label>
      {post.copyError && <p role="status" className="mb-3 text-body text-warn">{post.copyError}</p>}
      <div className="relative">
        <textarea
          disabled={pending}
          value={body}
          onChange={(e) => {setBody(e.target.value);setFeedback("");}}
          rows={16}
          aria-label="Blog post copy"
          className="w-full resize-y rounded-md border border-rule bg-paper px-3 py-2.5 text-body leading-relaxed text-ink outline-none focus:border-accent"
        />
        <div className="absolute right-2 top-2">
          <VoiceButton compact onText={(t) => {setBody((cur) => mergeTranscript(cur, t));setFeedback("");}} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon={copied?Check:Copy} disabled={!body.trim()} onClick={copy}>{copied?'Copied':'Copy'}</Button>
        {dirty&&<><Button size="sm" disabled={pending||!body.trim()||!title.trim()} onClick={save}>Save edits</Button><Button variant="ghost" size="sm" disabled={pending} onClick={()=>{setBody(post.body);setTitle(post.title);setFeedback('');}}>Revert</Button></>}
        <Button variant="secondary" size="sm" disabled={pending||dirty||(!body.trim()&&post.status!=='posted')} onClick={()=>startTransition(async()=>{await runAction(()=>post.status==='posted'?markDraft(post.id):markPosted(post.id), {onError:setFeedback,onSuccess:()=>{setFeedback("Saved");router.refresh();}});})}>{post.status==='posted'?'Move to drafts':'Mark posted'}</Button>
        <details className="relative ml-auto"><summary aria-label="More post actions" className="cursor-pointer px-3 py-1 text-body">…</summary><div className="absolute right-0 z-10 rounded-lg border border-rule-soft bg-card p-1 shadow-pop"><Button variant="ghost" size="sm" className="text-flag" disabled={pending} onClick={()=>{if(confirm('Delete this post?'))remove();}}>Delete post</Button></div></details>
      </div>

      <div className="mt-4"><PostPreview title={title} body={body} /></div>
      <div className="mt-2.5 text-meta text-ink-3">
        Publishing is manual — copy this post onto sjcarpentryllc.com yourself, then mark it posted.
        Nothing is published from here.
      </div>
    </div>
  );
}
