// Client-safe metadata for the Ask-window agent selector. No db / server-only
// imports (mirrors lib/catalog-categories.ts) so "use client" components can
// import it without dragging pg/child_process into the browser bundle.

export type DevAgent = "claude" | "qwen" | "hermes";

/** A file uploaded from the Ask composer: display name + absolute path under
 *  uploads/ai-chat (lib/attachments.ts owns the dir and the reading). Lives
 *  here (not in the "use server" action module) because client components
 *  need the type and a type re-export from a "use server" file does not
 *  survive Turbopack's server-action transform. */
export interface ChatAttachment {
  name: string;
  path: string;
}

/** What a panel conversation can be pinned to: a concrete model, or "auto" —
 *  the router (lib/orchestrator/router.ts) picks the model per message.
 *  Picking a concrete agent in the rail IS the router bypass. */
export type PanelAgent = DevAgent | "auto";

export interface AgentMeta {
  id: PanelAgent;
  label: string;
  initials: string;
  /** One-line role note shown under the selector. */
  note: string;
  /** true → runs async (poll for the answer); false → synchronous. */
  async: boolean;
}

export const AGENT_META: Record<PanelAgent, AgentMeta> = {
  auto: {
    id: "auto",
    label: "Auto",
    initials: "✦",
    note: "Routes each message · Hermes works, Qwen chats, Claude codes & reviews",
    async: false,
  },
  claude: {
    id: "claude",
    label: "Claude",
    initials: "C",
    note: "Dev only · your CLI login · can edit this app's code",
    async: true,
  },
  qwen: {
    id: "qwen",
    label: "Qwen",
    initials: "Q",
    note: "Your assistant · grounded in your data",
    async: false,
  },
  hermes: {
    id: "hermes",
    label: "Hermes",
    initials: "H",
    note: "Dev only · local Hermes model",
    async: false,
  },
};

export const AGENT_ORDER: PanelAgent[] = ["auto", "claude", "qwen", "hermes"];

/** Concrete models only — for surfaces where "auto" makes no sense (team-chat
 *  channel members). */
export const DEV_AGENT_ORDER: DevAgent[] = ["claude", "qwen", "hermes"];

// ─── Inbox reply-draft model ─────────────────────────────────────────────────
// The models that can draft an email reply. The inbox UI no longer surfaces a
// picker — model names never appear in role labels (see lib/ai-name.ts) — and
// always drafts with Hermes; "qwen" remains a valid value for internal callers.
export type DraftModel = "qwen" | "hermes";

// ─── Claude run controls (Ask window selectors) ──────────────────────────────
// Client-safe so the "use client" chat can render the pickers. The runner
// (scripts/run-claude-agent.mjs) maps these to CLI flags / prompt directives.

// Values map 1:1 to the installed CLI's flags (`claude --help`, v2.1.x):
//   model   → --model <alias | full id>  (alias = "latest of that family";
//             a full id such as claude-fable-5 pins one version)
//   context → "[1m]" suffix on --model   (1M-token window; omitted = the
//             CLI's default for that model, 200k for most, 1M for Fable)
//   mode    → --permission-mode    (the six real modes below), EXCEPT "ask",
//            which is ours: CLI mode manual (every action prompted).
//            In EVERY mode the sjcos tools are pre-approved (--allowedTools
//            mcp__sjcos) and any other permission prompt is routed INTO the
//            panel chat (--permission-prompt-tool → mcp/interact-mcp.mjs) so
//            Joe approves it there instead of the headless CLI silently
//            denying. No answer = deny (fails closed).
//   effort  → --effort <level>     (low | medium | high | xhigh | max)
// "default" means "pass no flag → use the CLI's configured session default".
// Mode values ARE the exact --permission-mode strings so the runner can pass
// them straight through (guarded by a whitelist).
export type ClaudeModel =
  | "default"
  // Family aliases — the CLI resolves each to the newest model of the family.
  | "haiku"
  | "sonnet"
  | "opus"
  | "fable"
  // Pinned versions — full model ids, passed to --model verbatim.
  | "claude-fable-5-1"
  | "claude-fable-5"
  | "claude-opus-5"
  | "claude-opus-4-8"
  | "claude-opus-4-7"
  | "claude-opus-4-6"
  | "claude-sonnet-5"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5";
/** Context window request: "default" = whatever the CLI gives that model,
 *  "200k" = the standard window, "1m" = the 1M-token window (`[1m]` suffix). */
export type ClaudeContext = "default" | "200k" | "1m";
export type ClaudeMode =
  | "acceptEdits"
  | "ask"
  | "plan"
  | "auto"
  | "bypassPermissions"
  | "manual"
  | "dontAsk";
export type ClaudeEffort = "default" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeOptions {
  model: ClaudeModel;
  context: ClaudeContext;
  mode: ClaudeMode;
  effort: ClaudeEffort;
  /** Load the sjcos business tools (MCP) into the run. Off = code-only run
   *  that skips the tool-schema token cost. */
  withMcp: boolean;
}

export const CLAUDE_DEFAULTS: ClaudeOptions = {
  // Default to Sonnet, NOT "default" — "default" makes the runner pass no
  // --model flag, so the CLI inherits ~/.claude/settings.json ("model":"opus"),
  // and every dev-agent turn silently ran on Opus (~5x Sonnet's per-token cost).
  // Sonnet handles these edits well; pick Opus per-run in the composer when you
  // want it (or type /model opus).
  model: "sonnet",
  context: "default",
  mode: "acceptEdits",
  effort: "default",
  withMcp: true,
};

export interface ClaudeModelOption {
  value: ClaudeModel;
  label: string;
  /** Selector group heading (rendered as an <optgroup>). */
  group?: string;
  /** Widest window the model can run (tokens). Haiku is 200k-only. */
  maxContext: number;
  /** The window the CLI gives this model when no `[1m]` suffix is sent. Fable
   *  runs its full 1M by default; the others start at 200k (the CLI may lift
   *  Opus/Sonnet aliases to 1M behind a flag — the run's reported window wins
   *  over this guess once a turn finishes). */
  defaultContext: number;
}

const K200 = 200_000;
const M1 = 1_000_000;

export const CLAUDE_MODEL_OPTIONS: ClaudeModelOption[] = [
  { value: "default", label: "Default (CLI setting)", maxContext: M1, defaultContext: K200 },
  { value: "haiku", label: "Haiku (latest)", group: "Latest of family", maxContext: K200, defaultContext: K200 },
  { value: "sonnet", label: "Sonnet (latest)", group: "Latest of family", maxContext: M1, defaultContext: K200 },
  { value: "opus", label: "Opus (latest)", group: "Latest of family", maxContext: M1, defaultContext: K200 },
  { value: "fable", label: "Fable (latest)", group: "Latest of family", maxContext: M1, defaultContext: M1 },
  { value: "claude-fable-5-1", label: "Fable 5.1", group: "Pinned version", maxContext: M1, defaultContext: M1 },
  { value: "claude-fable-5", label: "Fable 5", group: "Pinned version", maxContext: M1, defaultContext: M1 },
  { value: "claude-opus-5", label: "Opus 5", group: "Pinned version", maxContext: M1, defaultContext: K200 },
  { value: "claude-opus-4-8", label: "Opus 4.8", group: "Pinned version", maxContext: M1, defaultContext: K200 },
  { value: "claude-opus-4-7", label: "Opus 4.7", group: "Pinned version", maxContext: M1, defaultContext: K200 },
  { value: "claude-opus-4-6", label: "Opus 4.6", group: "Pinned version", maxContext: M1, defaultContext: K200 },
  { value: "claude-sonnet-5", label: "Sonnet 5", group: "Pinned version", maxContext: M1, defaultContext: K200 },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6", group: "Pinned version", maxContext: M1, defaultContext: K200 },
  { value: "claude-haiku-4-5", label: "Haiku 4.5", group: "Pinned version", maxContext: K200, defaultContext: K200 },
];

export const CLAUDE_MODEL_VALUES: ClaudeModel[] = CLAUDE_MODEL_OPTIONS.map((m) => m.value);

/** Resolve a picker value or a typed `/model` argument (value, label, or a
 *  loose form like "fable 5.1" / "fable-5.1" / "opus4.8") to an option. */
export function findClaudeModel(input: string): ClaudeModelOption | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/\(latest\)|\(cli setting\)/g, "").replace(/[^a-z0-9]/g, "");
  const q = norm(input);
  if (!q) return undefined;
  return (
    CLAUDE_MODEL_OPTIONS.find((o) => o.value.toLowerCase() === input.toLowerCase()) ??
    CLAUDE_MODEL_OPTIONS.find((o) => norm(o.value) === q) ??
    CLAUDE_MODEL_OPTIONS.find((o) => norm(o.label) === q) ??
    CLAUDE_MODEL_OPTIONS.find((o) => norm(o.value.replace(/^claude-/, "")) === q)
  );
}

export const CLAUDE_CONTEXT_OPTIONS: { value: ClaudeContext; label: string; note: string }[] = [
  { value: "default", label: "Default", note: "the CLI's window for that model" },
  { value: "200k", label: "200k", note: "standard window" },
  { value: "1m", label: "1M", note: "long-context window ([1m])" },
];

export const CLAUDE_CONTEXT_VALUES: ClaudeContext[] = CLAUDE_CONTEXT_OPTIONS.map((c) => c.value);

/** Can this model run the 1M window? (Haiku cannot.) */
export function claudeSupports1m(model: ClaudeModel): boolean {
  return (CLAUDE_MODEL_OPTIONS.find((o) => o.value === model)?.maxContext ?? K200) >= M1;
}

/** The --model string for a run: the picked model plus the `[1m]` suffix when
 *  the 1M window is requested (and the model can take it). "default" model =
 *  no flag at all (the CLI's own default), so no suffix can be attached. */
export function claudeModelArg(model: ClaudeModel, context: ClaudeContext): string | null {
  if (model === "default") return null;
  return context === "1m" && claudeSupports1m(model) ? `${model}[1m]` : model;
}

/** The context window the meter should assume for a model + context choice
 *  before a run has reported its real window. */
export function claudeContextWindow(model: ClaudeModel, context: ClaudeContext): number {
  const opt = CLAUDE_MODEL_OPTIONS.find((o) => o.value === model);
  if (context === "1m" && claudeSupports1m(model)) return M1;
  if (context === "200k") return K200;
  return opt?.defaultContext ?? K200;
}

/** Context-window fallback for the meter when neither the run's usage nor
 *  the picker can tell us better (the standard window). */
export const CLAUDE_CONTEXT_WINDOW = K200;

export const CLAUDE_MODE_OPTIONS: { value: ClaudeMode; label: string; note: string }[] = [
  { value: "acceptEdits", label: "Accept edits", note: "auto-accepts file edits" },
  { value: "ask", label: "Ask me", note: "approve each action here in the chat" },
  { value: "plan", label: "Plan", note: "read-only · proposes, no edits" },
  { value: "auto", label: "Auto", note: "auto-runs, minimal prompts" },
  { value: "bypassPermissions", label: "Bypass", note: "never prompts · full access" },
  { value: "manual", label: "Manual", note: "asks before each action" },
  { value: "dontAsk", label: "Don't ask", note: "proceeds without confirming" },
];

/** The six --permission-mode strings the CLI accepts (runner whitelist). */
export const CLAUDE_MODE_VALUES: ClaudeMode[] = CLAUDE_MODE_OPTIONS.map((m) => m.value);

export const CLAUDE_EFFORT_OPTIONS: { value: ClaudeEffort; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Xhigh" },
  { value: "max", label: "Max" },
];
