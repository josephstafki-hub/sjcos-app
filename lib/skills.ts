import "server-only";

// Open Skills read layer: the skills library + runbooks. Approved skills are the
// live library; proposed skills wait for Joe's review. Writes live in
// lib/actions/skills.ts.

import { query } from "./db";
import type { SkillReviewStatus } from "./types";

export interface SkillView {
  slug: string;
  title: string;
  description: string;
  category: string;
  whenToUse: string;
  reviewStatus: SkillReviewStatus;
  active: boolean;
  proposedBy: string;
  triggerPhrases: string[];
  /** Current version body markdown (proposed or approved), if any. */
  body: string;
  version: number | null;
  changeSummary: string;
  createdAt: string;
}

export interface RunbookStepView {
  stepOrder: number;
  title: string;
  skillSlug: string | null;
  expectedOutput: string;
  requiresHumanApproval: boolean;
}

export interface RunbookView {
  slug: string;
  title: string;
  description: string;
  active: boolean;
  steps: RunbookStepView[];
}

export interface SkillsLibrary {
  approved: SkillView[];
  proposed: SkillView[];
  runbooks: RunbookView[];
}

interface SkillRow {
  slug: string;
  title: string;
  description: string;
  category: string;
  when_to_use: string;
  review_status: SkillReviewStatus;
  active: boolean;
  proposed_by: string;
  trigger_phrases: string[];
  body: string | null;
  version: number | null;
  change_summary: string | null;
  created_at: string;
}

function rowToSkill(r: SkillRow): SkillView {
  return {
    slug: r.slug,
    title: r.title,
    description: r.description,
    category: r.category,
    whenToUse: r.when_to_use,
    reviewStatus: r.review_status,
    active: r.active,
    proposedBy: r.proposed_by,
    triggerPhrases: r.trigger_phrases ?? [],
    body: r.body ?? "",
    version: r.version,
    changeSummary: r.change_summary ?? "",
    createdAt: r.created_at,
  };
}

export async function getSkillsLibrary(): Promise<SkillsLibrary> {
  const [{ rows: skills }, { rows: runbooks }, { rows: steps }] = await Promise.all([
    query<SkillRow>(
      `SELECT s.slug, s.title, s.description, s.category, s.when_to_use, s.review_status,
              s.active, s.proposed_by, s.trigger_phrases, s.created_at,
              v.body_markdown AS body, v.version, v.change_summary
         FROM skills s
         LEFT JOIN skill_versions v ON v.id = s.current_version_id
        ORDER BY s.category, s.title`,
    ),
    query<{ id: string; slug: string; title: string; description: string; active: boolean }>(
      `SELECT id, slug, title, description, active FROM runbooks ORDER BY title`,
    ),
    query<{
      runbook_id: string; step_order: number; title: string; skill_slug: string | null;
      expected_output: string; requires_human_approval: boolean;
    }>(
      `SELECT runbook_id, step_order, title, skill_slug, expected_output, requires_human_approval
         FROM runbook_steps ORDER BY runbook_id, step_order`,
    ),
  ]);

  const stepsByRunbook = new Map<string, RunbookStepView[]>();
  for (const s of steps) {
    const arr = stepsByRunbook.get(s.runbook_id) ?? [];
    arr.push({
      stepOrder: s.step_order,
      title: s.title,
      skillSlug: s.skill_slug,
      expectedOutput: s.expected_output,
      requiresHumanApproval: s.requires_human_approval,
    });
    stepsByRunbook.set(s.runbook_id, arr);
  }

  const all = skills.map(rowToSkill);
  return {
    approved: all.filter((s) => s.reviewStatus === "approved"),
    proposed: all.filter((s) => s.reviewStatus === "proposed"),
    runbooks: runbooks.map((r) => ({
      slug: r.slug,
      title: r.title,
      description: r.description,
      active: r.active,
      steps: stepsByRunbook.get(r.id) ?? [],
    })),
  };
}
