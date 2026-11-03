import type { ChecklistItem, ItemCoverage, ItemIdentity, CoverageState } from './contract.ts';
import { safeRevision, COVERAGE_STATES } from './contract.ts';
export interface ManualOperation { session_id:string; item_id:string; state:CoverageState; value:unknown; reason:string|null; expected_revision:number; operation_id:string }
export interface ChecklistSnapshot {
 session: {id:string;lead_id:string|null;call_id:string|null;revision:number;status:string;started_at:string;ended_at:string|null;consent_status:string;capture:'manual'|'live';manual_notes:string;deletion_epoch:number};
 version: {id:string;definition_id:string;version:number;items:ChecklistItem[]};
 rows: {identity:ItemIdentity;coverage:ItemCoverage;spec:ChecklistItem;prior:{value:unknown;fact_key:string}|null}[];
}
export type CommandResult = {ok:true;session_id:string;revision:number} | {ok:false;code:'CHECKLIST_CONFLICT';status:409;current:ChecklistSnapshot;proposed:unknown};
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(value:string):string { if (!UUID.test(value)) throw new Error('CHECKLIST_INVALID_ID'); return value; }
export function validateManualOperation(op:ManualOperation):void {
 uuid(op.session_id);uuid(op.item_id);uuid(op.operation_id);safeRevision(op.expected_revision);
 if (!COVERAGE_STATES.includes(op.state) || (op.state==='not_applicable' && !op.reason?.trim()) || JSON.stringify(op.value ?? null).length>16000) throw new Error('CHECKLIST_INVALID_ANSWER');
}
export function checklistSummary(snapshot:ChecklistSnapshot) {
 const counts={covered:0,partial:0,open:0,not_applicable:0};
 for(const row of snapshot.rows) counts[row.coverage.state]++;
 return {counts,rows:snapshot.rows,notes:snapshot.session?.manual_notes ?? '',everythingCovered:counts.open===0 && counts.partial===0,subject:'A few details for your project',aiDraft:false as const};
}
export const OFFLINE_QUEUE = {database:'sjcos-calls',storePrefix:'pending:',expiresAfterMs:86400000,offlineShell:false} as const;
/** Validate recovered queue ownership/expiry before presenting it. No automatic replay. */
export function recoverPending<T>(queue:{user_id:string;created_at:number;operations:T[]},userId:string,now=Date.now()):T[] {
 return queue.user_id===userId && queue.created_at<=now && now-queue.created_at<OFFLINE_QUEUE.expiresAfterMs ? queue.operations : [];
}

export function priorToValue(key:string,value:unknown):unknown {
 if(value!==null && typeof value==='object') return value;
 const text=String(value ?? '');
 switch(key) {
 case 'work':return {scope:text};
 case 'budget':return {response:'stated',amount_text:text};
 case 'timeline':return {text};
 case 'address':return {street:text,confirmed:true};
 case 'other_bids':return {answer:/^no\b/i.test(text)?'no':/^yes\b/i.test(text)?'yes':'undecided',detail:text};
 default:return value;
 }
}
export const INSURANCE_WARNING='Don’t offer to cover the deductible, don’t explain their coverage, don’t deal with the adjuster for them (Minn. Stat. § 325E.66).';
