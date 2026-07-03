// Client-safe buckets for the per-record (lead/project) work queue (NO db import
// — safe to import from client components). Finer-grained than the /engine board
// so a single job's work reads clearly on its detail page.

import type { WorkItemStatus } from "./types";

export type DetailBucket =
  | "approval"
  | "active"
  | "waiting_joe"
  | "waiting_client"
  | "waiting_sub"
  | "queued"
  | "done";

export const DETAIL_BUCKET_ORDER: DetailBucket[] = [
  "approval",
  "active",
  "waiting_joe",
  "waiting_client",
  "waiting_sub",
  "queued",
  "done",
];

export const DETAIL_BUCKET_LABEL: Record<DetailBucket, string> = {
  approval: "Needs approval",
  active: "Active / in progress",
  waiting_joe: "Waiting on Joe",
  waiting_client: "Waiting on client",
  waiting_sub: "Waiting on sub / vendor",
  queued: "Queued",
  done: "Done / cancelled",
};

/** Map a work item to its detail-page bucket. `blocked` folds into "waiting on
 *  Joe" since a blocker is usually the owner's to clear. */
export function detailBucketFor(status: WorkItemStatus, approvalRequested: boolean): DetailBucket {
  if (status === "approval_needed" || approvalRequested) return "approval";
  if (status === "in_progress") return "active";
  if (status === "waiting_on_human" || status === "blocked") return "waiting_joe";
  if (status === "waiting_on_client") return "waiting_client";
  if (status === "waiting_on_sub") return "waiting_sub";
  if (status === "done" || status === "cancelled") return "done";
  return "queued";
}
