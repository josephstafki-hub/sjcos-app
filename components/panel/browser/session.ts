import type {TaskMetadata,BrowserStatus,BrowserPresence,BrowserReads} from '../../../lib/browser/web-types';
import type {BrowserModel} from './model';

/** No frame has a context generation on the frozen web wire. Keep the stream
 * closed across reset until a NEW authoritative detail/state establishes it. */
export function createFrameGate() {
 let revision=-1,generation=-1,minimum:number|null=null;
 return {
  reset(oldGeneration:number,newGeneration?:number){minimum=Math.max(oldGeneration+1,newGeneration??0);},
  observe(next:TaskMetadata){
   if(!Number.isSafeInteger(next.revision)||next.revision<1||!Number.isSafeInteger(next.context_generation)||next.context_generation<0||next.revision<revision||next.context_generation<generation)return false;
   if(minimum!==null&&next.context_generation<minimum)return false;
   revision=next.revision;generation=next.context_generation;minimum=null;return true;
  },
  ready:()=>generation>=0&&minimum===null
 };
}
export function browserFlags(flags:{enabled?:boolean;staff_enabled?:boolean}|null|undefined){return {enabled:flags?.enabled===true,staff_enabled:flags?.staff_enabled===true};}
/** Approved entries are not pending candidates. Missing provenance/deadlines
 * must never create an enabled approval from an old manifest. */
export function readReview(reads:Partial<Pick<BrowserReads,'candidates'|'expires_at'|'candidates_status'>>,serverOffset:number) {
 const candidates=reads.candidates??[];
 const deadlines=candidates.map(c=>c.server_deadline?Date.parse(c.server_deadline):NaN);
 if(reads.expires_at)deadlines.push(Date.parse(reads.expires_at));
 return {readUrls:candidates.map(c=>c.url),readExpired:reads.candidates_status!=='pending'||!candidates.length||deadlines.some(d=>!Number.isFinite(d)||d<=Date.now()+serverOffset)};
}
/** Stopping local presentation is immediate; planned attendance preservation
 * requires the authenticated close ACK before cancelling the GET transport. */
export async function closeBrowserStream(ack:()=>Promise<unknown>,abort:()=>void){try{await ack();}finally{abort();}}

/** These are display projections, never input/control authority. */
export function browserProjection(d:Partial<BrowserStatus>):Partial<Pick<BrowserModel,'state'|'queuePosition'|'watchingOwner'|'ownerName'|'windowCount'|'controller'>> {
 const offered=d.offer_status==='offered'?'offer':d.offer_status==='expired'?'offer_expired':d.offer_status==='queue_expired'?'queue_expired':undefined;
 return {state:(d.projection_status==='available'?d.state_reason:undefined)??offered??undefined,queuePosition:d.queue_position??null,watchingOwner:d.watching_owner===true,ownerName:d.owner_label??undefined,windowCount:d.window_count??undefined,controller:d.controller==='owner'?'owner' as const:d.controller==='other_device'?'other_device' as const:undefined};
}
export function renewControl(token:{value:string;expires:number}|null,detail:Pick<BrowserStatus,'context_generation'|'task'>,r:BrowserPresence) {
 if(!token||r.context_generation!==detail.context_generation||r.control_epoch!==detail.task.control_epoch||!r.control_expires_at)return null;
 const deadline=Date.parse(r.control_expires_at),serverTime=Date.parse(r.server_time);
 if(!Number.isFinite(deadline)||!Number.isFinite(serverTime)||deadline<=serverTime)return null;
 return {...token,expires:Date.now()+deadline-serverTime};
}

/** A pane may leave before response headers arrive. Stop presentation at once,
 * wait briefly for the authenticated bootstrap, then ACK before aborting. A
 * failed/missing bootstrap or ACK remains an accidental transport loss. */
export function createStreamLifecycle(abort:()=>void) {
 type Binding=Pick<import('../../../lib/browser/web-types').Frame,'stream_id'|'stream_generation'>;
 let binding:Binding|undefined,settle:(value:Binding|null)=>void,closing:Promise<void>|undefined;
 const ready=new Promise<Binding|null>(resolve=>{settle=resolve;});
 return {
  bind(value:Binding){if(!binding){binding=value;settle(value);}},
  fail(){settle(null);},
  close(ack:(binding:Binding)=>Promise<unknown>){
   return closing??=(async()=>{
    const timeout=setTimeout(()=>settle(null),5000);
    try{const value=binding??await ready;if(!value)throw Error('BROWSER_STREAM_STALE');await ack(value);}finally{clearTimeout(timeout);abort();}
   })();
  }
 };
}
