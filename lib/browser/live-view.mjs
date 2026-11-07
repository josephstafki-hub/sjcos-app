/** Bounded binary frames and latest-only SSE; no CDP relay or frame replay. */
import {createHash,createHmac} from 'node:crypto';
import {BinaryHeader,validateEvent,Frame,ERROR_CODES} from './phase1-contracts.mjs';
import {canonical,digest,equal,fail,PRIVATE_HEADERS} from './web-transport.mjs';
export class LatestFrame{
 constructor(){this.latest=null;}
 put(frame,ack=()=>{}){try{this.latest=frame;}finally{ack();}}
 take(){const frame=this.latest;this.latest=null;return frame;}
 clear(){this.latest=null;}
}
export function encodeBinaryFrame(header,bytes,key){const signed={...header,signature:createHmac('sha256',key).update('browser-phase1-frame\0').update(canonical(header)).digest('hex')};BinaryHeader.parse(signed);if(bytes.length!==header.byte_length||createHash('sha256').update(bytes).digest('hex')!==header.sha256)fail('BROWSER_STREAM_STALE');const h=Buffer.from(canonical(signed));if(h.length>4096)fail('BROWSER_FRAME_TOO_LARGE');const n=Buffer.alloc(4);n.writeUInt32BE(h.length);return Buffer.concat([n,h,bytes]);}
export function decodeBinaryFrame(packet,key,binding){if(packet.length<4)fail('BROWSER_STREAM_STALE');const length=packet.readUInt32BE();if(length<1||length>4096||packet.length<length+4||packet.length>4096+4+300*1024)fail('BROWSER_FRAME_TOO_LARGE');const h=BinaryHeader.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(packet.subarray(4,length+4))));const {signature,...unsigned}=h;if(!equal(signature,createHmac('sha256',key).update('browser-phase1-frame\0').update(canonical(unsigned)).digest('hex')))fail('BROWSER_STREAM_STALE');for(const [k,v]of Object.entries(binding))if(h[k]!==v)fail('BROWSER_STREAM_STALE');const bytes=packet.subarray(length+4);if(bytes.length!==h.byte_length||createHash('sha256').update(bytes).digest('hex')!==h.sha256)fail('BROWSER_STREAM_STALE');return {header:h,bytes};}
/** Incremental reader caps bytes before concat and handles split/coalesced packets. */
export function binaryReader({key,binding,onFrame,onError}){let pending=Buffer.alloc(0),ended=false,lastSeq=-1;return chunk=>{if(ended)return;try{let offset=0;while(offset<chunk.length){const needed=pending.length<4?4:pending.length<4+pending.readUInt32BE()?4+pending.readUInt32BE():null;let total=needed;if(total===null){const h=BinaryHeader.parse(JSON.parse(pending.subarray(4,4+pending.readUInt32BE()).toString()));total=4+pending.readUInt32BE()+h.byte_length;}const n=Math.min(total-pending.length,chunk.length-offset);pending=Buffer.concat([pending,chunk.subarray(offset,offset+n)]);offset+=n;if(pending.length>=4&&(pending.readUInt32BE()<1||pending.readUInt32BE()>4096))fail('BROWSER_FRAME_TOO_LARGE');if(pending.length===total&&needed===null){const frame=decodeBinaryFrame(pending,key,binding);pending=Buffer.alloc(0);if(frame.header.seq<=lastSeq)fail('BROWSER_STREAM_STALE');lastSeq=frame.header.seq;onFrame(frame);}}}catch{ended=true;pending=Buffer.alloc(0);onError(Error('BROWSER_STREAM_STALE'));}};}
export const SSE_HEADERS={...PRIVATE_HEADERS,'Content-Type':'text/event-stream; charset=utf-8','X-Accel-Buffering':'no','Connection':'keep-alive'};
export function presentationFrame({header:h,bytes}){return Frame.parse({stream_id:h.stream_id,stream_generation:h.stream_generation,frame_id:h.frame_id,seq:h.seq,control_epoch:h.control_epoch,document_epoch:h.document_epoch,viewport:h.viewport,width:h.width,height:h.height,jpeg_base64:bytes.toString('base64')});}
/** subscribe emits signed/validated data through emit, returns an unsubscribe.
 * Every frame awaits current authorization; only one frame and one async check.
 */
/** @param {{authorize: Function, expiresAt: number, revision?: number, subscribe: Function, onClose?: (planned:boolean)=>unknown, registerClose?: Function, beforeFrame?: Function, signal?: AbortSignal, recheckMs?: number, rotateMs?: number, frameIntervalMs?: number, initial?: any}} options */
export async function createEventStream({authorize,expiresAt,revision=1,subscribe,registerClose,beforeFrame,onClose=(_planned)=>{},signal,recheckMs=5000,rotateMs=60000,frameIntervalMs=500,initial=null}){
 await authorize();if(expiresAt<=Date.now())fail('BROWSER_AUTH_EXPIRED');
 let controller,closed=false,unsubscribe=()=>{},poll,rotation,expiry,heartbeat,frames,busy=false,lastSeq=-1,windowAt=Date.now(),windowBytes=0,planned=false,seenRevision=initial?.revision??0;
 const latest=new LatestFrame(),encoder=new TextEncoder();
 const emit=(name,value)=>{if(closed)return false;const data=encoder.encode(`event: ${name}\ndata: ${JSON.stringify(validateEvent(name,value))}\n\n`);if((controller.desiredSize??0)<1)return false;controller.enqueue(data);return true;};
 const close=async(code='BROWSER_OK',isPlanned=false)=>{if(closed)return;planned=isPlanned;latest.clear();if(code!=='BROWSER_OK'){try{controller.enqueue(encoder.encode(`event: closed\ndata: ${JSON.stringify(validateEvent('closed',{code,revision}))}\n\n`));}catch{}}closed=true;for(const t of [poll,rotation,expiry,heartbeat,frames])clearInterval(t);signal?.removeEventListener('abort',abort);try{unsubscribe();}catch{}try{controller.close();}catch{}try{await onClose(planned);}catch{}};
 const abort=()=>{void close();};
 const check=async()=>{try{const current=await authorize();if(current?.state?.revision>seenRevision){seenRevision=current.state.revision;if(current.action&&(controller.desiredSize??0)>0){const state=validateEvent('state',current.state),action=validateEvent('action',current.action);controller.enqueue(encoder.encode(`event: state\ndata: ${JSON.stringify(state)}\n\nevent: action\ndata: ${JSON.stringify(action)}\n\n`));}else emit('state',current.state);}if(Date.now()>=expiresAt)fail('BROWSER_AUTH_EXPIRED');return !closed;}catch(e){await close(ERROR_CODES.includes(e?.message)?e.message:'BROWSER_AUTH_EXPIRED');return false;}};
 const stream=new ReadableStream({start(c){controller=c;},cancel(){return close();}},{highWaterMark:1});
 try{
  unsubscribe=await subscribe((name,value,ack=()=>{})=>{try{if(closed)return;if(name==='closed'){const terminal=validateEvent('closed',value);void close(terminal.code);return;}if(name==='frame')latest.put(validateEvent('frame',value));else if(name!=='file')emit(name,value);}catch{void close('BROWSER_STREAM_STALE');}finally{ack();}});
  if(closed){unsubscribe();return stream;}
  registerClose?.(()=>close('BROWSER_OK',true));
  if(initial)emit('state',initial);
  poll=setInterval(()=>{if(!busy){busy=true;void check().finally(()=>{busy=false;});}},Math.min(recheckMs,5000));
  frames=setInterval(async()=>{if(busy||closed)return;const frame=latest.take();if(!frame)return;busy=true;try{if(!await check())return;if(frame.seq<=lastSeq)return;const length=Buffer.byteLength(frame.jpeg_base64);if(Date.now()-windowAt>=1000){windowAt=Date.now();windowBytes=0;}if(windowBytes+length>1024*1024)return;if((controller.desiredSize??0)<1)return;if(beforeFrame){try{await beforeFrame(frame);}catch{await close('BROWSER_STREAM_STALE');return;}}if(closed)return;if(emit('frame',frame)){lastSeq=frame.seq;windowBytes+=length;}}finally{busy=false;}},frameIntervalMs);
  heartbeat=setInterval(()=>{if(!closed&&(controller.desiredSize??0)>0)controller.enqueue(encoder.encode(': heartbeat\n\n'));},10000);
  rotation=setTimeout(()=>{emit('reauth',{code:'BROWSER_STREAM_STALE',deadline:new Date(expiresAt).toISOString()});void close('BROWSER_OK',true);},Math.min(60000,rotateMs));
  expiry=setTimeout(()=>void close('BROWSER_AUTH_EXPIRED'),Math.max(0,expiresAt-Date.now()));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  return stream;
 }catch(e){await close('BROWSER_SERVICE_UNAVAILABLE');throw e;}
}
