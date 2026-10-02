// Versioned instruction-block loader (A24). Plain JS, no server-only, no
// app imports: the detached runners (scripts/run-claude-agent.mjs,
// scripts/run-business-agent.mjs), the MCP server, lib/dev-agents.ts
// (hermesChat) and node --test all call the SAME functions, so the panel and
// the background worker provably load identical instruction versions (V46).
//
// Every function takes `run(sql, params) → rows` (a pg client/pool/tx
// wrapper). Nothing here throws on a missing table: a runtime that predates
// migration 0021 gets the built-in v1 texts, clearly labelled source
// 'builtin' so STATUS/evidence can never mistake them for loaded rows.
//
//   loadActiveInstructionBlocks(run)  → { operating_block, workflow_digest, tone_guide }
//   policyDigest(run)                 → { text, checksum, refs }  (from `policies`, generated each run)
//   standingInstructions(run)         → Joe-approved agent_memories block (same query as get_standing_instructions)
//   standingContextBlock(run, page?)  → { text, versions }  the shared block every entry point prepends
//   toolListChecksum(names)           → sha256 of the sorted tool-name list
//   proposeInstructionVersion / activateInstructionVersion / retireActiveVersion

import { INSTRUCTION_KEYS, SEED_VERSIONS, checksumOf } from "./instruction-texts.mjs";
import { createHash } from "node:crypto";

export { checksumOf, INSTRUCTION_KEYS };

const LOADED_KEYS = ["operating_block", "workflow_digest", "tone_guide"];
const STANDING_CAP_CHARS = 2000;
const STANDING_CAP_ROWS = 10;

function builtin(key) {
  const s = SEED_VERSIONS.find((v) => v.key === key);
  return { key, version: s.version, checksum: checksumOf(s.body), body: s.body, source: "builtin", state: "active" };
}

/** ACTIVE rows of agent_instruction_versions keyed by instruction key. Falls
 *  back to the built-in seed text (source 'builtin') per missing key. */
export async function loadActiveInstructionBlocks(run) {
  let rows = [];
  let tableMissing = false;
  try {
    rows = await run(
      `SELECT key, version, body, checksum, activated_at::text AS activated_at
         FROM agent_instruction_versions WHERE state = 'active' AND key = ANY($1::text[])`,
      [LOADED_KEYS],
    );
  } catch {
    tableMissing = true;
  }
  const out = {};
  for (const key of LOADED_KEYS) {
    const r = rows.find((x) => x.key === key);
    out[key] = r
      ? { key, version: Number(r.version), checksum: r.checksum, body: r.body, source: "db", state: "active", activated_at: r.activated_at }
      : { ...builtin(key), missing: tableMissing ? "table agent_instruction_versions missing" : "no active row" };
  }
  return out;
}

/** The policy digest is generated from `policies` on every assembly so an
 *  agent always cites the currently active version. Draft versions are listed
 *  as "proposed, not active" so the model never mistakes a proposal for a rule. */
export async function policyDigest(run) {
  let rows = [];
  let note = "";
  try {
    rows = await run(
      `SELECT key, version, state, config, notes FROM policies
        WHERE state IN ('active','draft','disabled') ORDER BY key, version DESC`,
    );
  } catch {
    note = "policies table unavailable";
  }
  const active = rows.filter((r) => r.state === "active");
  const drafts = rows.filter((r) => r.state !== "active");
  const lines = ["POLICY DIGEST (policy_digest; generated from the policies table at run start)"];
  if (note) lines.push(`- ${note}: no automatic action has a policy to cite; hold every automatic action.`);
  if (!active.length && !note) lines.push("- No policy is ACTIVE. Automatic client-facing actions (routine follow-up, weekly summary, automatic invoices, post-project follow-through, cost learning) have no auth_ref and must be HELD: stage the work and record the missing policy as the blocked reason.");
  for (const p of active) {
    lines.push(`- ACTIVE policy:${p.key}@${p.version} — ${summarizePolicy(p)}`);
  }
  const seenDraft = new Set();
  for (const p of drafts) {
    if (seenDraft.has(p.key) || active.some((a) => a.key === p.key)) continue;
    seenDraft.add(p.key);
    lines.push(`- ${p.state === "draft" ? "PROPOSED, NOT ACTIVE" : "DISABLED"}: ${p.key}@${p.version} — do not act under it.`);
  }
  let pauses = [];
  try {
    pauses = await run(`SELECT lane, reason FROM lane_pauses ORDER BY lane`);
  } catch {
    /* table missing: no pauses known */
  }
  if (pauses.length) lines.push(`- LANES PAUSED by owner: ${pauses.map((p) => `${p.lane}${p.reason ? ` (${p.reason})` : ""}`).join("; ")}. Nothing dispatches on a paused lane.`);
  const text = lines.join("\n");
  return { text, checksum: checksumOf(text), refs: active.map((p) => `policy:${p.key}@${p.version}`) };
}

function summarizePolicy(p) {
  const cfg = p.config && typeof p.config === "object" ? p.config : {};
  const bits = [];
  if (cfg.lane) bits.push(`lane ${cfg.lane}`);
  if (cfg.window) bits.push(`window ${JSON.stringify(cfg.window)}`);
  if (cfg.cadence) bits.push(`cadence ${JSON.stringify(cfg.cadence)}`);
  if (Array.isArray(cfg.stop) && cfg.stop.length) bits.push(`stops on ${cfg.stop.join(", ")}`);
  if (cfg.scope) bits.push(String(cfg.scope));
  const s = bits.join("; ") || String(p.notes || "").slice(0, 240);
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
}

/** Joe-approved standing instructions (agent_memories) — identical query to
 *  the MCP get_standing_instructions tool and lib/agent-memory.ts. */
export async function standingInstructions(run) {
  let rows = [];
  try {
    rows = await run(
      `SELECT summary, content FROM agent_memories
        WHERE review_status = 'approved' AND can_use_as_instruction = true
          AND (stale_after IS NULL OR stale_after > now())
        ORDER BY confidence DESC NULLS LAST, updated_at DESC
        LIMIT ${STANDING_CAP_ROWS}`,
    );
  } catch {
    return { text: "", count: 0 };
  }
  if (!rows.length) return { text: "", count: 0 };
  const header = "STANDING INSTRUCTIONS (Joe-approved) — honor every entry:";
  const lines = [header];
  let length = header.length;
  for (const r of rows) {
    const line = `- ${r.summary ? `${r.summary}: ` : ""}${String(r.content).replace(/\s+/g, " ").trim()}`;
    if (length + line.length + 1 > STANDING_CAP_CHARS) break;
    lines.push(line);
    length += line.length + 1;
  }
  return { text: lines.length > 1 ? lines.join("\n") : "", count: lines.length - 1 };
}

/** sha256 over the sorted, de-duplicated tool-name list (the MCP tool surface
 *  the run actually had). Same input → same checksum on every entry point. */
export function toolListChecksum(names) {
  const list = Array.from(new Set((names ?? []).map((n) => String(n)))).sort();
  return createHash("sha256").update(list.join("\n"), "utf8").digest("hex");
}

/**
 * The shared instruction block. BOTH the background worker
 * (lib/agent-runtime/worker.ts) and the panel paths (scripts/run-claude-agent.mjs
 * business profile, lib/dev-agents.ts hermesChat) prepend exactly this text and
 * record `versions` on their run row. `pageContext` is the route the user is
 * viewing (panel only).
 */
export async function standingContextBlock(run, pageContext) {
  const blocks = await loadActiveInstructionBlocks(run);
  const policy = await policyDigest(run);
  const standing = await standingInstructions(run);
  const versions = {};
  for (const key of LOADED_KEYS) {
    const b = blocks[key];
    versions[key] = { version: b.version, checksum: b.checksum, source: b.source, ...(b.missing ? { missing: b.missing } : {}) };
  }
  versions.policy_digest = { checksum: policy.checksum, refs: policy.refs };
  versions.standing_instructions = { count: standing.count };
  const header =
    `SJC OS OPERATING CONTEXT — instruction versions: ` +
    LOADED_KEYS.map((k) => `${k}@${versions[k].version}#${versions[k].checksum.slice(0, 12)}${versions[k].source === "builtin" ? "(builtin)" : ""}`).join(", ") +
    `, policy_digest#${policy.checksum.slice(0, 12)}`;
  const parts = [header, blocks.operating_block.body, blocks.workflow_digest.body, policy.text, blocks.tone_guide.body];
  if (standing.text) parts.push(standing.text);
  if (pageContext) parts.push(`PAGE CONTEXT: the user is viewing route ${pageContext}.`);
  return { text: parts.join("\n\n"), versions, blocks, policy, standing };
}

// ── Change management ────────────────────────────────────────────────────────

/** Insert the next version for a key as DRAFT. Nothing goes live by writing. */
export async function proposeInstructionVersion(run, key, body, createdBy, notes = "") {
  if (!INSTRUCTION_KEYS.includes(key)) throw new Error(`unknown instruction key: ${key}`);
  const text = String(body);
  if (!text.trim()) throw new Error("empty instruction body");
  const [row] = await run(
    `INSERT INTO agent_instruction_versions (key, version, body, checksum, state, created_by, notes)
     VALUES ($1, COALESCE((SELECT max(version) FROM agent_instruction_versions WHERE key = $1), 0) + 1, $2, $3, 'draft', $4, $5)
     RETURNING id, key, version, checksum, state`,
    [key, text, checksumOf(text), createdBy, notes],
  );
  return row;
}

/** Make one version ACTIVE; the previously active version is RETIRED (kept
 *  forever — rollback = activate it again). Returns the activated row. */
export async function activateInstructionVersion(run, key, version, activatedBy) {
  const [target] = await run(`SELECT id, state FROM agent_instruction_versions WHERE key = $1 AND version = $2 FOR UPDATE`, [key, version]);
  if (!target) throw new Error(`no ${key} version ${version}`);
  const previous = await run(
    `UPDATE agent_instruction_versions SET state = 'retired', retired_at = now()
      WHERE key = $1 AND state = 'active' AND version <> $2 RETURNING version`,
    [key, version],
  );
  const [row] = await run(
    `UPDATE agent_instruction_versions
        SET state = 'active', activated_by = $3, activated_at = now(), retired_at = NULL
      WHERE key = $1 AND version = $2
      RETURNING id, key, version, checksum, state, activated_at::text AS activated_at`,
    [key, version, activatedBy],
  );
  return { ...row, previous_version: previous[0]?.version ?? null };
}

/** Retire the active version and re-activate the most recent retired one
 *  (the rollback path). Returns what is active afterwards, or null when no
 *  earlier version exists (the current one stays active — nothing goes blank). */
export async function rollbackInstructionVersion(run, key, by) {
  const [current] = await run(`SELECT version FROM agent_instruction_versions WHERE key = $1 AND state = 'active' FOR UPDATE`, [key]);
  if (!current) return null;
  const [prev] = await run(
    `SELECT version FROM agent_instruction_versions WHERE key = $1 AND state = 'retired' AND version <> $2 ORDER BY version DESC LIMIT 1`,
    [key, current.version],
  );
  if (!prev) return null;
  return activateInstructionVersion(run, key, Number(prev.version), by);
}

export async function listInstructionVersions(run, key) {
  return run(
    `SELECT id, key, version, checksum, state, activated_by, activated_at::text AS activated_at, retired_at::text AS retired_at, notes, created_by, created_at::text AS created_at
       FROM agent_instruction_versions ${key ? "WHERE key = $1" : ""} ORDER BY key, version DESC`,
    key ? [key] : [],
  );
}
