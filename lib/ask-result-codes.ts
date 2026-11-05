// Shared contract between Ask server actions/RPC and the Operator panel UI
// (Phase 0 build round 2, amendment A1). Server code returns these fixed codes
// instead of throwing. Production builds strip error messages from server
// actions, so a thrown message never reaches the screen. UI copy lives in
// components/panel/askStatusCopy.ts; never put private titles or causes in a
// failure result.

export type AskFailureCode =
  /** Recovery gate closed (only reachable once deletion was ever enabled, A1.1). */
  | "ASK_PAUSED"
  /** Thread missing, deleted, quarantined or owned by someone else. Same code for all four, so nothing leaks. */
  | "THREAD_UNAVAILABLE"
  /** Session missing, expired or revoked. */
  | "SIGN_IN_AGAIN"
  /** The account lacks the `ai` area, or Ask is switched off for it. */
  | "CHAT_OFF"
  /** Deletion is server-disabled (deletion never enabled / authority not verified). */
  | "DELETE_NOT_READY";

export type AskFailure = { ok: false; code: AskFailureCode };
export type AskResult<T> = ({ ok: true } & T) | AskFailure;

export const ASK_FAILURE_CODES: readonly AskFailureCode[] = [
  "ASK_PAUSED",
  "THREAD_UNAVAILABLE",
  "SIGN_IN_AGAIN",
  "CHAT_OFF",
  "DELETE_NOT_READY",
] as const;

/** Returned with every thread-list load so the rail can disable Delete up front. */
export type AskThreadCapabilities = { deleteAvailable: boolean };

/** Result of a delete request. The client supplies a stable operationId (UUID v4) and retries with the same one. */
export type AskDeleteResult = AskResult<{ state: "deleted" | "pending" }>;

export function isAskFailure(v: unknown): v is AskFailure {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { ok?: unknown }).ok === false &&
    ASK_FAILURE_CODES.includes((v as { code?: AskFailureCode }).code as AskFailureCode)
  );
}
