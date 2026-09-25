// Injected hooks for closeout (A17). WS-money issues the final invoice on
// written sign-off; WS-estimating ingests closeout actuals; owner pushes go
// through notify-owner (bound post-commit in server.ts).

import type { Run } from "../commands/core.ts";
import type { OwnerAlert } from "../field/hooks.ts";

export interface CloseoutActuals {
  materialsCents?: number | null;
  subsCents?: number | null;
  ownerHours?: Record<string, number>;
  notes?: string;
  [k: string]: unknown;
}

export interface CloseoutHooks {
  /** WS-money: issue the final reconciled invoice. Called exactly once per project. */
  onClientSignoff: (run: Run, projectId: string, signatureRequestId: number) => Promise<void>;
  /** WS-estimating: cost/time actuals with a traceable revision number. */
  ingestCloseoutActuals: (run: Run, input: { projectId: string; revision: number; actuals: CloseoutActuals; supersedesRevision: number | null }) => Promise<void>;
  notifyOwner: (alert: OwnerAlert) => Promise<void>;
}

export function defaultCloseoutHooks(overrides: Partial<CloseoutHooks> = {}): CloseoutHooks {
  return {
    onClientSignoff: async () => {},
    ingestCloseoutActuals: async () => {},
    notifyOwner: async () => {},
    ...overrides,
  };
}
