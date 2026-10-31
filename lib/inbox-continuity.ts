import type { InboxThread,ThreadReader } from './inbox';
/** Reconcile already-loaded correspondence with persisted thread↔lead links.
 * Does not fetch Gmail or infer that a manually linked message was sent. */
export function attachInquiryContinuity(threads:InboxThread[],readers:Record<string,ThreadReader>):void {
 for(const formThread of threads.filter(t=>t.channel==='site_form')){
  const form=readers[formThread.id]?.form;if(!form)continue;
  const related=threads.filter(t=>t.channel==='email'&&(
   t.linkedType==='lead'&&t.linkedSlug===formThread.linkedSlug ||
   Boolean(form.email)&&readers[t.id]?.messages.some(m=>[m.fromEmail,...(m.to?[m.to]:[]),...(m.cc ?? [])].some(address=>Array.from(address?.toLowerCase().match(/[^\s<>,;]+@[^\s<>,;]+/g) ?? []).includes(form.email.toLowerCase())))
  ));
  form.conversations=[...new Map([...(form.conversations ?? []),...related.map(t=>({id:t.id,subject:t.subject}))].map(t=>[t.id,t])).values()];
  for(const email of related){email.websiteInquiry=formThread.id;readers[email.id].websiteInquiry=formThread.id;}
  const sent=Boolean(form.contactedAt&&form.conversations.length)||related.some(t=>readers[t.id]?.messages.some(m=>m.outbound));
  if(sent){form.contacted=true;formThread.needsMeReason='Contacted';if(formThread.view==='needs_reply')formThread.view='awaiting_them';}
 }
}
