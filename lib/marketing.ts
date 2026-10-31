import "server-only";

// Marketing reads (Phase-6 P6-2). The /marketing screen lists AI-drafted social +
// blog posts; the owner edits, copies, and either posts them by hand or picks a
// platform + photos and asks for the posting agent (A17: approve the card, the
// agent puts it up in the browser). Writes stay in lib/actions/marketing.ts.

import { query } from "./db";
import { DRAFT_KIND_LABEL, isPostPlatform, type DraftKind, type PostPlatform } from "./marketing-types";
import { readJournal } from "./publisher/core";
import { postStage, type PostStage, type PostState } from "./publisher/stage";

export type { PostStage };


export interface MarketingDraft {
  id: number;
  kind: DraftKind;
  kindLabel: string;
  title: string;
  body: string;
  status: string;
  projectName: string | null;
  projectSlug: string | null;
  createdLabel: string;
  /** The job's photos; `shareable` = the client OK'd sharing it (publication_rights). */
  photos: { id: string; name: string; shareable: boolean }[];
  /** Where the posting agent puts it (null = not picked). */
  platform: PostPlatform | null;
  /** The photos picked to go with the post, in order. */
  media: string[];
  stage: PostStage;
  /** One line on the stage: why it failed, what to check, what it's doing. */
  stageNote: string | null;
  postedUrl: string | null;
  /** Joe can send it again (it never went up, same approved post). */
  retryable: boolean;
  /** Screenshots from the last posting run (owner route /api/marketing/runs/…). */
  shots: { intentId: string; name: string }[];
  /** The publish_marketing card while it waits (approve it right on the card). */
  pendingDecision: { id: string; contentHash: string | null } | null;
}

export async function getMarketingDrafts(): Promise<MarketingDraft[]> {
  const { rows } = await query<{
    id: number;
    kind: DraftKind;
    title: string;
    body: string;
    status: string;
    project_name: string | null;
    project_slug: string | null;
    project_id: string | null;
    created_label: string;
    audience: string;
    media: string[];
    posted_url: string | null;
    decision_id: string | null;
    decision_hash: string | null;
  } & PostState>(
    `SELECT d.id, d.kind, d.title, d.body, d.status, p.name AS project_name, p.slug AS project_slug, p.id AS project_id,
            to_char(d.created_at, 'Mon FMDD, YYYY') AS created_label, d.audience, d.posted_url, d.post_error,
            COALESCE((SELECT array_agg(m.file_id ORDER BY m.sort) FROM marketing_draft_media m WHERE m.draft_id = d.id), '{}'::text[]) AS media,
            dec.id AS decision_id, dec.content_hash AS decision_hash, dec.status AS decision_status, i.id AS intent_id, i.state AS intent_state, i.last_error AS intent_error, i.hold_reason
       FROM marketing_drafts d
       LEFT JOIN projects p ON p.id = d.project_id
       LEFT JOIN decisions dec ON dec.id = d.publication_decision_id
       LEFT JOIN action_intents i ON i.id = d.publication_intent_id
      ORDER BY d.created_at DESC`,
  );
  // Each job's photos and whether the client OK'd sharing them: Joe posts by
  // hand, so the card gives him the shareable photos to download with the text.
  const slugs = [...new Set(rows.map((r) => r.project_slug).filter((x): x is string => Boolean(x)))];
  const photosBySlug = new Map<string, { id: string; name: string; shareable: boolean }[]>();
  if (slugs.length) {
    const { rows: pics } = await query<{ id: string; name: string; project_key: string; shareable: boolean }>(
      `SELECT f.id, f.name, f.project_key,
              EXISTS (SELECT 1 FROM publication_rights r WHERE r.file_id = f.id AND r.withdrawn_at IS NULL) AS shareable
         FROM files f WHERE f.type = 'img' AND f.storage_path IS NOT NULL AND f.project_key = ANY($1::text[])
        ORDER BY f.created_at DESC`,
      [slugs],
    );
    for (const p of pics) {
      const list = photosBySlug.get(p.project_key) ?? [];
      if (list.length < 24) list.push({ id: p.id, name: p.name, shareable: p.shareable });
      photosBySlug.set(p.project_key, list);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    kindLabel: DRAFT_KIND_LABEL[r.kind] ?? "Post",
    title: r.title,
    body: r.body,
    status: r.status,
    projectName: r.project_name,
    projectSlug: r.project_slug,
    createdLabel: r.created_label,
    photos: r.project_slug ? (photosBySlug.get(r.project_slug) ?? []) : [],
    platform: isPostPlatform(r.audience) ? r.audience : null,
    media: r.media ?? [],
    ...stageOf(r),
    postedUrl: r.posted_url,
    pendingDecision: r.status === "pending_decision" && r.decision_status === "pending" && r.decision_id ? { id: r.decision_id, contentHash: r.decision_hash } : null,
  }));
}

function stageOf(r: PostState) {
  const { stage, note } = postStage(r);
  const journal = r.intent_id ? readJournal(r.intent_id) : null;
  return {
    stage,
    stageNote: stage === "posting" && journal ? `Working: ${journal.step}` : note,
    retryable: stage === "failed" && (r.intent_state === "permanent_failure" || r.intent_state === "cancelled") && (r.decision_status === "approved" || r.decision_status === "consumed"),
    shots: journal && r.intent_id ? journal.shots.map((name) => ({ intentId: r.intent_id!, name })) : [],
  };
}

/** Projects the owner can draft a post about (for the /marketing picker). */
export async function getMarketingProjectOptions(): Promise<{ slug: string; name: string }[]> {
  const { rows } = await query<{ slug: string; name: string }>(
    `SELECT slug, name FROM projects ORDER BY (status IN ('closeout','warranty')) DESC, updated_at DESC`,
  );
  return rows;
}
