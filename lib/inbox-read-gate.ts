/** Per-mailbox concurrency gate for on-demand Gmail reads.
 *  Server Actions used to serialize these by accident; a GET route runs them in
 *  parallel, and fast thread switching then bursts Joe's per-minute Gmail quota
 *  (shared with the live site's cron jobs). Two in flight per key, the rest queue. */
const active = new Map<string, number>();
const waiting = new Map<string, Array<() => void>>();
function wakeNext(key:string) {
  const queue=waiting.get(key),next=queue?.shift();
  if(queue&&!queue.length)waiting.delete(key);
  next?.();
}

export async function withReadGate<T>(key: string, fn: () => Promise<T>, limit = 2, signal?:AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  while ((active.get(key) ?? 0) >= limit) {
    await new Promise<void>((resolve,reject) => {
      const queue = waiting.get(key) ?? [];
      const ready=()=>{signal?.removeEventListener('abort',abort);resolve();};
      const abort=()=>{const index=queue.indexOf(ready);if(index>=0)queue.splice(index,1);if(!queue.length)waiting.delete(key);reject(signal?.reason);};
      queue.push(ready);
      waiting.set(key, queue);
      signal?.addEventListener('abort',abort,{once:true});
    });
    if(signal?.aborted){if((active.get(key)??0)<limit)wakeNext(key);signal.throwIfAborted();}
  }
  active.set(key, (active.get(key) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const left = (active.get(key) ?? 1) - 1;
    if (left > 0) active.set(key, left); else active.delete(key);
    wakeNext(key);
  }
}

type SharedRead={promise:Promise<unknown>;controller:AbortController;readers:number};
const inflight=new Map<string,SharedRead>();
/** Share identical reads without tying every subscriber to the first request's
 * abort signal. Once all readers leave, the gate skips queued provider work. */
export function coalesceInboxRead<T>(key:string,fn:(signal:AbortSignal)=>Promise<T>,signal?:AbortSignal):Promise<T> {
  if(signal?.aborted)return Promise.reject(signal.reason);
  let shared=inflight.get(key);
  if(!shared){
    const controller=new AbortController();
    shared={controller,readers:0,promise:Promise.resolve().then(()=>{controller.signal.throwIfAborted();return fn(controller.signal);})};
    inflight.set(key,shared);
    const entry=shared;
    const cleanup=()=>{if(inflight.get(key)===entry)inflight.delete(key);};
    entry.promise.then(cleanup,cleanup);
  }
  const entry=shared;entry.readers++;
  return new Promise<T>((resolve,reject)=>{
    let finished=false;
    const release=()=>{
      if(finished)return false;finished=true;signal?.removeEventListener('abort',abort);
      // Keep already-started provider work coalesced until it settles, even if
      // its viewers leave and return. A queued read aborts before provider IO.
      if(--entry.readers===0)entry.controller.abort();
      return true;
    };
    const abort=()=>{if(release())reject(signal?.reason);};
    signal?.addEventListener('abort',abort,{once:true});
    entry.promise.then(value=>{if(release())resolve(value as T);},error=>{if(release())reject(error);});
  });
}
