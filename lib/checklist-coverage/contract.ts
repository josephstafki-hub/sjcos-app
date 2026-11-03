export const COVERAGE_CONTRACT_VERSION = 3 as const;

export type CoverageState = 'open' | 'partial' | 'covered' | 'not_applicable';
export type SessionKind   = 'discovery_call' | 'in_home_consult';
export type EngineMode    = 'call' | 'consult';            // consult = suggest-only, never auto-tick
export type Speaker       = 'joe' | 'client' | 'staff' | 'unknown';
export type TimingBasis   = 'provider_audio' | 'receiver_relative' | 'receipt_only';
export type SegmentSource = 'telnyx_live' | 'telnyx_recording' | 'media_stream' | 'consult_audio';
export type EvaluateAt    = 'live' | 'section_leave' | 'wrap_up' | 'final';
export type CoverageSource = 'manual' | 'ai' | 'ai_confirmed' | 'prior_record';

export interface ChecklistItem {
  id: string;                 // stable uuid; survives wording changes
  key: string;                // 'budget', or consult 'kitchen.asked_water_history'
  label: string;
  covered_when?: string;
  partial_when?: string;
  reminder: string;           // exact card sentence
  partial_reminders: Record<string, string>;   // component key → sentence
  questions: string[];        // ≤2
  components: { key: string; label: string; required: boolean }[];
  fact_target: string | null; // lead fact key from the allowlist, or null
  optional: boolean;
  enabled: boolean;
  reminder_enabled: boolean;
  reminder_priority: number;  // lower = first
  section_key: string | null; // consult section; null for calls
  source_ref: string | null;  // consult form field id(s) it compiles from
}

export interface ChecklistVersion {
  id: string; definition_key: string; kind: SessionKind; version: number;
  contract_version: 3; items: ChecklistItem[]; wrap_up_phrases: string[];
}

export interface ItemIdentity {
  session_id: string; item_id: string; definition_version_id: string;
  definition_item_id: string; instance_id: string;
}
export interface SegmentIdentity {
  session_id: string; source: SegmentSource; source_event_id: string; revision: number;
}
export interface Segment extends SegmentIdentity {
  id: string; seq: number; source_ref: string | null;
  supersedes_id: string | null;
  speaker: Speaker; track: 'inbound' | 'outbound' | 'mono' | null;
  timing_basis: TimingBasis; start_ms: number; end_ms: number;   // from capture_origin_at
  text: string; confidence: number | null; section_key: string | null;
  received_at: string; cleared_at: string | null;               // cleared = text removed (retention / request)
}

/** The evidence shape — identical in both plans. `quote` must be an exact substring of the segment text at that revision. */
export interface Evidence {
  session_id: string; segment_id: string; revision: number; quote: string;
  start_ms: number; end_ms: number; speaker: Speaker; timing_basis: TimingBasis;
}

export interface Suggestion {
  state: 'partial' | 'covered';
  component_states: Record<string, CoverageState>;
  value: unknown; evidence: Evidence[]; confidence: number;
  model: string; prompt_version: string; created_at: string;
}

export interface ItemCoverage {
  item_id: string; state: CoverageState;
  component_states: Record<string, CoverageState>;
  value: unknown | null; evidence: Evidence[];
  source: CoverageSource; suggestion: Suggestion | null;
  manual_lock: boolean;
  conflict: { fact_key: string; existing: unknown; proposed: unknown } | null;
  reason: string | null; revision: number; updated_at: string;
}

export interface EngineInput {
  contract_version: 3;
  version: ChecklistVersion;
  session: { id: string; kind: SessionKind; mode: EngineMode;
             consent: 'granted' | 'not_required'; started_at: string;
             capture_origin_at: string | null; revision: number; capture_epoch: number;
             prior: Record<string, { value: unknown; fact_key: string }> };
  items: ItemIdentity[];          // active runtime members, snapshot at session.revision
  coverage: ItemCoverage[];
  segments: Segment[];          // new since cursor + ≤60 s / 3,000 tokens of context
  cursor_seq: number;
  evaluate_at: EvaluateAt;
  section_key?: string | null;  // consult: the section just left
  now: string;
}

export type ItemChange =
  | { kind: 'commit';  item_id: string; state: CoverageState; component_states: Record<string, CoverageState>; value: unknown; evidence: Evidence[]; confidence: number }
  | { kind: 'suggest'; item_id: string; suggestion: Suggestion }
  | { kind: 'downgrade'; item_id: string; to: 'open' | 'partial'; reason: string }   // a correction removed the evidence
  | { kind: 'clear_suggestion'; item_id: string; reason: string };

export interface EngineOutput {
  contract_version: 3; session_id: string; base_revision: number; capture_epoch: number; new_cursor_seq: number;
  changes: ItemChange[];
  fact_candidates: { item_id: string; fact_key: string; value: unknown; evidence: Evidence[] }[];
  reminder_candidate: { item_id: string; trigger: 'topic_moved_on' | 'wrap_up'; evidence: Evidence[]; sentence: string } | null; // discovery_call only
  diagnostics: { lag_ms: number; model: string | null; prompt_version: string; usage: { input_tokens: number; output_tokens: number; cache_read: number; cache_write: number; cost_usd_equiv: number } | null; error: string | null };
}

export const COVERAGE_MARKS = {
 coverage: { open: ['○','Open'], partial: ['◐','Partly'], covered: ['✓','Covered'], not_applicable: ['—','N/A'], suggestion: ['◌','Heard — confirm'], conflict: ['!','Conflict'], return_visit: ['⤳','Return visit'] },
 ready: { done: ['✓','Done'], not_yet: ['○','Not yet'], problem: ['!','Problem'] },
} as const;
export const COVERAGE_STATES: readonly CoverageState[] = ['open','partial','covered','not_applicable'];
export function safeRevision(value: unknown): number {
 if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('CHECKLIST_INVALID_REVISION');
 return value;
}
/** Shared v3 boundary: pinned runtime membership plus current exact evidence.
 * Consumers must additionally validate their form instance/assignment in SQL. */
export function validateV3(input: EngineInput): void {
 if (input.contract_version !== 3 || input.version.contract_version !== 3) throw new Error('CHECKLIST_CONTRACT_VERSION');
 safeRevision(input.session.revision); safeRevision(input.session.capture_epoch); safeRevision(input.cursor_seq);
 const seen = new Set<string>();
 for (const item of input.items) {
  if (item.session_id !== input.session.id || item.definition_version_id !== input.version.id || !input.version.items.some(d => d.id === item.definition_item_id) || seen.has(item.item_id)) throw new Error('CHECKLIST_INVALID_MEMBERSHIP');
  if (input.session.kind === 'discovery_call' && item.instance_id !== input.session.id) throw new Error('CHECKLIST_INVALID_INSTANCE');
  seen.add(item.item_id);
 }
 for (const segment of input.segments) {
  safeRevision(segment.seq); safeRevision(segment.revision);
  if (segment.session_id !== input.session.id || segment.start_ms < 0 || segment.end_ms < segment.start_ms || !Number.isSafeInteger(segment.start_ms) || !Number.isSafeInteger(segment.end_ms)) throw new Error('CHECKLIST_INVALID_SEGMENT');
  if (segment.source === 'consult_audio' && !/^[0-9a-f-]{36}:[0-9a-f-]{36}:(0|[1-9][0-9]*)$/.test(segment.source_event_id)) throw new Error('CHECKLIST_INVALID_SOURCE');
 }
 for (const c of input.coverage) {
  if (!seen.has(c.item_id) || !COVERAGE_STATES.includes(c.state)) throw new Error('CHECKLIST_INVALID_MEMBERSHIP');
  safeRevision(c.revision);
  for (const evidence of [...c.evidence, ...(c.suggestion?.evidence ?? [])]) validateEvidence(evidence,input.session.id,input.segments);
 }
}
export const validateContractV3 = validateV3;
export function validateEvidence(e: Evidence, sessionId: string, segments: Segment[]): void {
 const s=segments.find(s=>s.id===e.segment_id && s.revision===e.revision && s.session_id===sessionId);
 if (!s || e.session_id!==sessionId || s.cleared_at || !e.quote || !s.text.includes(e.quote) || segments.some(n=>n.supersedes_id===s.id) || e.start_ms!==s.start_ms || e.end_ms!==s.end_ms || e.speaker!==s.speaker || e.timing_basis!==s.timing_basis) throw new Error('CHECKLIST_STALE_EVIDENCE');
}
