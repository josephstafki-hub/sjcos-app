// Client-safe metadata for the Ask-window agent selector. No db / server-only
// imports (mirrors lib/catalog-categories.ts) so "use client" components can
// import it without dragging pg/child_process into the browser bundle.

export type DevAgent = "claude" | "qwen" | "hermes";

export interface AgentMeta {
  id: DevAgent;
  label: string;
  initials: string;
  /** One-line role note shown under the selector. */
  note: string;
  /** true → runs async (poll for the answer); false → synchronous. */
  async: boolean;
}

export const AGENT_META: Record<DevAgent, AgentMeta> = {
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

export const AGENT_ORDER: DevAgent[] = ["claude", "qwen", "hermes"];

// ─── Inbox reply-draft model picker ──────────────────────────────────────────
// The two grounded assistant models Joe can pick to draft an email reply. Claude
// is deliberately excluded — it's the async, dev-only code-editing agent, wrong
// tool for writing a client email. Kept here (not in the "use server" action
// module) so the "use client" inbox can import the type + options.
export type DraftModel = "qwen" | "hermes";

export const DRAFT_MODEL_OPTIONS: { value: DraftModel; label: string; note: string }[] = [
  { value: "qwen", label: "Qwen", note: "Fast · local · grounded in your data" },
  { value: "hermes", label: "Hermes", note: "Deeper business context · slower" },
];

// ─── Claude run controls (Ask window selectors) ──────────────────────────────
// Client-safe so the "use client" chat can render the pickers. The runner
// (scripts/run-claude-agent.mjs) maps these to CLI flags / prompt directives.

// Values map 1:1 to the installed CLI's flags (`claude --help`, v2.1.x):
//   model  → --model alias        (fable | opus | sonnet)
//   mode   → --permission-mode    (all six real modes below)
//   effort → --effort <level>     (low | medium | high | xhigh | max)
// "default" means "pass no flag → use the CLI's configured session default".
// Mode values ARE the exact --permission-mode strings so the runner can pass
// them straight through (guarded by a whitelist).
export type ClaudeModel = "default" | "sonnet" | "opus" | "fable";
export type ClaudeMode =
  | "acceptEdits"
  | "plan"
  | "auto"
  | "bypassPermissions"
  | "manual"
  | "dontAsk";
export type ClaudeEffort = "default" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeOptions {
  model: ClaudeModel;
  mode: ClaudeMode;
  effort: ClaudeEffort;
}

export const CLAUDE_DEFAULTS: ClaudeOptions = {
  // Default to Sonnet, NOT "default" — "default" makes the runner pass no
  // --model flag, so the CLI inherits ~/.claude/settings.json ("model":"opus"),
  // and every dev-agent turn silently ran on Opus (~5x Sonnet's per-token cost).
  // Sonnet handles these edits well; pick Opus per-run in the composer when you
  // want it (or type /model opus).
  model: "sonnet",
  mode: "acceptEdits",
  effort: "default",
};

export const CLAUDE_MODEL_OPTIONS: { value: ClaudeModel; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "fable", label: "Fable" },
];

export const CLAUDE_MODE_OPTIONS: { value: ClaudeMode; label: string; note: string }[] = [
  { value: "acceptEdits", label: "Accept edits", note: "auto-accepts file edits" },
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
