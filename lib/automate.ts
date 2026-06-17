// SJC OS — headless Claude Code automation builder.
//
// This module shells out to the LOCAL `claude` CLI (not the raw API) to turn a
// plain-text instruction into a concrete automation — a markdown file, a cron
// entry, a small script. The CLI binary lives on this box; the model it talks
// to does not, so every call here crosses the network and costs money.
//
// SAFETY MODEL — this is a two-phase "propose → confirm → execute" flow:
//   1. propose()  runs Claude in PLAN mode with NO write/exec tools. It can
//                 only read inside the automations dir and must return a
//                 structured JSON plan. Nothing on disk changes.
//   2. execute()  runs ONLY after a human approves the plan (gated in the
//                 server action). It allows a tight tool whitelist confined to
//                 AUTOMATIONS_DIR via --add-dir, and re-states the approved
//                 plan so Claude carries out exactly that.
//
// Hard guarantees enforced here, independent of what the model decides:
//   • argv is passed as an array (execFile, never a shell string) → no prompt
//     can inject a shell command into OUR invocation.
//   • tool access is whitelisted AND directory-confined; other tenants on this
//     shared box (siteme, studfolio, …) are never reachable.
//   • a wall-clock timeout bounds every call.
//   • plans are validated (paths in-dir, cron expr legal) before execute().
//
// IMPORTANT: server-only. Never import this from a "use client" component — it
// pulls in node:child_process and will break the client bundle.

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

// ─── Configuration ──────────────────────────────────────────────────────────

/** Absolute path to the claude binary (verified: ~/.local/bin/claude). */
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`;

/**
 * The ONLY directory automations may touch. Everything Claude writes is
 * confined here via --add-dir, and validatePlan() rejects any path outside it.
 */
export const AUTOMATIONS_DIR =
  process.env.AUTOMATE_DIR ?? path.join(process.cwd(), "automations");

/**
 * Model for these calls. Defaults to sonnet — the planning/file-writing work
 * does not need Opus, and sonnet is far cheaper per call. (The trivial test
 * call on Opus cost ~$0.10 mostly in system-prompt cache creation.)
 */
const MODEL = process.env.AUTOMATE_MODEL ?? "sonnet";

/** Per-call wall-clock ceiling. */
const TIMEOUT_MS = 120_000;

// ─── Types ────────────────────────────────────────────────────────────────

export type StepType = "write_file" | "cron" | "shell";

export interface AutomationStep {
  type: StepType;
  /** One-line human-readable description of what this step does. */
  description: string;
  /** write_file: target path (must resolve inside AUTOMATIONS_DIR). */
  path?: string;
  /** write_file: first ~40 lines of intended content, for the confirm UI. */
  contentPreview?: string;
  /** cron: 5-field crontab schedule, e.g. "0 8 * * 1". */
  schedule?: string;
  /** cron/shell: the command to run. */
  command?: string;
}

export interface AutomationPlan {
  title: string;
  summary: string;
  steps: AutomationStep[];
  /** Model's own risk read; "high" forces a second confirm in the UI. */
  risk: "low" | "medium" | "high";
}

/** Normalized result of a CLI call. */
interface ClaudeRun {
  text: string;
  costUsd: number;
  sessionId: string;
  denials: unknown[];
}

export interface ExecuteResult {
  ok: boolean;
  output: string;
  costUsd: number;
  denials: unknown[];
  /** Cron lines staged to automations/crontab.proposed, NOT yet installed. */
  stagedCron: string[];
}

export interface InstallResult {
  installed: string[];
  /** Lines already present in the crontab, left untouched (idempotent). */
  skipped: string[];
}

// ─── CLI wrapper ────────────────────────────────────────────────────────────

/**
 * Invoke headless `claude -p` and return the parsed result envelope.
 * `extraArgs` carries the per-phase tool/permission scoping.
 */
async function runClaude(prompt: string, extraArgs: string[]): Promise<ClaudeRun> {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--model",
    MODEL,
    ...extraArgs,
  ];

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(CLAUDE_BIN, args, {
      cwd: AUTOMATIONS_DIR,
      timeout: TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      // Inherit env (auth via the user's logged-in CLI). For a deployed app,
      // prefer setting ANTHROPIC_API_KEY here and adding --bare for lower
      // overhead — note --bare ignores OAuth/keychain and REQUIRES a key.
      env: process.env,
    }));
  } catch (err) {
    const e = err as { killed?: boolean; stdout?: string; message?: string };
    if (e.killed) throw new Error(`automation timed out after ${TIMEOUT_MS}ms`);
    // Non-zero exit still often carries a JSON envelope on stdout.
    if (e.stdout) stdout = e.stdout;
    else throw new Error(`claude CLI failed: ${e.message}`);
  }

  const env = JSON.parse(stdout) as {
    is_error: boolean;
    result: string;
    total_cost_usd: number;
    session_id: string;
    permission_denials: unknown[];
    subtype?: string;
  };

  if (env.is_error) {
    throw new Error(`claude returned an error result (${env.subtype ?? "unknown"})`);
  }

  return {
    text: env.result,
    costUsd: env.total_cost_usd ?? 0,
    sessionId: env.session_id,
    denials: env.permission_denials ?? [],
  };
}

/** Pull a JSON object out of model text that may be fenced or prose-wrapped. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}

// ─── Phase 1: propose (read-only, no disk changes) ───────────────────────────

// Compact schema context so generated scripts query REAL SJC OS data instead of
// stubbing the data source. Kept terse (key columns only) to limit token cost;
// scripts read via the allowlisted, read-only `sjcos-query` wrapper.
const SCHEMA_CONTEXT = `SJC OS Postgres tables (read them with: ~/bin/sjcos-query 'SQL' — a READ ONLY wrapper, safe, no creds needed):
- leads(slug, name, scope, stage, triage_verdict, email, phone, estimate_value, source, hot, created_at)
- projects(slug, name, status[pre_construction|active|closeout|complete], client_name, contract_value, collected_to_date, progress, start_date, target_end_date, created_at)
- subs(slug, name, trade, email, phone, rating, jobs_count, coi_status[current|expiring|expired|missing], coi_expires_at)
- threads(channel, subject, from_name, status[needs_reply|awaiting_them|snoozed|done], urgency, last_message_at)
- notifications(kind, title, subline, flagged, read, created_at)
- compliance_items(title, kind[coi|license|tax|insurance|permit], due_date, owner, resolved)
- warranty_projects(project, client, closed_at, warranty_ends_at) / warranty_claims(project, client, issue, resolved, opened_at)
- schedule_blocks(block_date, time_label, label, tone) / daily_logs(log_date, body, photos)
A "completed job" = projects WHERE status='complete'. "Last week" = created_at/updated_at within the prior 7 days. Dates are ISO. Output of sjcos-query is plain psql text.`;

// NOTE: propose runs with NO tools in a SINGLE turn. Testing showed that
// --permission-mode plan makes the CLI explore/think for minutes — far too slow
// and costly. Planning a structured automation is pure text→JSON; it needs no
// tool access, so we forbid every tool and get a one-turn answer (~9s on sonnet).
const PLANNER_SYSTEM = `You are the automation planner for SJC OS, a contractor business app.
Turn the user's plain-text request into a concrete plan in ONE response. Do NOT
use any tools; do NOT create, edit, or run anything.
Respond with ONLY a JSON object, no prose, matching exactly:
{
  "title": string,
  "summary": string,
  "steps": [{ "type": "write_file"|"cron"|"shell", "description": string,
             "path"?: string, "contentPreview"?: string,
             "schedule"?: string, "command"?: string }],
  "risk": "low"|"medium"|"high"
}
Rules: write_file "path" is RELATIVE to the automations directory and must NOT
start with "automations/" or "/" (e.g. "reports/weekly.md", NOT
"automations/reports/weekly.md"). cron "schedule" is a 5-field crontab
expression. Keep contentPreview under 40 lines.

DATA: when an automation needs SJC OS data, generated scripts MUST query the
real database — do NOT stub or hardcode the data source. Use the read-only
wrapper as shown below. Prefer the local Qwen model (Ollama) for any recurring
natural-language generation the automation needs; reserve Claude for one-off
setup only.

${SCHEMA_CONTEXT}`;

export async function proposeAutomation(instruction: string): Promise<AutomationPlan> {
  await mkdir(AUTOMATIONS_DIR, { recursive: true });

  const run = await runClaude(instruction, [
    "--append-system-prompt",
    PLANNER_SYSTEM,
    // No tools at all → single fast turn, no filesystem exploration.
    "--disallowedTools",
    "Read Glob Grep Write Edit Bash WebFetch WebSearch",
  ]);

  const plan = extractJson(run.text) as AutomationPlan;
  validatePlan(plan);
  return plan;
}

// ─── Validation (deterministic guardrail, independent of the model) ──────────

const CRON_RE =
  /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/; // 5 fields; shape check, not full semantics

export function validatePlan(plan: AutomationPlan): void {
  if (!plan?.steps?.length) throw new Error("plan has no steps");

  for (const step of plan.steps) {
    if (step.type === "write_file") {
      if (!step.path) throw new Error("write_file step missing path");
      const resolved = path.resolve(AUTOMATIONS_DIR, step.path);
      if (resolved !== AUTOMATIONS_DIR && !resolved.startsWith(AUTOMATIONS_DIR + path.sep)) {
        throw new Error(`path escapes automations dir: ${step.path}`);
      }
    }
    if (step.type === "cron") {
      if (!step.schedule || !CRON_RE.test(step.schedule.trim())) {
        throw new Error(`invalid cron schedule: ${step.schedule ?? "(none)"}`);
      }
      if (!step.command) throw new Error("cron step missing command");
    }
  }
}

// ─── Phase 2: execute (gated; tight whitelist, dir-confined) ─────────────────

export async function executeApprovedPlan(
  instruction: string,
  plan: AutomationPlan,
): Promise<ExecuteResult> {
  // Re-validate at the boundary — never trust a plan handed back from a client.
  validatePlan(plan);
  await mkdir(AUTOMATIONS_DIR, { recursive: true });

  const prompt = [
    "Carry out EXACTLY this approved automation plan and nothing more.",
    "Do not invent extra steps. Stay inside the automations directory.",
    "",
    `Original request: ${instruction}`,
    "",
    "Approved plan:",
    JSON.stringify(plan, null, 2),
  ].join("\n");

  const run = await runClaude(prompt, [
    "--add-dir",
    AUTOMATIONS_DIR,
    // Files only — NO Bash. The model can write scripts but can NEVER touch the
    // live crontab. Cron is staged below and installed deterministically, after
    // a separate human confirm, by installPlanCrons() — not by the model.
    "--allowedTools",
    "Write Edit Read Glob Grep",
    "--disallowedTools",
    "Bash WebFetch WebSearch",
    // Human approval already obtained at the app layer; auto-accept edits rather
    // than re-prompting (prompts go nowhere headless anyway).
    "--permission-mode",
    "acceptEdits",
  ]);

  const stagedCron = await stageCron(plan);

  return {
    ok: run.denials.length === 0,
    output: run.text,
    costUsd: run.costUsd,
    denials: run.denials,
    stagedCron,
  };
}

// ─── Cron: stage, then install (deterministic, model never runs crontab) ─────

/** True if the plan schedules anything — drives the "Install cron" step in UI. */
export function hasCronSteps(plan: AutomationPlan): boolean {
  return plan.steps.some((s) => s.type === "cron");
}

/** Render a plan's cron steps as crontab lines: "<schedule> <command>". */
function cronLines(plan: AutomationPlan): string[] {
  return plan.steps
    .filter((s) => s.type === "cron")
    .map((s) => `${s.schedule!.trim()} ${s.command!.trim()}`);
}

/**
 * Write the intended cron lines to automations/crontab.proposed for review.
 * Nothing is installed here — this is the "stage" half of stage-then-install.
 */
async function stageCron(plan: AutomationPlan): Promise<string[]> {
  const lines = cronLines(plan);
  if (lines.length === 0) return [];
  const body =
    `# Staged by SJC OS automation builder — NOT yet installed.\n` +
    `# Plan: ${plan.title}\n` +
    `# Review, then install from the app (Install cron) to apply.\n\n` +
    lines.join("\n") +
    "\n";
  await writeFile(path.join(AUTOMATIONS_DIR, "crontab.proposed"), body, "utf8");
  return lines;
}

/** Read the current user crontab, or "" if none is set yet. */
async function currentCrontab(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("crontab", ["-l"]);
    return stdout;
  } catch {
    return ""; // `crontab -l` exits non-zero when no crontab exists
  }
}

/** Pipe new crontab content to `crontab -` (spawn so we can write stdin). */
function writeCrontab(content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("crontab", ["-"]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`crontab exited ${code}: ${err}`)),
    );
    p.stdin.write(content);
    p.stdin.end();
  });
}

/**
 * Install the plan's cron lines into the user crontab. Deterministic and
 * idempotent: lines already present are skipped, so re-running is safe. Tagged
 * with a marker comment so installed automations are identifiable. This is the
 * ONLY place a live crontab is mutated, and it runs only when the app calls it
 * after an explicit second confirm — never from model output.
 */
export async function installPlanCrons(plan: AutomationPlan): Promise<InstallResult> {
  validatePlan(plan);
  const lines = cronLines(plan);
  if (lines.length === 0) return { installed: [], skipped: [] };

  const existing = await currentCrontab();
  const existingLines = new Set(
    existing.split("\n").map((l) => l.trim()).filter(Boolean),
  );

  const installed = lines.filter((l) => !existingLines.has(l.trim()));
  const skipped = lines.filter((l) => existingLines.has(l.trim()));

  if (installed.length > 0) {
    const marker = `# SJC OS automation: ${plan.title}`;
    const next =
      existing.replace(/\n+$/, "") +
      (existing.trim() ? "\n" : "") +
      marker +
      "\n" +
      installed.join("\n") +
      "\n";
    await writeCrontab(next);
  }

  return { installed, skipped };
}
