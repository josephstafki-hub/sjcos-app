// Worker identity registry (A08b). Every unattended process that touches the
// business runs AS one of these identities: a name, the lanes / intent kinds
// it may work, and the Postgres role it should connect with once
// deploy/db-roles.sql is applied. assertWorkerMay() is the code-side check;
// the database role is the enforced one (a worker connected as sjcos_worker
// cannot UPDATE users or authority_grants no matter what a prompt says).
//
// Pure module: no db, no server-only.

export type WorkerName =
  | "dispatch"
  | "weekly-summary"
  | "business-agent-worker"
  | "qbo-sync"
  | "payments-reconcile"
  | "backup"
  | "monitor";

export interface WorkerIdentity {
  name: WorkerName;
  /** Service principal name (lib/commands/principal.ts ServicePrincipal.name). */
  principal: `worker:${WorkerName}`;
  /** action_intents kinds this worker may claim / dispatch. */
  intentKinds: readonly string[];
  /** lane_pauses lanes it participates in (kill switches). */
  lanes: readonly string[];
  /** Postgres role from deploy/db-roles.sql. */
  dbRole: "sjcos_worker" | "sjcos_agent" | "sjcos_readonly" | "sjcos_backup";
  /** Human note for the credentials inventory. */
  note: string;
}

export const WORKERS: Readonly<Record<WorkerName, WorkerIdentity>> = {
  dispatch: {
    name: "dispatch",
    principal: "worker:dispatch",
    intentKinds: ["send_email", "send_sms", "send_bid_package", "send_purchase_order", "send_invoice", "release_newsletter_issue", "release_newsletter_outbox_item", "send_document_for_signature", "place_call", "telegram_push", "owner_push"],
    lanes: ["sends", "notify"],
    dbRole: "sjcos_worker",
    note: "Runs approved action intents through provider adapters. Never stages, never approves.",
  },
  "weekly-summary": {
    name: "weekly-summary",
    principal: "worker:weekly-summary",
    intentKinds: ["send_email"],
    lanes: ["client_summary"],
    dbRole: "sjcos_worker",
    note: "Composes the Friday client summary from verified portal evidence and enqueues the send under the weekly-summary policy.",
  },
  "business-agent-worker": {
    name: "business-agent-worker",
    principal: "worker:business-agent-worker",
    intentKinds: [],
    lanes: ["agent"],
    dbRole: "sjcos_agent",
    note: "Runs business-profile agent turns (scripts/run-business-agent.mjs, WS-agents). Stages and asks; cannot enqueue provider sends itself.",
  },
  "qbo-sync": {
    name: "qbo-sync",
    principal: "worker:qbo-sync",
    intentKinds: ["qbo_post"],
    lanes: ["accounting"],
    dbRole: "sjcos_worker",
    note: "Posts approved invoices/payments to QuickBooks Online and reconciles. No client sends.",
  },
  "payments-reconcile": {
    name: "payments-reconcile",
    principal: "worker:payments-reconcile",
    intentKinds: ["square_reconcile"],
    lanes: ["payments"],
    dbRole: "sjcos_worker",
    note: "Matches Square events to invoices. Never charges, never refunds (those are one-tap decisions).",
  },
  backup: {
    name: "backup",
    principal: "worker:backup",
    intentKinds: [],
    lanes: ["backup"],
    dbRole: "sjcos_backup",
    note: "pg_dump + documents to the off-host target. Read-only on business tables.",
  },
  monitor: {
    name: "monitor",
    principal: "worker:monitor",
    intentKinds: ["owner_push"],
    lanes: ["monitor"],
    dbRole: "sjcos_readonly",
    note: "Uptime / progress checks; may raise an owner push, nothing else.",
  },
};

export const WORKER_NAMES: readonly WorkerName[] = Object.keys(WORKERS) as WorkerName[];

export function isWorkerName(n: string): n is WorkerName {
  return (WORKER_NAMES as readonly string[]).includes(n);
}

export class WorkerScopeError extends Error {
  constructor(worker: string, what: string) {
    super(`Worker "${worker}" may not ${what}.`);
    this.name = "WorkerScopeError";
  }
}

/** May this worker dispatch / claim this intent kind? Throws otherwise. An
 *  unknown worker name is refused outright (fail closed). */
export function assertWorkerMay(worker: string, intentKind: string): WorkerIdentity {
  if (!isWorkerName(worker)) throw new WorkerScopeError(worker, `act at all (unknown worker identity)`);
  const w = WORKERS[worker];
  if (!w.intentKinds.includes(intentKind)) throw new WorkerScopeError(worker, `handle "${intentKind}" intents`);
  return w;
}

/** May this worker run in this lane? */
export function workerMayUseLane(worker: string, lane: string): boolean {
  return isWorkerName(worker) && WORKERS[worker].lanes.includes(lane);
}

/** The service principal a worker runs as (never a user, never the owner). */
export function workerPrincipal(worker: WorkerName): { kind: "service"; name: `worker:${WorkerName}` } {
  return { kind: "service", name: WORKERS[worker].principal };
}
