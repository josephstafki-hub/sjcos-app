// Minimal asynchronous transactional IDB adapter for the stores used by consult.
// Transactions use a private copy and publish only on completion (including aborts).
export function memoryIndexedDB(){
 const stores=new Map();let exists=false,denied=false,quota=false;
 const factory={deny(v=true){denied=v;},quota(v=true){quota=v;},open(){const req={};setTimeout(()=>{if(denied){req.error=Error('storage_unavailable');req.onerror?.();return;}req.result={objectStoreNames:{contains:n=>stores.has(n)},createObjectStore:n=>stores.set(n,new Map()),close(){},transaction(name,mode){if(denied)throw Error('storage_unavailable');const copy=new Map(stores.get(name));let active=0,aborted=false,scheduled=false;
 const tx={error:null,abort(){aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore(){return {getAllKeys:()=>operation(()=>[...copy.keys()]),get:k=>operation(()=>structuredClone(copy.get(k))),put:(v,k)=>operation(()=>{if(quota)throw Error('storage_full');copy.set(k,structuredClone(v));return k;}),delete:k=>operation(()=>copy.delete(k))};}};
 function complete(){if(active||scheduled||aborted)return;scheduled=true;setTimeout(()=>{scheduled=false;if(active||aborted)return;if(mode==='readwrite')stores.set(name,copy);tx.oncomplete?.();},0);}
 function operation(fn){active++;const r={};setTimeout(()=>{if(aborted)return;try{r.result=fn();r.onsuccess?.();}catch(e){tx.error=e;tx.abort();}finally{active--;complete();}},0);return r;}queueMicrotask(complete);return tx;}};
 if(!exists){exists=true;req.onupgradeneeded?.();}req.onsuccess?.();},0);return req;}};return factory;
}
