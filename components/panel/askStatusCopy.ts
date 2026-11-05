import { isAskFailure, type AskFailure, type AskFailureCode } from '@/lib/ask-result-codes';

export const ASK_STATUS_COPY: Record<AskFailureCode, string> = {
  ASK_PAUSED: 'Chats are paused while SJC OS checks its records. Try again in a few minutes.',
  THREAD_UNAVAILABLE: "This chat isn't available to this account.",
  SIGN_IN_AGAIN: 'Sign in again to continue.',
  CHAT_OFF: "Chat isn't turned on for this account.",
  DELETE_NOT_READY: 'Chat deletion is not ready yet. Try again later.',
};
export const ASK_DELETE_CONFIRM = "Delete this chat? It's removed now and erased for good after 30 days.";
export const ASK_EMPTY_COPY = 'No chats yet. Only your own chats show here.';

/** Compatibility with older actions that still throw. Never display a raw cause. */
export function askFailure(value: unknown): AskFailure | null {
  if (isAskFailure(value)) return value;
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  const legacy: Record<string, AskFailureCode> = {
    ASK_SIGN_IN_REQUIRED: 'SIGN_IN_AGAIN', ASK_ACCESS_DENIED: 'CHAT_OFF',
    ASK_THREAD_UNAVAILABLE: 'THREAD_UNAVAILABLE', ASK_RECOVERY_UNAVAILABLE: 'ASK_PAUSED',
  };
  const code = legacy[message] ?? (Object.keys(ASK_STATUS_COPY) as AskFailureCode[]).find(k => k === message || ASK_STATUS_COPY[k] === message);
  return code ? {ok:false,code} : null;
}

/** Public action boundary: returned codes and legacy throws follow one path. */
export async function askCall<T>(work: Promise<T>): Promise<Exclude<T, AskFailure>> {
  let result: T;
  try { result = await work; }
  catch (error) { throw askFailure(error) ?? {ok:false,code:'ASK_PAUSED'} satisfies AskFailure; }
  const failure = askFailure(result);
  if (failure) throw failure;
  return result as Exclude<T, AskFailure>;
}
