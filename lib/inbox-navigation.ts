// All mounted inbox composers participate, including New and Forward.
const drafts=new Set<()=>Promise<boolean>>();
export function registerInboxDraft(flush:()=>Promise<boolean>) {
  drafts.add(flush);
  return ()=>{drafts.delete(flush);};
}
export async function flushInboxDrafts():Promise<boolean> {
  const results=await Promise.allSettled([...drafts].map(flush=>flush()));
  return results.every(r=>r.status==='fulfilled'&&r.value);
}
export async function guardInboxNavigation(navigate:()=>void,blocked:()=>void) {
  if(await flushInboxDrafts())navigate();else blocked();
}
