// SJC OS — domain types.
// These mirror db/schema.sql. Keep the two in sync: a column added there
// should gain a field here, and vice-versa. String unions match CHECK
// constraints / enums in the schema.

// ─── Leads ──────────────────────────────────────────────────────────────────

/** The lead pipeline, ending at the pre-construction contract being signed
 *  (after which the lead converts to a project). */
export type LeadStage =
  | "intake"
  | "qualified"
  | "discovery_call"
  | "rough_estimate"
  | "precon_signed";

/** Claude's lead-triage verdict. */
export type TriageVerdict = "go" | "hold" | "pass";

export interface Lead {
  id: string;
  slug: string;
  name: string;
  /** Short scope blurb, e.g. "Kitchen remodel — full gut". */
  scope: string;
  stage: LeadStage;
  triageVerdict: TriageVerdict | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** Estimated job value in whole dollars. */
  estimateValue: number | null;
  source: string | null;
  lastContactAt: string | null; // ISO timestamp
  createdAt: string;
  updatedAt: string;
}

// ─── Projects ───────────────────────────────────────────────────────────────

/** Project lifecycle buckets (Projects list groups). */
export type ProjectStatus = "pre_construction" | "active" | "closeout" | "complete";

export interface Project {
  id: string;
  slug: string;
  name: string;
  status: ProjectStatus;
  clientName: string;
  address: string | null;
  /** Signed contract value in whole dollars. */
  contractValue: number;
  /** Amount invoiced/received to date in whole dollars. */
  collectedToDate: number;
  /** 0–100 completion. */
  progress: number;
  startDate: string | null; // ISO date
  targetEndDate: string | null;
  /** Optional link back to the originating lead. */
  leadId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Subcontractors ─────────────────────────────────────────────────────────

/** Certificate-of-insurance standing. */
export type CoiStatus = "current" | "expiring" | "expired" | "missing";

export interface Sub {
  id: string;
  slug: string;
  name: string;
  trade: string;
  email: string | null;
  phone: string | null;
  /** 0–5, one decimal. */
  rating: number | null;
  jobsCount: number;
  /** Day rate or hourly, free-form display string e.g. "$85/hr". */
  rate: string | null;
  coiStatus: CoiStatus;
  coiExpiresAt: string | null; // ISO date
  createdAt: string;
  updatedAt: string;
}

// ─── Communication threads (Inbox + Comms) ──────────────────────────────────

export type ThreadChannel = "email" | "sms" | "client_portal" | "sub_portal" | "site_form";
export type ThreadStatus = "needs_reply" | "awaiting_them" | "snoozed" | "done";
export type Urgency = "low" | "normal" | "high";

export interface Thread {
  id: string;
  channel: ThreadChannel;
  subject: string;
  /** Display name of the counterparty. */
  fromName: string;
  status: ThreadStatus;
  urgency: Urgency;
  /** Claude's one-word read on the thread, e.g. "decision", "fyi". */
  aiVerdict: string | null;
  projectId: string | null;
  leadId: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Notifications ──────────────────────────────────────────────────────────

export type NotificationKind = "decision" | "mention" | "job" | "money" | "compliance";

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  subline: string | null;
  /** Decisions render with a red border. */
  flagged: boolean;
  read: boolean;
  /** Optional deep link, e.g. "/projects/henderson". */
  href: string | null;
  createdAt: string;
}

// ─── Compliance calendar ────────────────────────────────────────────────────

export type ComplianceKind = "coi" | "license" | "tax" | "insurance" | "permit";
/** Timeline window the item falls into, derived from dueDate. */
export type ComplianceWindow = "urgent" | "thirty_day" | "sixty_ninety";

export interface ComplianceItem {
  id: string;
  title: string;
  kind: ComplianceKind;
  dueDate: string; // ISO date
  owner: string | null;
  notes: string | null;
  resolved: boolean;
  createdAt: string;
}
