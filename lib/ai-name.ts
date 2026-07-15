// The display name of the AI assistant, for user-facing labels.
// Deliberately generic: the app offers several selectable models, so a label
// describing the assistant's *role* ("Ask AI", "Draft with AI") must never name
// one of them — the model behind any given surface is an implementation detail
// and can be swapped. Model names belong only where the user is choosing or has
// chosen between models (see AGENT_META in lib/dev-agents-meta.ts).
// Kept as a constant so the wording is one edit away if it ever changes.
// Pure constant module (no db / server-only) → safe to import anywhere.

export const AI_NAME = "AI";
