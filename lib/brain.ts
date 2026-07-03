import "server-only";

// Open Brain read layer: search + recent knowledge items. Writes live in
// lib/actions/brain.ts.

import { query } from "./db";
import type { KnowledgeKind } from "./types";

export interface KnowledgeItemView {
  id: string;
  content: string;
  kind: KnowledgeKind;
  source: string;
  sourceUri: string | null;
  projectSlug: string | null;
  leadSlug: string | null;
  createdBy: string;
  createdAt: string;
}

interface KnowledgeRow {
  id: string;
  content: string;
  kind: string;
  source: string;
  source_uri: string | null;
  project_slug: string | null;
  lead_slug: string | null;
  created_by: string;
  created_at: string;
}

const SELECT = `
  SELECT k.id, k.content, k.kind, k.source, k.source_uri,
         p.slug AS project_slug, l.slug AS lead_slug, k.created_by, k.created_at
    FROM knowledge_items k
    LEFT JOIN projects p ON p.id = k.project_id
    LEFT JOIN leads l ON l.id = k.lead_id`;

function rowToItem(r: KnowledgeRow): KnowledgeItemView {
  return {
    id: r.id,
    content: r.content,
    kind: r.kind,
    source: r.source,
    sourceUri: r.source_uri,
    projectSlug: r.project_slug,
    leadSlug: r.lead_slug,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

/** Most recent knowledge items (default 40). */
export async function getRecentKnowledge(limit = 40): Promise<KnowledgeItemView[]> {
  const { rows } = await query<KnowledgeRow>(
    `${SELECT} ORDER BY k.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(rowToItem);
}

/** Full-text (tsv) + fuzzy (ILIKE) search, ranked. Empty query → recent. */
export async function searchKnowledge(q: string, limit = 40): Promise<KnowledgeItemView[]> {
  const term = q.trim();
  if (!term) return getRecentKnowledge(limit);
  const { rows } = await query<KnowledgeRow>(
    `${SELECT}
      WHERE k.search_tsv @@ websearch_to_tsquery('english', $1) OR k.content ILIKE '%' || $1 || '%'
      ORDER BY ts_rank(k.search_tsv, websearch_to_tsquery('english', $1)) DESC, k.created_at DESC
      LIMIT $2`,
    [term, limit],
  );
  return rows.map(rowToItem);
}

export async function getKnowledgeCount(): Promise<number> {
  const { rows } = await query<{ n: string }>(`SELECT count(*) AS n FROM knowledge_items`);
  return Number(rows[0]?.n ?? 0);
}
