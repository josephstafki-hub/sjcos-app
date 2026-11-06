// Agent run profiles (A08a). Plain JS (no types) so the detached runner
// (scripts/run-claude-agent.mjs), the app (lib/dev-agents.ts, allowJs) and
// node --test all import the SAME definition of what a business-profile run
// may do. Anything here is enforced by CLI flags / spawn options, not by
// prompt text — a prompt can be argued with; a missing tool cannot.
//
//   operator — Joe's full in-app operator: repo cwd, edit tools, Bash, the
//              sjcos tools. Only when the starting user is the OWNER.
//   business — sjcos business tools + bounded server-side doc readers. No Bash /
//              Write / Edit / WebFetch, cwd = a scratch dir; native file readers are absent, --restricted, finite
//              time / turn / dollar limits. The default for staff-started
//              runs and for every unattended run.

export const PROFILES = Object.freeze(["operator", "business", "browser"]);

/** Business context must pass synchronous server-side ingestion. */
export const BUSINESS_DISALLOWED_TOOLS = Object.freeze([
  "Read",
  "Glob",
  "Grep",
  "NotebookRead",
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

/** The web tools a business run may be given back for one purpose only:
 *  permit research ('permit' triggers — lib/agent-runtime/claude-runner.mjs
 *  webResearch). Shell / file editing / repo access never come back. */
export const BUSINESS_WEB_TOOLS = Object.freeze(["WebSearch", "WebFetch"]);

/** Canonical server-reader root; never a native CLI --add-dir. */
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
  if (requested === "browser") return starter?.active === true && (starter.role === "owner" || (starter.role === "staff" && starter.permissions?.includes("ai"))) ? "browser" : "business"; // admission also checks attended source
  if (!starter || starter.role !== "owner" || !starter.active) return "business";
  return requested === "business" ? "business" : "operator";
}

/** The permission mode a profile may run under. --restricted refuses
 *  bypassPermissions, and a business run has nothing to "accept edits" on. */
export function permissionModeFor(profile, mode) {
  if (profile === "browser") return "default";
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
  if (profile === "browser") return {
    args: ["--restricted", "--strict-mcp-config", "--tools", "", "--allowedTools", BROWSER_ALLOWED_TOOLS.join(" "), "--disallowedTools", BROWSER_DISALLOWED_TOOLS.join(" "), "--max-turns", "60", ...(maxBudgetUsd > 0 ? ["--max-budget-usd", String(maxBudgetUsd)] : [])],
    cwd: scratchDir, maxTurns: 60, maxBudgetUsd: maxBudgetUsd > 0 ? Number(maxBudgetUsd) : null, timeoutMs: BUSINESS_DEFAULT_TIMEOUT_MS,
  };
  const args = [
    "--restricted",
    "--disallowedTools",
    BUSINESS_DISALLOWED_TOOLS.join(" "),
    "--tools", "ToolSearch",
    "--setting-sources", "",
    "--settings", '{"disableAllHooks":true,"enableAllProjectMcpServers":false}',
    "--disable-slash-commands",
    "--no-chrome",
    "--safe-mode",
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
  for (const t of BUSINESS_DISALLOWED_TOOLS) {
    if (!String(args[i + 1]).split(/\s+/).includes(t)) throw new Error(`business profile: ${t} not disallowed`);
  }
  if (args.includes("--add-dir")) throw new Error("business profile: repo --add-dir present");
  const tools=args[args.indexOf("--tools")+1];
  if (!args.includes("--tools") || !["ToolSearch", "ToolSearch WebSearch WebFetch"].includes(tools)) throw Error("business profile: unsafe native tools");
}

/** The profile paragraph the prompt states (informational — the flags are
 *  what enforce it). */
export function profilePromptLine(profile) {
  if (profile === "browser") return "PROFILE: browser. Only exact task-scoped browser and SJC tools. No shell, files, repository, arbitrary web requests or delegated agents. Outside submissions always require fresh human approval.";
  return profile === "business"
    ? `PROFILE: business. You have the sjcos business tools. Read operating docs only through list_operating_docs/search_operating_docs/read_operating_doc and attachments through read_chat_attachment with supplied IDs. No native file readers. You have NO shell, NO file editing, NO web access and NO repository access in this run — do not attempt them; if a task needs code changes, say so and stop. You act for the person named below and can do nothing that person could not do themselves.`
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
  if (profile !== "operator") return { ok: false, warning: null, error: msg };
  return { ok: true, warning: msg };
}

// Profile definition only. The ordinary detached runner refuses browser rows
// until the isolated CLI/rendezvous/strict DB runtime is implemented and tested.
export const BROWSER_SJC_TOOLS = Object.freeze(['get_operating_context','get_project','get_lead','get_work_item']);
export const BROWSER_DISALLOWED_TOOLS = Object.freeze([...BUSINESS_DISALLOWED_TOOLS,'Read','Glob','Grep','NotebookRead','ToolSearch']);
export const BROWSER_ALLOWED_TOOLS = Object.freeze(BROWSER_SJC_TOOLS.map(t=>`mcp__sjcos__${t}`));
export function browserEligible({user,launchSource,withMcp} = {}) {
  return withMcp === true && launchSource === 'panel_web' && user?.active === true &&
    (user.role === 'owner' || (user.role === 'staff' && user.permissions?.includes('ai') === true));
}

export const BUSINESS_POLICY_VERSION=1;
/** Complete epochs require an isolated CLI customization/settings surface. */
export function assertTrackedBusinessArgs(args,repo){
 assertBusinessArgs(args,repo);
 for(const flag of ['--strict-mcp-config','--disable-slash-commands','--safe-mode','--no-chrome'])if(!args.includes(flag))throw Error(`business profile: ${flag} missing`);
 if(args[args.indexOf('--setting-sources')+1]!==''||!args.includes('--setting-sources'))throw Error('business profile: inherited settings');
 const settings=JSON.parse(args[args.indexOf('--settings')+1]??'null');
 if(settings?.disableAllHooks!==true)throw Error('business profile: hooks enabled');
 if(args.some(v=>['--plugin-dir','--plugin-url','--agent','--agents','--append-system-prompt','--file','--chrome'].includes(v)))throw Error('business profile: untracked customization');
}
