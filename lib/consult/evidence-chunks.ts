/** Each map chunk merges under the exact current hash. Retries diff the durable baseline. */
export function mergeEvidence(before:unknown,patch:Record<string,unknown>):Record<string,unknown>{
 const out={...(before as Record<string,unknown>??{}),...patch};
 for(const key of ['skips','flags'])if(key in patch){
  const map={...((before as Record<string,unknown>)?.[key] as object??{})};
  for(const [id,value] of Object.entries(patch[key] as object))if(value===null)delete (map as Record<string,unknown>)[id];else (map as Record<string,unknown>)[id]=value;
  out[key]=map;
 }
 return out;
}
export function evidencePatches(before:unknown,after:Record<string,unknown>):Record<string,unknown>[] {
 const old=before as Record<string,unknown>|null;
 const scalar=Object.fromEntries(Object.entries(after).filter(([key,value])=>!['skips','flags'].includes(key)&&(!old||JSON.stringify(value)!==JSON.stringify(old[key]))));
 const chunks:Record<string,unknown>[]=[];
 let pending:Record<string,unknown>={...scalar,skips:{},flags:{}};
 for(const key of ['skips','flags']){
  const a=(old?.[key]??{}) as Record<string,unknown>, b=(after[key]??{}) as Record<string,unknown>;
  for(const id of new Set([...Object.keys(a),...Object.keys(b)])){
   if(JSON.stringify(a[id])===JSON.stringify(b[id]))continue;
   const candidate={...pending,[key]:{...(pending[key] as object??{}),[id]:b[id]??null}};
   if(new TextEncoder().encode(JSON.stringify(candidate)).length>32000){chunks.push(pending);pending={[key]:{[id]:b[id]??null}};}else pending=candidate;
  }
 }
 chunks.push(pending);return chunks;
}
