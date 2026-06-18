// The display name of the active AI assistant, for user-facing labels.
// Derived from the provider so the UI says "Qwen" on the local Ollama model,
// "Claude" on Anthropic, "AI" on the mock. NEXT_PUBLIC_AI_PROVIDER mirrors
// AI_PROVIDER so client components (which can't read private env) get it too.
// Pure constant module (no db / server-only) → safe to import anywhere.

const provider =
  process.env.NEXT_PUBLIC_AI_PROVIDER ?? process.env.AI_PROVIDER ?? "mock";

export const AI_NAME =
  provider === "ollama" ? "Qwen" : provider === "anthropic" ? "Claude" : "AI";
