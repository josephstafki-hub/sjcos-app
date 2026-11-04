/** Evidence supports full whole-house/addition visits; ops retain their 256 KiB cap. */
export const EVIDENCE_REQUEST_LIMIT = 2 * 1024 * 1024;
export function parseConsultRequest(raw: string): unknown {
 if (Buffer.byteLength(raw) > EVIDENCE_REQUEST_LIMIT) throw new Error('evidence_too_large');
 const body = JSON.parse(raw);
 if (body.command !== 'evidence' && Buffer.byteLength(raw) > 256 * 1024) throw new Error('batch_too_large');
 return body;
}
/** Only recognizable browser network failures may be called “no signal”. */
export function isNetworkFailure(e: unknown): boolean {
 return e instanceof Error && /^(Failed to fetch|fetch failed|NetworkError(?: when attempting to fetch resource\.)?|Load failed|Network request failed)$/i.test(e.message);
}
export function transportCode(e: unknown): string {
 return isNetworkFailure(e) ? 'no_signal' : e instanceof Error ? (/Illegal invocation/i.test(e.message) ? 'transport_invocation' : e.message || 'transport_unknown') : 'transport_unknown';
}
export {transientClose} from './close-errors.ts';
/** Bound every transport attempt so a stalled radio cannot hold Send/Close forever. */
export async function deadlineFetch(request:typeof fetch,input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]):Promise<Response> {
 const controller=new AbortController();
 let timer: ReturnType<typeof setTimeout>;
 const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('http_408'));},15_000);});
 try {
  // Consume inside the deadline. Racing also settles fetch implementations which ignore abort.
  return await Promise.race([expired,(async()=>{
   const response=await request(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal});
   const bytes=await response.arrayBuffer();
   return new Response(response.status===204||response.status===205||response.status===304?null:bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
  })()]);
 } catch(e){if(controller.signal.aborted)throw new Error('http_408');throw e;}
 finally{clearTimeout(timer!);}
}
