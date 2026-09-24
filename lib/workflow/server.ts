import "server-only";

// Next.js binding for the workflow join (A23): one transaction per event,
// attributed to the signer/owner context the caller had, never failing the
// binding write that triggered it.

import { withTransaction, runDirect, ownerPrincipalForPolicy } from "@/lib/commands/db";
import type { Principal } from "@/lib/commands/principal";
import { onSignatureSigned, projectWorkflowView, noteWorkflowEvent, type SignatureWorkflowOutcome, type WorkflowView } from "./engine";

/** After a signature is recorded (lib/actions/esign.ts). Idempotent. */
export async function workflowOnSignatureSigned(signatureRequestId: number, principal?: Principal): Promise<SignatureWorkflowOutcome> {
  const p = principal ?? (await ownerPrincipalForPolicy());
  return withTransaction((run) => onSignatureSigned(run, signatureRequestId, p));
}

export async function getProjectWorkflowView(projectId: string): Promise<WorkflowView | null> {
  return projectWorkflowView(runDirect, projectId);
}

export async function noteProjectWorkflowEvent(input: Parameters<typeof noteWorkflowEvent>[1]): Promise<{ created: boolean }> {
  return withTransaction((run) => noteWorkflowEvent(run, input));
}
