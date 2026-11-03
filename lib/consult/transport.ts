/** Only recognizable browser network failures may be called “no signal”. */
export function isNetworkFailure(e: unknown): boolean {
 return e instanceof Error && /^(Failed to fetch|fetch failed|NetworkError(?: when attempting to fetch resource\.)?|Load failed|Network request failed)$/i.test(e.message);
}
export function transportCode(e: unknown): string {
 return isNetworkFailure(e) ? 'no_signal' : e instanceof Error ? (/Illegal invocation/i.test(e.message) ? 'transport_invocation' : e.message || 'transport_unknown') : 'transport_unknown';
}
export function transientClose(code: string): boolean { return code === 'no_signal' || /^http_(408|429|5\d\d)$/.test(code); }
/** Bound every transport attempt so a stalled radio cannot hold Send/Close forever. */
export async function deadlineFetch(request:typeof fetch,input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]):Promise<Response> {
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),15_000);
 try {return await request(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal});}
 catch(e){if(controller.signal.aborted)throw new Error('http_408');throw e;}
 finally{clearTimeout(timer);}
}
