import {fileLossWarning} from './inbox-round12.ts';
// All mounted inbox composers participate, including New and Forward.
const filePackages=new Set<()=>number>();
export function registerInboxFiles(count:()=>number){filePackages.add(count);return()=>{filePackages.delete(count);};}
export function confirmInboxFileLoss(confirm:(message:string)=>boolean=message=>typeof window!=='undefined'&&window.confirm(message)) {
  const count=[...filePackages].reduce((n,get)=>n+get(),0);
  return !count||confirm(fileLossWarning(count));
}
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
  if(await flushInboxDrafts()){if(confirmInboxFileLoss())navigate();}else blocked();
}
