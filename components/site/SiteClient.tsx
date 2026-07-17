"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Globe, Sparkles, Copy, Check, Trash2, ImagePlus, FileText, ArrowLeft } from "lucide-react";
import { Card, Chip, VoiceButton } from "@/components/ui";
import { mergeTranscript } from "@/lib/append-transcript";
import type { BlogPost, ComposerProject } from "@/lib/site";
import { generateDraft, updateDraft, markPosted, deleteDraft } from "@/lib/actions/marketing";

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
      const r = await generateDraft(slug, "blog");
      if (!r.ok) setError(r.error ?? "Couldn't draft.");
      else {
        setMobileEditor(true);
        router.refresh();
      }
    });
  }

  const selectCls =
    "rounded-md border border-rule bg-card px-2.5 py-1.5 text-[13px] text-ink-2 outline-none focus:border-accent";

  return (
    <div className="flex h-full">
      {/* ─── Posts rail ───────────────────────────────────────────── */}
      <aside
        className={`w-full flex-none flex-col overflow-y-auto border-r border-rule bg-paper-2 p-3.5 lg:w-[300px] ${
          mobileEditor ? "hidden lg:flex" : "flex"
        }`}
      >
        <div className="flex items-center gap-1.5">
          <Globe className="size-4 text-accent" strokeWidth={1.75} />
          <h2 className="flex-1 font-serif text-[15px] font-semibold text-ink">Website content</h2>
        </div>
        <div className="mt-0.5 text-[11px] text-ink-3">
          Blog posts about completed jobs. You publish them to the site yourself.
        </div>

        {/* Compose a new post */}
        <Card className="mt-3 p-2.5">
          <div className="mb-1.5 flex items-center gap-1 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-ink-3">
            <Sparkles className="size-3 text-accent" strokeWidth={1.75} /> Write a post
          </div>
          {projects.length === 0 ? (
            <div className="text-[12px] text-ink-3">
              No projects yet — posts are written from completed projects.
            </div>
          ) : (
            <>
              <select
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
              <button
                type="button"
                onClick={generate}
                disabled={pending}
                className="mt-2 w-full rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
              >
                {pending ? "Writing…" : "Write blog post"}
              </button>
            </>
          )}
          {error && <div className="mt-1.5 text-[12px] text-flag">{error}</div>}
        </Card>

        <div className="my-3 border-t border-rule" />

        {posts.length === 0 ? (
          <Card kind="dashed" className="p-4 text-center text-[12px] text-ink-3">
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
                    "rounded-md border px-2.5 py-2 text-left transition-colors",
                    post.id === selectedId
                      ? "border-accent bg-accent-soft"
                      : "border-rule bg-card hover:bg-paper-3",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="flex-1 truncate text-[13px] font-semibold text-ink">
                      {post.projectName || post.title || "Untitled post"}
                    </span>
                    {post.status === "posted" ? (
                      <Chip kind="money" dot>posted</Chip>
                    ) : needsMedia ? (
                      <Chip kind="flag">needs photos</Chip>
                    ) : null}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-ink-3">{post.createdLabel}</div>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {/* ─── Editor ───────────────────────────────────────────────── */}
      <section
        className={`min-w-0 flex-1 flex-col overflow-y-auto bg-paper-3 p-4 sm:p-6 ${
          mobileEditor ? "flex" : "hidden lg:flex"
        }`}
      >
        <button
          type="button"
          onClick={() => setMobileEditor(false)}
          className="mb-3 -ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2 lg:hidden"
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
            <FileText className="mx-auto size-8 text-ink-4" strokeWidth={1.25} />
            <div className="mt-2 font-serif text-[16px] font-semibold text-ink-2">
              No post selected
            </div>
            <div className="mt-1 text-[12px] text-ink-3">
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
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const dirty = body !== post.body;
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
      await updateDraft(post.id, body);
      router.refresh();
    });
  }
  function post_() {
    startTransition(async () => {
      await markPosted(post.id);
      router.refresh();
    });
  }
  function remove() {
    startTransition(async () => {
      await deleteDraft(post.id);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <div className="mb-3 flex items-center gap-2">
        <Chip kind="accent">Blog post</Chip>
        <h1 className="flex-1 truncate font-serif text-[22px] font-medium text-ink">
          {post.projectName || post.title || "Untitled post"}
        </h1>
        {post.status === "posted" && <Chip kind="money" dot>posted</Chip>}
      </div>

      {/* Media ask — the post can't go live without imagery. Informational, never
          sends anything to the client. */}
      {needsPhotos && (
        <Card kind="soft" className="mb-3 flex items-start gap-2.5 border-flag/40 p-3">
          <ImagePlus className="mt-0.5 size-4 flex-none text-flag" strokeWidth={1.75} />
          <div className="text-[12px] leading-relaxed text-ink-2">
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
        <div className="mb-3 text-[11px] text-ink-3">
          No video on file for this project — optional, but a short clip helps the post.
        </div>
      )}

      <div className="relative">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
          className="w-full resize-y rounded-md border border-rule bg-paper px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none focus:border-accent"
        />
        <div className="absolute right-2 top-2">
          <VoiceButton compact onText={(t) => setBody((cur) => mergeTranscript(cur, t))} />
        </div>
      </div>

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
        {post.status !== "posted" && (
          <button
            type="button"
            onClick={post_}
            disabled={pending}
            className="rounded-md border border-ink bg-ink px-2 py-1 text-[11px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60"
          >
            Mark posted
          </button>
        )}
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label="Delete post"
          className="rounded-md border border-rule bg-card px-1.5 py-1 text-ink-3 hover:bg-paper-2 hover:text-flag disabled:opacity-60"
        >
          <Trash2 className="size-3.5" strokeWidth={1.5} />
        </button>
      </div>

      <div className="mt-2.5 text-[11px] text-ink-3">
        Publishing is manual — copy this post onto sjcarpentryllc.com yourself, then mark it posted.
        Nothing is published from here.
      </div>
    </div>
  );
}
