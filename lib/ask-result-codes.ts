// Shared contract between Ask server actions/RPC and the Operator panel UI
// (Phase 0 build round 2, amendment A1). Server code returns these fixed codes
// instead of throwing. Production builds strip error messages from server
// actions, so a thrown message never reaches the screen. UI copy lives in
// components/panel/askStatusCopy.ts; never put private titles or causes in a
// failure result.

export type AskFailureCode =
  /** Admission closed: recovery evidence, missing protected identity or invalid configuration (A1.1). */
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

/** Parse the actual Next redirect digest, never arbitrary error message text.
 * Only local authentication routes are sign-in failures. */
export function askRedirectPath(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== 'string') return null;
  const parts = digest.split(';');
  if (parts.length < 5 || parts[0] !== 'NEXT_REDIRECT' || !['push', 'replace'].includes(parts[1]) ||
      !['303', '307', '308'].includes(parts.at(-2)!) || parts.at(-1) !== '') return null;
  const target = parts.slice(2, -2).join(';');
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return null;
  try { return new URL(target, 'http://ask.local').pathname; } catch { return null; }
}
export function normalizeAskFailure(error: unknown): AskFailure {
  if (isAskFailure(error)) return {ok:false,code:error.code};
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  const redirect = askRedirectPath(error);
  const code: AskFailureCode = redirect === '/login' || redirect === '/logout' ||
    /^(?:ASK_SIGN_IN_REQUIRED|ASK_COOKIE_REQUIRED|ASK_SESSION_REVOKED)$/.test(message) ? 'SIGN_IN_AGAIN'
    : message === 'ASK_ACCESS_DENIED' ? 'CHAT_OFF'
    : /DELETE_NOT_READY|Chat deletion is not ready/.test(message) ? 'DELETE_NOT_READY'
    : /ASK_THREAD_UNAVAILABLE|ASK_ATTACHMENT_UNAVAILABLE|ASK_RESUME_MISMATCH|invalid input syntax for type uuid/.test(message) ? 'THREAD_UNAVAILABLE'
    : 'ASK_PAUSED';
  return { ok: false, code };
}
export function askFailureStatus(failure: AskFailure): number {
  return failure.code === 'SIGN_IN_AGAIN' ? 401 : failure.code === 'CHAT_OFF' ? 403 : failure.code === 'ASK_PAUSED' ? 503 : 409;
}
