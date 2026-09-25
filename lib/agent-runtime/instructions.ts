// Versioned operating instructions + scoped context (A24) — typed entry point.
//
// The loader itself lives in instructions-block.mjs (plain JS) so the
// detached runners and the MCP server import the identical code; this module
// adds types and `buildBusinessInstructions()`, which is what the background
// worker (worker.ts), the Ask-window runner (scripts/run-claude-agent.mjs,
// business profile) and the MCP get_operating_context tool all call.
//
// Pure over run(sql, params): no server-only import.

import type { Run } from "../commands/core.ts";
import { assembleScopedContext, type ContextScope, type ScopedContext } from "./context.ts";
import {
  activateInstructionVersion as activateJs,
  checksumOf,
  INSTRUCTION_KEYS,
  listInstructionVersions as listJs,
  loadActiveInstructionBlocks as loadJs,
  policyDigest as policyJs,
  proposeInstructionVersion as proposeJs,
  rollbackInstructionVersion as rollbackJs,
  standingContextBlock as standingJs,
  standingInstructions as standingInstructionsJs,
  toolListChecksum,
} from "./instructions-block.mjs";

export { checksumOf, INSTRUCTION_KEYS, toolListChecksum };

export type InstructionKey = "operating_block" | "workflow_digest" | "policy_digest" | "tone_guide";

export interface InstructionBlock {
  key: InstructionKey;
  version: number;
  checksum: string;
  body: string;
  /** 'db' = loaded from agent_instruction_versions; 'builtin' = fallback seed text (table/row missing). */
  source: "db" | "builtin";
  state: "active";
  activated_at?: string | null;
  missing?: string;
}

export interface LoadedVersions {
  operating_block: { version: number; checksum: string; source: "db" | "builtin"; missing?: string };
  workflow_digest: { version: number; checksum: string; source: "db" | "builtin"; missing?: string };
  tone_guide: { version: number; checksum: string; source: "db" | "builtin"; missing?: string };
  policy_digest: { checksum: string; refs: string[] };
  standing_instructions: { count: number };
}

export interface StandingBlock {
  text: string;
  versions: LoadedVersions;
  blocks: Record<"operating_block" | "workflow_digest" | "tone_guide", InstructionBlock>;
  policy: { text: string; checksum: string; refs: string[] };
  standing: { text: string; count: number };
}

export interface BusinessInstructions extends StandingBlock {
  context: ScopedContext;
  /** The full prompt prefix: instruction block + scoped context. */
  prompt: string;
}

export interface InstructionVersionRow {
  id: string;
  key: InstructionKey;
  version: number;
  checksum: string;
  state: "draft" | "active" | "retired";
  activated_by: string | null;
  activated_at: string | null;
  retired_at: string | null;
  notes: string;
  created_by: string;
  created_at: string;
}

/** ACTIVE instruction rows (or the labelled built-in fallback). */
export function loadActiveInstructionBlocks(run: Run): Promise<StandingBlock["blocks"]> {
  return loadJs(run) as Promise<StandingBlock["blocks"]>;
}

export function policyDigest(run: Run): Promise<{ text: string; checksum: string; refs: string[] }> {
  return policyJs(run);
}

export function standingInstructions(run: Run): Promise<{ text: string; count: number }> {
  return standingInstructionsJs(run);
}

/**
 * The shared instruction block for EVERY entry point (worker, Ask-window
 * business profile, hermesChat, MCP). `pageContext` = the route the panel
 * user is viewing, if any.
 */
export function standingContextBlock(run: Run, pageContext?: string | null): Promise<StandingBlock> {
  return standingJs(run, pageContext ?? undefined) as Promise<StandingBlock>;
}

/**
 * Instruction block + scoped context for one run. `scope` names the project /
 * lead / trigger / principal; every table read is guarded and capped
 * (context.ts). The returned `versions` must be recorded on the execution.
 */
export async function buildBusinessInstructions(run: Run, scope: ContextScope, pageContext?: string | null): Promise<BusinessInstructions> {
  const standing = await standingContextBlock(run, pageContext);
  const context = await assembleScopedContext(run, scope);
  const prompt = `${standing.text}\n\n=== SCOPED PROJECT CONTEXT (current records; fetch more on demand) ===\n${context.text}`;
  return { ...standing, context, prompt };
}

/** The closing instruction every unattended run gets, so the runner can
 *  parse a durable summary. The narrative never counts as proof; the records
 *  and tool trace do. */
export const RUN_SUMMARY_FORMAT =
  `When you are finished, end your reply with exactly these four lines (plain text, one each):\n` +
  `RESULT: <one sentence on what you completed and verified through tools>\n` +
  `RECORDS: <comma-separated ids/slugs of records you created or changed, or "none">\n` +
  `BLOCKED: <the exact authority or information boundary you stopped at, or "none">\n` +
  `NEXT_TRIGGER: <what event should wake the next run (e.g. "owner approves decision <id>", "client replies about the niche"), or "none">`;

export interface ParsedRunSummary {
  result: string | null;
  records: string | null;
  blocked: string | null;
  nextTrigger: string | null;
}

export function parseRunSummary(text: string | null | undefined): ParsedRunSummary {
  const t = String(text ?? "");
  const grab = (label: string) => {
    const m = new RegExp(`^${label}:\\s*(.*)$`, "mi").exec(t);
    const v = m?.[1]?.trim() ?? null;
    return v && v.toLowerCase() !== "none" ? v : v === null ? null : "none";
  };
  return { result: grab("RESULT"), records: grab("RECORDS"), blocked: grab("BLOCKED"), nextTrigger: grab("NEXT_TRIGGER") };
}

// ── Change management (owner actions) ───────────────────────────────────────

export function proposeInstructionVersion(run: Run, key: InstructionKey, body: string, createdBy: string, notes = ""): Promise<Pick<InstructionVersionRow, "id" | "key" | "version" | "checksum" | "state">> {
  return proposeJs(run, key, body, createdBy, notes);
}

export function activateInstructionVersion(run: Run, key: InstructionKey, version: number, activatedBy: string): Promise<Pick<InstructionVersionRow, "id" | "key" | "version" | "checksum" | "state" | "activated_at"> & { previous_version: number | null }> {
  return activateJs(run, key, version, activatedBy);
}

export function rollbackInstructionVersion(run: Run, key: InstructionKey, by: string): Promise<(Pick<InstructionVersionRow, "id" | "key" | "version" | "checksum" | "state" | "activated_at"> & { previous_version: number | null }) | null> {
  return rollbackJs(run, key, by);
}

export function listInstructionVersions(run: Run, key?: InstructionKey): Promise<InstructionVersionRow[]> {
  return listJs(run, key) as Promise<InstructionVersionRow[]>;
}
