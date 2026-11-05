/** Immutable allocation ledger, not a proxy or proof of parser integration.
 * Call reserveFlow BEFORE body collection, consume/audit, or upstream bytes.
 * Charge every allocation BEFORE creating it. Always releaseFlow in finally,
 * including after downstream drain, revoke, disconnect, exception or deadline.
 */
export const MiB=1024*1024;
export const LIMITS=Object.freeze({request:56*MiB,response:112*MiB,transport:24*MiB,
  responseReservation:56*MiB,responsePayload:25*MiB,requestPayload:25*MiB,
  baseline:144*MiB,headroom:48*MiB,accountedPeak:336*MiB,memoryMax:384*MiB,
  chunk:64*1024,flowMs:60_000,bodyReadMs:15_000,responseSlots:2});
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const identifier=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(x);
const flowFor=(b,id)=>Object.hasOwn(b.flows,id)?b.flows[id]:null;
function freeze(b) {
  for(const f of Object.values(b.flows)) Object.freeze(f);
  Object.freeze(b.flows); Object.freeze(b.pools); Object.freeze(b.contextOrder); return Object.freeze(b);
}
export function createBudget({baselineBytes,contextOrder}={}) {
  if(!integer(baselineBytes)||baselineBytes>LIMITS.baseline||!Array.isArray(contextOrder)||contextOrder.length<1||contextOrder.length>2||contextOrder.some(x=>!identifier(x))||new Set(contextOrder).size!==contextOrder.length) throw new Error('BROWSER_RESOURCE_LIMIT');
  return freeze({baselineBytes,contextOrder:[...contextOrder],nextContext:contextOrder[0],pools:{request:0,response:0,transport:0},flows:{}});
}
const refusal=(budget,code='BROWSER_BUFFER_BUSY')=>({ok:false,code,budget,retry:false,queue:false});
const update=(b,id,f,pools=b.pools)=>freeze({...b,flows:{...b.flows,[id]:f},pools:{...pools}});
function projected(b,pools) { return b.baselineBytes+pools.request+pools.response+pools.transport; }
export function reserveFlow(b,{id,contextId,now,requestBytes=0,requestCopies=1,requestOverheadBytes=0,transportBytes=0,consumedWrite=false}={}) {
  if(!identifier(id)||Object.hasOwn(b.flows,id)||!b.contextOrder.includes(contextId)||!integer(now)||!integer(requestBytes)||requestBytes>LIMITS.requestPayload||!integer(requestCopies)||requestCopies<1||requestCopies>2||!integer(requestOverheadBytes)||!integer(transportBytes)||typeof consumedWrite!=='boolean') return refusal(b,'BROWSER_BAD_INPUT');
  const live=Object.values(b.flows);
  if(live.length>=2 || (b.contextOrder.length===2 && live.some(x=>x.contextId===contextId))) return refusal(b);
  const request=requestBytes*requestCopies+requestOverheadBytes;
  const pools={request:b.pools.request+request,response:b.pools.response+LIMITS.responseReservation,transport:b.pools.transport+transportBytes};
  if(pools.request>LIMITS.request||pools.response>LIMITS.response||pools.transport>LIMITS.transport||projected(b,pools)>LIMITS.accountedPeak) return refusal(b);
  const flow={contextId,deadline:now+LIMITS.flowMs,request,response:LIMITS.responseReservation,
    transport:transportBytes,responseAllocated:6*MiB,responseWire:0,incoming:0,outgoing:0,consumedWrite};
  const nextContext=b.contextOrder[(b.contextOrder.indexOf(contextId)+1)%b.contextOrder.length];
  return {ok:true,budget:freeze({...b,nextContext,pools,flows:{...b.flows,[id]:flow}})};
}
/** Caller batches simultaneous candidates; no request bodies are queued here.
 * Rotate first opportunity each round. Refused candidates require a fresh
 * human operation, never an automatic request/action retry. */
export function admitContenders(b,candidates) {
  const start=b.contextOrder.indexOf(b.nextContext);
  const order=[...b.contextOrder.slice(start),...b.contextOrder.slice(0,start)];
  const results=[]; let budget=b;
  for(const c of [...candidates].sort((a,z)=>order.indexOf(a.contextId)-order.indexOf(z.contextId))) {
    const r=reserveFlow(budget,c); results.push({id:c.id,...r}); budget=r.budget;
  }
  budget=freeze({...budget,nextContext:order[1%order.length]});
  return {budget,results};
}
/** Additional request/transport representations must be reserved before copy.
 * Response allocations consume the existing fixed reservation, never borrow. */
export function chargePool(b,id,pool,bytes) {
  const f=flowFor(b,id); if(!f||!['request','response','transport'].includes(pool)||!integer(bytes)) return refusal(b,'BROWSER_BAD_INPUT');
  if(pool==='response') {
    if(f.responseAllocated+bytes>LIMITS.responseReservation) return refusal(b);
    return {ok:true,budget:update(b,id,{...f,responseAllocated:f.responseAllocated+bytes})};
  }
  const pools={...b.pools,[pool]:b.pools[pool]+bytes};
  if(pools[pool]>LIMITS[pool]||projected(b,pools)>LIMITS.accountedPeak) return refusal(b);
  return {ok:true,budget:update(b,id,{...f,[pool]:f[pool]+bytes},pools)};
}
export function releaseFlow(b,id) {
  if(!Object.hasOwn(b.flows,id)) return b;
  const f=b.flows[id],flows={...b.flows}; delete flows[id];
  return freeze({...b,flows,pools:{request:b.pools.request-f.request,response:b.pools.response-f.response,transport:b.pools.transport-f.transport}});
}
function terminal(b,id,code) {
  const outcome=flowFor(b,id)?.consumedWrite?'unknown':'failed';
  return {...refusal(releaseFlow(b,id),code),outcome};
}
/** Set conservatively before dispatch/consume can possibly commit. Never clear
 * this bit to refund/retry; confirmation belongs to the durable action ledger. */
export function markFlowConsumed(b,id,now) {
  const f=flowFor(b,id);
  if(!f||!integer(now)) return refusal(b,'BROWSER_BAD_INPUT');
  if(now>=f.deadline) return terminal(b,id,'BROWSER_FLOW_EXPIRED');
  return {ok:true,budget:update(b,id,{...f,consumedWrite:true})};
}
/** Explicit non-deadline failure path for disconnect/revoke/controller loss or
 * parser/dispatcher exception. Persist outcome before dropping runtime buffers. */
export function abortFlow(b,id) {
  return terminal(b,id,'BROWSER_SERVICE_UNAVAILABLE');
}
export function validateResponseHeaders({length=null,encoding='identity',ambiguous=false,upgrade=false,trailers=false}={}) {
  if(ambiguous||upgrade||trailers||encoding!=='identity'||(length!==null&&(!integer(length)||length>LIMITS.responsePayload))) return {ok:false,code:'BROWSER_RESPONSE_REJECTED'};
  return {ok:true};
}
export function accountResponseChunk(b,id,{bytes,encoding,now,copies=2}={}) {
  const f=flowFor(b,id);
  if(!f||!integer(bytes)||!integer(now)||!integer(copies)||copies<1||copies>2) return terminal(b,id,'BROWSER_BAD_INPUT');
  if(now>=f.deadline) return terminal(b,id,'BROWSER_FLOW_EXPIRED');
  if(encoding!=='identity'||f.responseWire+bytes>LIMITS.responsePayload||bytes>LIMITS.chunk) return terminal(b,id,'BROWSER_RESPONSE_REJECTED');
  const r=chargePool(b,id,'response',bytes*copies);
  if(!r.ok) return terminal(b,id,'BROWSER_BUFFER_BUSY');
  return {ok:true,budget:update(r.budget,id,{...r.budget.flows[id],responseWire:f.responseWire+bytes})};
}
export function accountTransport(b,id,{bytes,direction,now}={}) {
  const f=flowFor(b,id);
  if(!f||!integer(bytes)||!integer(now)||!['incoming','outgoing'].includes(direction)) return refusal(b,'BROWSER_BAD_INPUT');
  if(now>=f.deadline) return terminal(b,id,'BROWSER_FLOW_EXPIRED');
  // Nothing read/allocated when high water is reached. Integrator pauses socket.
  if(f[direction]+bytes>LIMITS.chunk) return {...refusal(b),pauseReads:true};
  const r=chargePool(b,id,'transport',bytes);
  if(!r.ok) return {...r,pauseReads:true};
  return {ok:true,pauseReads:f[direction]+bytes===LIMITS.chunk,budget:update(r.budget,id,{...r.budget.flows[id],[direction]:f[direction]+bytes})};
}
export function drainTransport(b,id,{bytes,direction}={}) {
  const f=flowFor(b,id);
  if(!f||!integer(bytes)||!['incoming','outgoing'].includes(direction)||bytes>f[direction]) return refusal(b,'BROWSER_BAD_INPUT');
  return {ok:true,pauseReads:false,budget:update(b,id,{...f,[direction]:f[direction]-bytes,transport:f.transport-bytes},{...b.pools,transport:b.pools.transport-bytes})};
}
export function expireFlows(b,now) {
  if(!integer(now)) throw new Error('BROWSER_BAD_INPUT');
  let budget=b; const outcomes=[];
  for(const [id,f] of Object.entries(b.flows)) if(now>=f.deadline) {
    outcomes.push({id,outcome:f.consumedWrite?'unknown':'failed',retry:false});
    budget=releaseFlow(budget,id);
  }
  return {budget,outcomes};
}
