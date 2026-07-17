import "server-only";

// Website content composer reads (P2-4). The /site screen is the Website Content
// Composer: it writes the blog post about a completed project and asks for
// photos/video if none are on file. Backed by the existing `marketing_drafts`
// table filtered to kind='blog' (no new table — the live DB is untouched).
//
// GATE: nothing here (or in the composer) publishes outward. "Posting" is manual
// — Joe copies a finished post onto sjcarpentryllc.com himself, then marks it
// posted. There is no CMS API, no HTTP push, no email/SMS anywhere in this path.
//
// Writes reuse lib/actions/marketing.ts (generateDraft/updateDraft/markPosted/
// deleteDraft with kind='blog', plus autoDraftBlogOnCompletion on close-out).

import { query } from "./db";

/** A website blog post draft, grounded on a completed project. */
export interface BlogPost {
  id: number;
  title: string;
  body: string;
  status: "draft" | "posted";
  projectName: string | null;
  projectSlug: string | null;
  createdLabel: string;
}

/** A project the composer can write about, with its media readiness. */
export interface ComposerProject {
  slug: string;
  name: string;
  /** Uploaded project photos (files.type='img'). */
  photoCount: number;
  /** Uploaded video files — heuristic: doc-typed files with a video extension
   *  (the files table has no dedicated 'video' type; only doc/img/folder). */
  videoCount: number;
  /** A post can't reasonably go live with no imagery. */
  mediaReady: boolean;
}

export interface SiteComposerData {
  posts: BlogPost[];
  projects: ComposerProject[];
}

export async function getSiteComposerData(): Promise<SiteComposerData> {
  const [posts, projects] = await Promise.all([getBlogPosts(), getComposerProjects()]);
  return { posts, projects };
}

async function getBlogPosts(): Promise<BlogPost[]> {
  const { rows } = await query<{
    id: number;
    title: string;
    body: string;
    status: "draft" | "posted";
    project_name: string | null;
    project_slug: string | null;
    created_label: string;
  }>(
    `SELECT d.id, d.title, d.body, d.status, p.name AS project_name, p.slug AS project_slug,
            to_char(d.created_at, 'Mon FMDD, YYYY') AS created_label
       FROM marketing_drafts d
       LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.kind = 'blog'
      ORDER BY d.created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    status: r.status,
    projectName: r.project_name,
    projectSlug: r.project_slug,
    createdLabel: r.created_label,
  }));
}

async function getComposerProjects(): Promise<ComposerProject[]> {
  // Completed/closeout projects first (that's what a blog post is written about),
  // each with its uploaded-media counts so the composer can flag "needs photos".
  const { rows } = await query<{
    slug: string;
    name: string;
    photo_count: number;
    video_count: number;
  }>(
    `SELECT p.slug, p.name,
            COALESCE(m.photo_count, 0) AS photo_count,
            COALESCE(m.video_count, 0) AS video_count
       FROM projects p
       LEFT JOIN LATERAL (
         -- Only real uploads count (storage_path NOT NULL) — curated/showcase
         -- rows have no blob and must not satisfy the "needs photos" ask.
         SELECT count(*) FILTER (WHERE f.type = 'img') AS photo_count,
                count(*) FILTER (WHERE f.type = 'doc'
                                   AND f.name ~* '\\.(mp4|mov|webm|m4v|avi)$') AS video_count
           FROM files f
          WHERE f.project_key = p.slug AND f.storage_path IS NOT NULL
       ) m ON true
      ORDER BY (p.status IN ('closeout','warranty')) DESC, p.updated_at DESC`,
  );
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    photoCount: Number(r.photo_count),
    videoCount: Number(r.video_count),
    mediaReady: Number(r.photo_count) > 0,
  }));
}
