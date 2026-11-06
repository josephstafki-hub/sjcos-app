/** Background reads must never invoke Next's navigation control flow. */
export type BackgroundFailure = { ok: false; code: 'SIGN_IN_AGAIN' | 'ACCESS_DENIED'; error?: string };
export function isBackgroundFailure(value: unknown): value is BackgroundFailure {
  return !!value && typeof value === 'object' && (value as BackgroundFailure).ok === false &&
    ['SIGN_IN_AGAIN', 'ACCESS_DENIED'].includes((value as BackgroundFailure).code);
}
