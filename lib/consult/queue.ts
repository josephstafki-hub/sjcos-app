/** Durable queue state machine. Caller commits returned state before reflecting a save. */
export interface AnswerAddress { instance_id: string; field_key: string }
export interface ConsultOp {
  protocol_version: 1; client_event_id: string; device_id: string; device_epoch: number;
  seq: number; base_revision: number; generation: number; type: string;
  target: AnswerAddress | { instance_id: string; module_key: string; parent_id?: string; label: string } | null;
  payload: unknown; payload_sha256: string;
}
export interface QueueEntry {
  op: ConsultOp; status: 'pending' | 'accepted' | 'conflict' | 'invalid' | 'locked' | 'quarantined' | 'deleted' | 'update_required';
  attempts: number; next_at: number; error_code?: string; revision?: number; conflict?: unknown;
}
export interface QueueState {
  protocol_version: 1; generation: number; device_epoch: number; deletion_epoch: number;
  next_seq: number; entries: QueueEntry[]; projection: Record<string, unknown>;
  blocked: 'signed_out' | 'revoked' | 'deleted' | 'update_required' | null;
}
export interface OpReceipt { id: string; status: number; revision?: number; error_code?: string; conflict?: unknown }
export function emptyQueue(generation: number, device_epoch: number, deletion_epoch = 0, last_ack_seq = 0): QueueState {
  return {protocol_version:1,generation,device_epoch,deletion_epoch,next_seq:last_ack_seq+1,entries:[],projection:{},blocked:null};
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string,unknown>)[key])}`).join(',')}}`;
  }
  throw new Error('invalid_json');
}
export async function payloadHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map((v)=>v.toString(16).padStart(2,'0')).join('');
}
export function enqueue(state: QueueState, op: ConsultOp, projection: Record<string,unknown>): QueueState {
  if (state.blocked) throw new Error(state.blocked);
  if(new TextEncoder().encode(canonicalJson(op)).byteLength>64*1024-512)throw new Error('batch_too_large');
  const duplicate=state.entries.find((entry)=>entry.op.client_event_id===op.client_event_id);
  if (duplicate) {
    if (canonicalJson(duplicate.op)!==canonicalJson(op)) throw new Error('idempotency_mismatch');
    return state;
  }
  if (op.protocol_version!==1) throw new Error('update_required');
  if (!Number.isSafeInteger(op.seq) || op.seq!==state.next_seq) throw new Error('sequence_gap');
  if (op.generation!==state.generation || op.device_epoch!==state.device_epoch) throw new Error('stale_epoch');
  if (!/^[0-9a-f]{64}$/.test(op.payload_sha256)) throw new Error('invalid_hash');
  return {...state,next_seq:state.next_seq+1,projection,entries:[...state.entries,{op,status:'pending',attempts:0,next_at:0}]};
}
export function nextBatch(state: QueueState, now: number): ConsultOp[] {
  if (state.blocked) return [];
  const batch: ConsultOp[]=[];let size=0;
  // A blocked earlier sequence prevents the later sequences from jumping past it.
  for (const entry of state.entries) {
    if (entry.status==='accepted') continue;
    if (entry.status!=='pending' || entry.next_at>now) break;
    const bytes=new TextEncoder().encode(canonicalJson(entry.op)).byteLength;
    if (batch.length===50 || size+bytes>64*1024-512) break;
    batch.push(entry.op);size+=bytes+1;
  }
  return batch;
}
export function retryDelay(attempt: number, random=Math.random): number {
  return Math.max(2_000, Math.round(Math.min(60_000,2_000*2**Math.min(10,Math.max(0,attempt))) * (0.5+Math.min(1,Math.max(0,random()))*0.5)));
}
export function applyReceipt(state: QueueState, receipt: OpReceipt, now: number, random=Math.random): QueueState {
  if (!state.entries.some((entry)=>entry.op.client_event_id===receipt.id)) throw new Error('unknown_receipt');
  const blocked=receipt.status===401?'signed_out':receipt.status===403?'revoked':receipt.status===410?'deleted':receipt.status===426?'update_required':state.blocked;
  const entries=state.entries.map((entry):QueueEntry=>{
    if (entry.status==='accepted') return entry;
    if (blocked) return {...entry,error_code:blocked,status:blocked==='deleted'?'deleted':blocked==='revoked'?'quarantined':blocked==='update_required'?'update_required':'locked'};
    if (entry.op.client_event_id!==receipt.id) return entry;
    const base={...entry,revision:receipt.revision,error_code:receipt.error_code,conflict:receipt.conflict};
    if (receipt.status>=200 && receipt.status<300) return {...base,status:'accepted'};
    if (receipt.status===409) return {...base,status:'conflict'};
    if (receipt.status===422) return {...base,status:'invalid'};
    if (receipt.status===423) return {...base,status:'locked'};
    if (receipt.status===426) return {...base,status:'update_required'};
    if (receipt.status===429 || receipt.status>=500 || receipt.status===0) return {...base,status:'pending',attempts:entry.attempts+1,next_at:now+retryDelay(entry.attempts,random)};
    return {...base,status:'invalid'};
  });
  return {...state,blocked,entries,projection:blocked?{}:state.projection};
}
export function applyServerEpoch(state:QueueState, generation:number, device_epoch:number, deletion_epoch:number):QueueState {
  if (deletion_epoch<state.deletion_epoch || generation<state.generation || device_epoch<state.device_epoch) throw new Error('stale_snapshot');
  if (deletion_epoch>state.deletion_epoch) return {...state,deletion_epoch,blocked:'deleted',projection:{},entries:state.entries.map((e)=>e.status==='accepted'?e:{...e,status:'deleted'})};
  if (generation!==state.generation || device_epoch!==state.device_epoch) return {...state,generation,device_epoch,projection:{},entries:state.entries.map((e)=>e.status==='accepted'?e:{...e,status:'conflict',error_code:'rebase_required'})};
  return state;
}
export interface CloseManifest {device:string;epoch:number;last_seq:number;required_blob_hashes:string[];initials_hash?:string|null;initials_hashes?:string[];local_pending:number}
export function closeManifest(state:QueueState,device:string,required_blob_hashes:string[],initials_hash:string|null|string[]):CloseManifest {
  if (state.blocked) throw new Error(state.blocked);
  return {device,epoch:state.device_epoch,last_seq:state.next_seq-1,required_blob_hashes:[...new Set(required_blob_hashes)].sort(),...(Array.isArray(initials_hash)?{initials_hashes:[...new Set(initials_hash)].sort()}:{initials_hash}),
    local_pending:state.entries.filter((e)=>e.status!=='accepted').length};
}
/** One drain at a time; a lost HTTP acknowledgement leaves the same op IDs pending. */
export class QueueDrain {
  private running=false;
  async drain(read:()=>Promise<QueueState>, send:(ops:ConsultOp[])=>Promise<OpReceipt[]>, commit:(receipts:OpReceipt[])=>Promise<void>, now=Date.now):Promise<void> {
    if(this.running) return;
    this.running=true;
    try {
      const batch=nextBatch(await read(),now());if(!batch.length) return;
      const receipts=await send(batch);
      const ids=new Set(batch.map((op)=>op.client_event_id));
      if(receipts.some((r)=>!ids.has(r.id)) || new Set(receipts.map((r)=>r.id)).size!==receipts.length) throw new Error('invalid_receipts');
      await commit(receipts);
    } finally {this.running=false;}
  }
}
