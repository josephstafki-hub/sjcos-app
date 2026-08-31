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
//   model  → --model alias        (fable | opus | sonnet | haiku)
//   mode   → --permission-mode    (the six real modes below), EXCEPT "ask",
//            which is ours: CLI mode manual (every action prompted).
//            In EVERY mode the sjcos tools are pre-approved (--allowedTools
//            mcp__sjcos) and any other permission prompt is routed INTO the
//            panel chat (--permission-prompt-tool → mcp/interact-mcp.mjs) so
//            Joe approves it there instead of the headless CLI silently
//            denying. No answer = deny (fails closed).
//   effort → --effort <level>     (low | medium | high | xhigh | max)
// "default" means "pass no flag → use the CLI's configured session default".
// Mode values ARE the exact --permission-mode strings so the runner can pass
// them straight through (guarded by a whitelist).
export type ClaudeModel = "default" | "haiku" | "sonnet" | "opus" | "fable";
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
  mode: "acceptEdits",
  effort: "default",
  withMcp: true,
};

export const CLAUDE_MODEL_OPTIONS: { value: ClaudeModel; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "haiku", label: "Haiku" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "fable", label: "Fable" },
];

export const CLAUDE_MODE_OPTIONS: { value: ClaudeMode; label: string; note: string }[] = [
  { value: "acceptEdits", label: "Accept edits", note: "auto-accepts file edits" },
  { value: "ask", label: "Ask me", note: "approve each action here in the chat" },
  { value: "plan", label: "Plan", note: "read-only · proposes, no edits" },
  { value: "auto", label: "Auto", note: "auto-runs, minimal prompts" },
  { value: "bypassPermissions", label: "Bypass", note: "never prompts · full access" },
  { value: "manual", label: "Manual", note: "asks before each action" },
  { value: "dontAsk", label: "Don't ask", note: "proceeds without confirming" },
];

/** Context-window fallback for the meter when a run's usage hasn't reported
 *  the real window yet (every current alias is 200k). */
export const CLAUDE_CONTEXT_WINDOW = 200_000;

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
