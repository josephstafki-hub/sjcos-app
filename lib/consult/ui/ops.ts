/**
 * Builders for the exact queue.ts op envelope (§12.2). Every op carries the device,
 * its epoch, the next sequence, the generation and the base revision the server
 * will check: consult revision for start/create/remove, field head revision for
 * answer/clear/resolve. No op is ever rebased silently.
 */
import { payloadHash, type ConsultOp, type QueueState } from '../queue.ts';
import type { SkipReason } from '../completeness.ts';
import { addrOf, type Baseline } from './model.ts';

export const uuid = (): string => crypto.randomUUID();

async function envelope(q: QueueState, device: string, type: ConsultOp['type'], target: ConsultOp['target'], payload: unknown, base: number): Promise<ConsultOp> {
  return { protocol_version: 1, client_event_id: uuid(), device_id: device, device_epoch: q.device_epoch, seq: q.next_seq, base_revision: base, generation: q.generation, type, target, payload, payload_sha256: await payloadHash(payload) };
}

export const startOp = (q: QueueState, device: string, b: Baseline) => envelope(q, device, 'start', null, {}, b.rev);

export function createInstanceOp(q: QueueState, device: string, b: Baseline, module_key: string, label: string, parent_id?: string | null) {
  const target: { instance_id: string; module_key: string; label: string; parent_id?: string } = { instance_id: uuid(), module_key, label };
  if (parent_id) target.parent_id = parent_id;
  return envelope(q, device, 'create_instance', target, {}, b.rev);
}
export const removeInstanceOp = (q: QueueState, device: string, b: Baseline, instance_id: string) => envelope(q, device, 'remove_instance', { instance_id } as unknown as ConsultOp['target'], {}, b.rev);

export interface AnswerPayload { summary_text?: string; status: 'answered' | 'skipped' | 'cleared'; value?: unknown; unit?: string; skip_reason?: SkipReason; skip_note?: string }
function clean(p: AnswerPayload): AnswerPayload {
  const out: AnswerPayload = { status: p.status };
  if (p.status === 'answered') out.value = p.value;
  if (p.unit) out.unit = p.unit;
  if (p.summary_text !== undefined) out.summary_text = p.summary_text;
  if (p.status === 'skipped') { out.skip_reason = p.skip_reason; if (p.skip_note?.trim()) out.skip_note = p.skip_note.trim(); }
  return out;
}
export function answerOp(q: QueueState, device: string, b: Baseline, instance_id: string, field_key: string, p: AnswerPayload) {
  const payload = clean(p);
  return envelope(q, device, payload.status === 'cleared' ? 'clear' : 'answer', { instance_id, field_key }, payload, b.fields[addrOf(instance_id, field_key)] ?? 0);
}
export function resolveOp(q: QueueState, device: string, instance_id: string, field_key: string, currentRevision: number, current_answer_id: string, proposed_answer_id: string, reason: string, answer: AnswerPayload) {
  return envelope(q, device, 'resolve', { instance_id, field_key }, { current_answer_id, proposed_answer_id, reason, answer: clean(answer) }, currentRevision);
}
export async function discardOp(q: QueueState, device: string, b: Baseline, rejected: ConsultOp, reason: string) {
  return envelope(q, device, 'discard_rejection', null, { event_id: rejected.client_event_id, hash: await payloadHash(rejected), reason }, b.rev);
}

export const decisionsOp = (q: QueueState, device: string, b: Baseline, draft: unknown) => envelope(q, device, 'decisions', null, draft, b.rev);


// Each patch is independently receipted; null explicitly clears a map entry.
export function decisionPatches(before: unknown, after: unknown): unknown[] {
 const old=(before??{}) as Record<string,unknown>, next=after as Record<string,unknown>;
 const patches:unknown[]=[];
 for(const key of Object.keys(next)){
  if(key==='skips'||key==='flags'){
   const a=(old[key]??{}) as Record<string,unknown>, b=(next[key]??{}) as Record<string,unknown>;
   for(const id of new Set([...Object.keys(a),...Object.keys(b)]))
    if(JSON.stringify(a[id])!==JSON.stringify(b[id]))patches.push({patch:{[key]:{[id]:b[id]??null}}});
  }else if(JSON.stringify(old[key])!==JSON.stringify(next[key]))patches.push({patch:{[key]:next[key]}});
 }
 const batches:unknown[]=[];
 let pending:Record<string,unknown>={};
 for(const item of patches as {patch:Record<string,unknown>}[]){
  const candidate={...pending};
  for(const [key,value] of Object.entries(item.patch))candidate[key]=(key==='skips'||key==='flags')?{...(pending[key] as object??{}),...(value as object)}:value;
  if(new TextEncoder().encode(JSON.stringify(candidate)).length>32000 && Object.keys(pending).length){batches.push({patch:pending});pending=item.patch;}
  else pending=candidate;
 }
 if(Object.keys(pending).length)batches.push({patch:pending});
 return batches;
}
