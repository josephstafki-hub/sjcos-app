import type { Run } from "./core.ts";
import { humanOf, isOwner, type Principal } from "./principal.ts";

export const INACTIVE_OWNER = "No active owner account. Nothing was changed.";

/** Call inside the mutation transaction, AFTER locking its target record.
 * Recheck the same account after any target-lock wait, then keep role/active
 * updates and deletion blocked until commit. FOR KEY SHARE would not conflict
 * with a non-key role/active update; FOR SHARE does. */
export async function lockActiveOwner(run: Run, principal: Principal): Promise<boolean> {
  const human = humanOf(principal);
  if (!human || !isOwner(principal)) return false;
  const [account] = await run<{ active: boolean; role: string }>(
    `SELECT active, role FROM users WHERE id = $1 FOR SHARE`, [human.userId],
  );
  return account?.active === true && account.role === "owner";
}
