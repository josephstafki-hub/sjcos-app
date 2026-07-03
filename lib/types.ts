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

/** Project lifecycle stages, in order (the design's 9-stage flow). */
export type ProjectStatus =
  | "precon_signed"
  | "floor_plan"
  | "mood_board"
  | "selections"
  | "bidding"
  | "construction_contract"
  | "construction"
  | "closeout"
  | "warranty";

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

// ════════════════════════════════════════════════════════════════════════════
//  OPEN BRAIN / OPEN ENGINE / OPEN SKILLS  (mirror the schema.sql section)
// ════════════════════════════════════════════════════════════════════════════

// ─── Open Brain: knowledge_items ────────────────────────────────────────────

/** Free-text, but these are the recommended kinds (see schema.sql). */
export type KnowledgeKind =
  | "note"
  | "client_note"
  | "vendor_note"
  | "project_decision"
  | "business_rule"
  | "sop"
  | "lesson"
  | "estimate_assumption"
  | "selection_preference"
  | "followup_context"
  | "file_summary"
  | "meeting_summary"
  | "daily_log_summary"
  | "admin_note"
  | (string & {});

export interface KnowledgeItem {
  id: string;
  content: string;
  kind: KnowledgeKind;
  /** manual/agent/import/email/file/system. */
  source: string;
  sourceUri: string | null;
  metadata: Record<string, unknown>;
  leadId: string | null;
  projectId: string | null;
  threadId: string | null;
  fileId: string | null;
  contentFingerprint: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Open Brain: agent memory sidecar ───────────────────────────────────────

export type MemoryProvenance = "asserted" | "inferred" | "imported" | "user_confirmed";
export type MemoryReviewStatus = "pending" | "approved" | "rejected";

export interface AgentMemory {
  id: string;
  summary: string;
  content: string;
  /** observation/instruction/preference/fact. */
  memoryType: string;
  provenanceStatus: MemoryProvenance;
  /** 0–1. */
  confidence: number | null;
  reviewStatus: MemoryReviewStatus;
  /** Defaults false — an AI memory never acts as a standing instruction unconfirmed. */
  canUseAsInstruction: boolean;
  canUseAsEvidence: boolean;
  requiresUserConfirmation: boolean;
  staleAfter: string | null;
  runtimeName: string | null;
  provider: string | null;
  model: string | null;
  knowledgeItemId: string | null;
  leadId: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemorySourceRef {
  id: string;
  memoryId: string;
  /** knowledge/thread/file/lead/project/uri/receipt. */
  refKind: string;
  refId: string | null;
  uri: string | null;
  label: string;
  createdAt: string;
}

// ─── Open Engine: work items ────────────────────────────────────────────────

export type WorkItemStatus =
  | "queued"
  | "in_progress"
  | "waiting_on_human"
  | "waiting_on_client"
  | "waiting_on_sub"
  | "blocked"
  | "approval_needed"
  | "done"
  | "cancelled";
export type WorkItemPriority = "low" | "normal" | "high" | "urgent";
export type AssigneeKind = "human" | "agent";
export type ApprovalStatus = "not_requested" | "requested" | "approved" | "rejected";

export interface WorkItem {
  id: string;
  title: string;
  body: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assigneeKind: AssigneeKind;
  /** human-joe / hermes-telegram / claude-code-server / … */
  assigneeKey: string | null;
  dueAt: string | null;
  leadId: string | null;
  projectId: string | null;
  threadId: string | null;
  sourceKind: string;
  sourceId: string | null;
  /** Skill the agent is expected to load before working this item. */
  expectedSkillSlug: string | null;
  expectedRunbookSlug: string | null;
  requiresApproval: boolean;
  approvalStatus: ApprovalStatus;
  blockedReason: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Open Engine: agent runs, receipts, status ledger ───────────────────────

export type AgentRunStatus = "started" | "succeeded" | "failed" | "cancelled";

export interface AgentRun {
  id: string;
  workItemId: string | null;
  runtimeName: string;
  model: string | null;
  status: AgentRunStatus;
  inputSummary: string;
  outputSummary: string;
  errorSummary: string | null;
  costUsd: number | null;
  skillSlug: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AgentReceipt {
  id: string;
  agentRunId: string | null;
  workItemId: string | null;
  /** email/calendar/file/db_row/git/draft/invoice/approval/… */
  receiptKind: string;
  uri: string | null;
  label: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type LedgerState = "idle" | "running" | "blocked" | "waiting_on_human" | "error";

export interface StatusLedger {
  runtimeName: string;
  state: LedgerState;
  currentWorkItemId: string | null;
  blockedReason: string | null;
  note: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  updatedAt: string;
}

// ─── Open Skills: skills, versions, runbooks ────────────────────────────────

export type SkillReviewStatus = "proposed" | "approved" | "rejected";
export type SkillVersionStatus = "draft" | "proposed" | "approved" | "rejected";

export interface Skill {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  triggerPhrases: string[];
  whenToUse: string;
  requiredContext: Record<string, unknown>;
  allowedTools: string[];
  approvalRules: string;
  verificationRequirements: string;
  currentVersionId: string | null;
  reviewStatus: SkillReviewStatus;
  proposedBy: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillVersion {
  id: string;
  skillId: string;
  version: number;
  bodyMarkdown: string;
  changeSummary: string;
  status: SkillVersionStatus;
  createdBy: string;
  createdAt: string;
}

export interface Runbook {
  id: string;
  slug: string;
  title: string;
  description: string;
  bodyMarkdown: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunbookStep {
  id: string;
  runbookId: string;
  stepOrder: number;
  skillId: string | null;
  skillSlug: string | null;
  title: string;
  expectedOutput: string;
  requiresHumanApproval: boolean;
}

// ─── Migration staging ──────────────────────────────────────────────────────

export type ImportProposedTarget = "lead" | "project" | "archive" | "knowledge" | "review";
export type ImportStatus = "staged" | "mapped" | "imported" | "skipped";

export interface TempLeadImport {
  recordId: string;
  raw: Record<string, unknown>;
  proposedTarget: ImportProposedTarget;
  importStatus: ImportStatus;
  reviewNotes: string;
  importedAt: string;
}
