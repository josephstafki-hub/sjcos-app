// Agent run profiles (A08a). Plain JS (no types) so the detached runner
// (scripts/run-claude-agent.mjs), the app (lib/dev-agents.ts, allowJs) and
// node --test all import the SAME definition of what a business-profile run
// may do. Anything here is enforced by CLI flags / spawn options, not by
// prompt text — a prompt can be argued with; a missing tool cannot.
//
//   operator — Joe's full in-app operator: repo cwd, edit tools, Bash, the
//              sjcos tools. Only when the starting user is the OWNER.
//   business — the sjcos business tools + read-only doc access. No Bash /
//              Write / Edit / WebFetch, cwd = a scratch dir (so Read cannot
//              open .env.local by relative path), --restricted, finite
//              time / turn / dollar limits. The default for staff-started
//              runs and for every unattended run.

export const PROFILES = Object.freeze(["operator", "business"]);

/** Built-in tools a business run never gets. Read/Glob/Grep stay so it can
 *  read the operating docs in the allowed dir. */
export const BUSINESS_DISALLOWED_TOOLS = Object.freeze([
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Task",
  "Agent",
  "EnterWorktree",
  "ExitWorktree",
]);

/** Repo-relative directory a business run may READ (operating docs only). */
export const BUSINESS_DOCS_DIR = "docs/automation-reliability";

/** Defaults for the finite limits on a business run. Owner runs keep the
 *  existing unlimited behaviour unless env/app_settings say otherwise. */
export const BUSINESS_DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
export const BUSINESS_DEFAULT_MAX_TURNS = 60;

export function isProfile(p) {
  return PROFILES.includes(p);
}

/** Decide the profile for a run from the starting person. Staff can never
 *  start an operator run; no person = unattended = business. `requested` is
 *  what the caller asked for (an owner may ask for a business run). */
export function profileFor(starter, requested) {
  if (!starter || starter.role !== "owner" || !starter.active) return "business";
  return requested === "business" ? "business" : "operator";
}

/** The permission mode a profile may run under. --restricted refuses
 *  bypassPermissions, and a business run has nothing to "accept edits" on. */
export function permissionModeFor(profile, mode) {
  if (profile === "business" && (mode === "bypassPermissions" || mode === "auto" || mode === "dontAsk")) return "acceptEdits";
  return mode;
}

/**
 * Profile-specific CLI args + spawn options. Pure: the runner appends these to
 * its common args; tests assert on them.
 *   repo         absolute repo root
 *   scratchDir   absolute scratch cwd for business runs
 *   maxBudgetUsd optional dollar cap (business only; owner runs are warned)
 *   maxTurns     turn cap the runner enforces by counting assistant turns
 */
export function profileArgs(profile, { repo, scratchDir, maxBudgetUsd, maxTurns } = {}) {
  if (profile === "operator") {
    return { args: ["--add-dir", repo], cwd: repo, maxTurns: null, maxBudgetUsd: null, timeoutMs: null };
  }
  const args = [
    "--restricted",
    "--disallowedTools",
    BUSINESS_DISALLOWED_TOOLS.join(" "),
    "--add-dir",
    `${repo}/${BUSINESS_DOCS_DIR}`,
  ];
  const budget = maxBudgetUsd != null && Number.isFinite(Number(maxBudgetUsd)) && Number(maxBudgetUsd) > 0 ? Number(maxBudgetUsd) : null;
  if (budget != null) args.push("--max-budget-usd", String(budget));
  return {
    args,
    cwd: scratchDir,
    maxTurns: maxTurns != null && Number(maxTurns) > 0 ? Number(maxTurns) : BUSINESS_DEFAULT_MAX_TURNS,
    maxBudgetUsd: budget,
    timeoutMs: BUSINESS_DEFAULT_TIMEOUT_MS,
  };
}

/** Does an argv (already built) contain a repo-wide --add-dir? Used by the
 *  tests and by the runner's own self-check before spawning a business run. */
export function argsGrantRepoAccess(args, repo) {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "--add-dir" && args[i + 1] === repo) return true;
  }
  return false;
}

/** Sanity check before spawn: a business run must carry the restrictions and
 *  must not open the repo. Throws so a bug here fails the run, not opens it. */
export function assertBusinessArgs(args, repo) {
  if (!args.includes("--restricted")) throw new Error("business profile: --restricted missing");
  const i = args.indexOf("--disallowedTools");
  if (i < 0) throw new Error("business profile: --disallowedTools missing");
  for (const t of ["Bash", "Write", "Edit"]) {
    if (!String(args[i + 1]).split(/\s+/).includes(t)) throw new Error(`business profile: ${t} not disallowed`);
  }
  if (argsGrantRepoAccess(args, repo)) throw new Error("business profile: repo --add-dir present");
}

/** The profile paragraph the prompt states (informational — the flags are
 *  what enforce it). */
export function profilePromptLine(profile) {
  return profile === "business"
    ? `PROFILE: business. You have the sjcos business tools and read-only access to the operating docs. You have NO shell, NO file editing, NO web access and NO repository access in this run — do not attempt them; if a task needs code changes, say so and stop. You act for the person named below and can do nothing that person could not do themselves.`
    : `PROFILE: operator. You are Joe's full in-app operator with repo edit access as well as the sjcos business tools.`;
}

// ── Usage thresholds (app_settings) ──────────────────────────────────────────

export const SETTING_MAX_COST_PER_RUN = "agent.max_cost_per_run_usd";
export const SETTING_MAX_RUNS_PER_HOUR = "agent.max_runs_per_hour";

/** Parse a threshold value from app_settings ('' / 0 / junk = unset). */
export function parseThreshold(v) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Decide whether a new run may start. Pure over the numbers the caller read:
 *   profile        'business' | 'operator'
 *   runsLastHour   runs started in the trailing hour (all profiles)
 *   maxRunsPerHour threshold or null
 * Business runs are refused past the cap; owner runs are only warned.
 */
export function runAdmission({ profile, runsLastHour, maxRunsPerHour }) {
  if (maxRunsPerHour == null) return { ok: true, warning: null };
  if (runsLastHour < maxRunsPerHour) return { ok: true, warning: null };
  const msg = `Agent run cap reached: ${runsLastHour} runs in the last hour (limit ${maxRunsPerHour}, app setting ${SETTING_MAX_RUNS_PER_HOUR}).`;
  if (profile === "business") return { ok: false, warning: null, error: msg };
  return { ok: true, warning: msg };
}
