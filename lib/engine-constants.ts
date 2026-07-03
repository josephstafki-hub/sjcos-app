// Client-safe Open Engine constants (NO db import — importable from client
// components without dragging pg into the bundle).

import type { WorkItemStatus, WorkItemPriority } from "./types";

export const WORK_STATUSES: WorkItemStatus[] = [
  "queued",
  "in_progress",
  "waiting_on_human",
  "waiting_on_client",
  "waiting_on_sub",
  "blocked",
  "approval_needed",
  "done",
  "cancelled",
];

export const STATUS_LABEL: Record<WorkItemStatus, string> = {
  queued: "Queued",
  in_progress: "In progress",
  waiting_on_human: "Waiting on Joe",
  waiting_on_client: "Waiting on client",
  waiting_on_sub: "Waiting on sub",
  blocked: "Blocked",
  approval_needed: "Approval needed",
  done: "Done",
  cancelled: "Cancelled",
};

export const PRIORITY_LABEL: Record<WorkItemPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/** Which display bucket a work item falls into on the queue board. */
export type QueueBucket = "approval" | "active" | "waiting" | "queued" | "done";

export function bucketFor(status: WorkItemStatus, approvalRequested: boolean): QueueBucket {
  if (status === "approval_needed" || approvalRequested) return "approval";
  if (status === "in_progress") return "active";
  if (status === "waiting_on_human" || status === "waiting_on_client" || status === "waiting_on_sub" || status === "blocked")
    return "waiting";
  if (status === "done" || status === "cancelled") return "done";
  return "queued";
}
