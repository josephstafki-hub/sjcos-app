// Pre-con approval gate — shared shape, NO db import (safe for client bundles).
// The gate is the three sign-offs the plan requires before a contract can be
// generated: design (e-signed prints), selections (all client-approved), and
// estimate (client-approved). The design + selections legs are project-level;
// the estimate leg depends on the specific estimate being turned into a
// contract, so the client component ANDs in that estimate's approved status.

export interface ApprovalGateBase {
  /** A design/prints e-sign request has been signed. */
  design: boolean;
  designDetail: string;
  /** Selections exist and are all client-approved (none pending). */
  selections: boolean;
  selectionsDetail: string;
}
