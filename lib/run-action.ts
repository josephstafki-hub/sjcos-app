// Client-safe runner for Result-returning server actions.
//
// Server actions in lib/actions/* answer `{ ok: false, error }` on failure and
// historically every component decided on its own what to do with that — some
// showed an inline red line, many dropped it. runAction() is the single path:
// it awaits the action, raises a toast on `{ ok: false }` (and on a thrown
// error — network, a server-side crash — with the real text behind "Details"),
// and never throws itself. Next's own control-flow throws (redirect(),
// notFound()) are re-thrown untouched so they keep working.
//
// This file must stay importable from client components: no server-only
// imports here.

import { unstable_rethrow } from "next/navigation";
import { toast } from "@/components/ui/Toast";

export interface ActionFailure {
  ok: false;
  error: string;
}

/** Anything a server action might resolve to. `void`/`undefined` and objects
 *  without an `ok` field count as success. */
export type ActionLike = { ok: boolean; error?: string } | void | undefined | null | Record<string, unknown>;

export interface RunActionOptions<R> {
  /** Runs after a successful result (ok !== false). */
  onSuccess?: (result: R) => void;
  /** Runs after a failure, with the message that was toasted. */
  onError?: (message: string) => void;
  /** Message when the action failed without saying why. */
  fallback?: string;
  /** Toast title for failures; defaults to "Something went wrong". */
  title?: string;
  /** Set false to skip the toast (the caller shows the error some other way). */
  toast?: boolean;
}

const DEFAULT_FALLBACK = "Something went wrong.";

export function isActionFailure(r: unknown): r is ActionFailure {
  return typeof r === "object" && r !== null && (r as { ok?: unknown }).ok === false;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Await a server action; toast on failure; return the result (or a
 *  synthesized `{ ok: false, error }` when the action threw) so callers that
 *  keep a field-level inline error can still read `r.error`. */
export async function runAction<R extends ActionLike>(
  fn: () => Promise<R>,
  opts: RunActionOptions<R> = {},
): Promise<R | ActionFailure> {
  const fallback = opts.fallback ?? DEFAULT_FALLBACK;
  let result: R;
  try {
    result = await fn();
  } catch (err) {
    // redirect() / notFound() inside an action surface as throws — let Next
    // handle those.
    unstable_rethrow(err);
    const detail = messageOf(err);
    const isNetwork = /fetch|network|Failed to fetch|Load failed/i.test(detail);
    const message = isNetwork ? "Couldn't reach the server. Check your connection and try again." : fallback;
    if (opts.toast !== false) {
      toast({ kind: "error", title: opts.title, message, details: detail });
    }
    opts.onError?.(message);
    return { ok: false, error: message };
  }

  if (isActionFailure(result)) {
    const message = (result.error ?? "").trim() || fallback;
    if (opts.toast !== false) {
      toast({ kind: "error", title: opts.title, message });
    }
    opts.onError?.(message);
    return result;
  }

  opts.onSuccess?.(result);
  return result;
}
