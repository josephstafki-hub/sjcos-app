// Skill versioning as immutable procedures (A24).
//
//   snapshotSkillVersion(run, slug, body, { createdBy, changeSummary, status })
//     A new body = a NEW skill_versions row (next version, default status
//     'proposed'); an identical body (same checksum as the latest version) is a
//     no-op. Existing rows are never edited. Does NOT move skills.current_version_id.
//   activateSkillVersion(run, slug, version, by)
//     Marks the version approved + activated, points current_version_id at it,
//     retires the previously current version (kept), approves the skill.
//     Owner action (lib/actions/skills.ts wraps it with requireAccess).
//   registerOperatingAgentSkill(run, by)
//     The `workflow-operating-agent` skill whose body is the ACTIVE operating
//     block. Lands 'proposed' / inactive — Joe approves in /engine. Idempotent.
//
// Pure over run(sql, params).

import type { Run } from "../commands/core.ts";
import { checksumOf } from "./instruction-texts.mjs";
import { loadActiveInstructionBlocks } from "./instructions.ts";

export interface SkillVersionRow {
  id: string;
  skill_id: string;
  version: number;
  body_markdown: string;
  change_summary: string;
  status: "draft" | "proposed" | "approved" | "rejected";
  created_by: string;
  checksum: string | null;
  activated_at: string | null;
  activated_by: string | null;
  retired_at: string | null;
  created_at: string;
}

const VCOLS = `id, skill_id, version, body_markdown, change_summary, status, created_by, checksum, activated_at::text AS activated_at, activated_by, retired_at::text AS retired_at, created_at::text AS created_at`;

export const OPERATING_AGENT_SKILL_SLUG = "workflow-operating-agent";

export async function snapshotSkillVersion(
  run: Run,
  slug: string,
  body: string,
  opts: { createdBy: string; changeSummary?: string; status?: "draft" | "proposed" | "approved" } = { createdBy: "system" },
): Promise<{ created: boolean; version: SkillVersionRow }> {
  const [skill] = await run<{ id: string }>(`SELECT id FROM skills WHERE slug = $1 FOR UPDATE`, [slug]);
  if (!skill) throw new Error(`no skill ${slug}`);
  const text = String(body);
  if (!text.trim()) throw new Error("empty skill body");
  const sum = checksumOf(text);
  const [latest] = await run<SkillVersionRow>(`SELECT ${VCOLS} FROM skill_versions WHERE skill_id = $1 ORDER BY version DESC LIMIT 1`, [skill.id]);
  if (latest && (latest.checksum ?? checksumOf(latest.body_markdown)) === sum) return { created: false, version: latest };
  const [row] = await run<SkillVersionRow>(
    `INSERT INTO skill_versions (skill_id, version, body_markdown, change_summary, status, created_by, checksum)
     VALUES ($1, COALESCE((SELECT max(version) FROM skill_versions WHERE skill_id = $1), 0) + 1, $2, $3, $4, $5, $6)
     RETURNING ${VCOLS}`,
    [skill.id, text, opts.changeSummary ?? "", opts.status ?? "proposed", opts.createdBy, sum],
  );
  return { created: true, version: row };
}

export async function activateSkillVersion(run: Run, slug: string, version: number, by: string): Promise<SkillVersionRow> {
  const [skill] = await run<{ id: string; current_version_id: string | null }>(`SELECT id, current_version_id FROM skills WHERE slug = $1 FOR UPDATE`, [slug]);
  if (!skill) throw new Error(`no skill ${slug}`);
  const [target] = await run<{ id: string }>(`SELECT id FROM skill_versions WHERE skill_id = $1 AND version = $2`, [skill.id, version]);
  if (!target) throw new Error(`no ${slug} version ${version}`);
  if (skill.current_version_id && skill.current_version_id !== target.id) {
    await run(`UPDATE skill_versions SET retired_at = now() WHERE id = $1 AND retired_at IS NULL`, [skill.current_version_id]);
  }
  const [row] = await run<SkillVersionRow>(
    `UPDATE skill_versions SET status = 'approved', activated_at = now(), activated_by = $2, retired_at = NULL WHERE id = $1 RETURNING ${VCOLS}`,
    [target.id, by],
  );
  await run(`UPDATE skills SET current_version_id = $2, review_status = 'approved', active = true, updated_at = now() WHERE id = $1`, [skill.id, target.id]);
  return row;
}

export async function listSkillVersions(run: Run, slug: string): Promise<SkillVersionRow[]> {
  return run<SkillVersionRow>(`SELECT ${VCOLS} FROM skill_versions v WHERE v.skill_id = (SELECT id FROM skills WHERE slug = $1) ORDER BY version DESC`, [slug]);
}

/** Skill versions an execution followed (for agent_executions.skill_versions). */
export async function currentSkillVersionRefs(run: Run, slugs: string[]): Promise<{ slug: string; version: number; checksum: string | null }[]> {
  if (!slugs.length) return [];
  return run<{ slug: string; version: number; checksum: string | null }>(
    `SELECT s.slug, v.version, v.checksum FROM skills s JOIN skill_versions v ON v.id = s.current_version_id WHERE s.slug = ANY($1::text[])`,
    [slugs],
  );
}

/**
 * Register the operating-agent skill (proposed, inactive) whose body is the
 * ACTIVE operating block. Re-running after a new operating_block version is
 * activated snapshots a new proposed skill version with the new body.
 */
export async function registerOperatingAgentSkill(run: Run, by = "ws-agents"): Promise<{ created: boolean; skill: { slug: string; review_status: string; active: boolean }; version: SkillVersionRow }> {
  const blocks = await loadActiveInstructionBlocks(run);
  // The skill body IS the active operating block, byte for byte, so its
  // checksum equals the instruction version's and /engine shows exactly what
  // agents load (the version pointer rides in change_summary).
  const body = blocks.operating_block.body;
  const [existing] = await run<{ id: string; review_status: string; active: boolean }>(`SELECT id, review_status, active FROM skills WHERE slug = $1 FOR UPDATE`, [OPERATING_AGENT_SKILL_SLUG]);
  let created = false;
  if (!existing) {
    await run(
      `INSERT INTO skills (slug, title, description, category, when_to_use, trigger_phrases, review_status, proposed_by, active, approval_rules, verification_requirements)
       VALUES ($1, 'Workflow operating agent', 'The operating instruction block for event-driven business agent runs (A24). Body = the active operating_block version.', 'operations',
               'On every signature / message / note / quote / selection / payment / field report / approval / sign-off event, and when working the queue proactively.',
               ARRAY['operating agent','event loop','next permitted action','workflow agent'], 'proposed', $2, false,
               'Client-, vendor- and money-facing actions consume an exact owner decision or grant; automatic actions cite an active policy; nothing else sends.',
               'agent_executions row with instruction versions, tool trace, records touched, blocked reason and next trigger; record_agent_run + receipts.')`,
      [OPERATING_AGENT_SKILL_SLUG, by],
    );
    created = true;
  }
  const snap = await snapshotSkillVersion(run, OPERATING_AGENT_SKILL_SLUG, body, { createdBy: by, changeSummary: `operating_block@${blocks.operating_block.version} (${blocks.operating_block.checksum.slice(0, 12)})`, status: "proposed" });
  // A proposed skill with no current version points at its latest proposal so
  // /engine renders a body; approval (activateSkillVersion / approveSkill) is Joe's.
  await run(`UPDATE skills SET current_version_id = COALESCE(current_version_id, $2) WHERE slug = $1`, [OPERATING_AGENT_SKILL_SLUG, snap.version.id]);
  const [skill] = await run<{ slug: string; review_status: string; active: boolean }>(`SELECT slug, review_status, active FROM skills WHERE slug = $1`, [OPERATING_AGENT_SKILL_SLUG]);
  return { created: created || snap.created, skill, version: snap.version };
}
