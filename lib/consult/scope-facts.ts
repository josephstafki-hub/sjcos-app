export type ConsultFactsState = 'reviewed' | 'unreviewed' | 'conflicted' | 'none';
                                          // v1 wire names: 'reviewed' = complete generation, 'unreviewed' = not complete
export type ScopeUnit = 'in' | 'sf' | 'lf' | 'ea';
export type FlagDisposition = 'price_it' | 'allowance' | 'sub_must_look' | 'not_an_issue';
export type NewWorkOrigin = 'client_requested_optional' | 'found_condition_required';

export interface ConsultScopeFactsV1 {
  schema_version: 1;
  project_id: string;                     // uuid
  scope_key: string;                      // a SCOPE_RULES key
  state: ConsultFactsState;               // export-level completion state (v1 wire names)
  source_version: {                       // null only when state = 'none'
    consult_id: string;                   // uuid
    review_revision: number;              // safe integer; = consults.completion_generation (v1 wire name)
    form_checksums: string[];             // pinned template/module checksums, sorted
    aggregate_hash: string;               // sha256 hex of this export's facts
  } | null;
  measurements: {
    key: string;                          // field key or derived key, e.g. 'floor_area'
    label: string;                        // SCOPE_RULES quantity label, e.g. 'Floor area'
    value: number;                        // 4 decimals stored; inches for 'in'
    unit: ScopeUnit;
    instance_ids: string[];               // distinct contributing consult_instances UUIDs, sorted
    answer_revisions: number[];           // server revisions of every contributing answer, ascending
  }[];
  conditions: { key: string; text: string; source_answer_id: string }[];   // existing-condition answers
  flags: { key: string; text: string; disposition: FlagDisposition | null;
           reason: string | null; decided_by: string | null; decided_at: string | null }[];
  photos: { file_id: string; shot_key: string; instance_id: string; caption: string }[];
                                          // ORIGINAL consult photo ids: owner-only preview, never attachable
  assumptions: { field_path: string; text: string; quantity: number | null; unit: ScopeUnit | null;
                 responsible_trade: string; verification_point: string }[];
  exclusions: { text: string; source_answer_id: string }[];
                                          // e.g. 'Field measure by supplier: Countertop templates'
  trade_walks: { trade: string; needed: boolean;
                 status: 'not_scheduled' | 'scheduled' | 'done' | 'not_needed'; work_item_id: string | null }[];
  permits: { authority: string | null; building_inspector: string | null;
             electrical_inspector: 'city' | 'dli' | null };
  rrp: { applies: boolean; firm_cert: string | null; renovator_name: string | null;
         renovator_cert: string | null; expiry: string | null };    // expiry ISO date
  new_work: { origin: NewWorkOrigin;
              label: 'Upsell — optional addition' | 'Scope change — required work'; text: string }[];
  conflicts: { key: string; source_ids: string[]; reason: string }[];
}
