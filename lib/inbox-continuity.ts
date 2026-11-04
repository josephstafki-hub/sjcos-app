import type { InboxThread,ThreadReader } from './inbox';
/** Reconcile already-loaded correspondence with persisted thread↔lead links.
 * Does not fetch Gmail or infer that a manually linked message was sent. */
export function attachInquiryContinuity(threads:InboxThread[],readers:Record<string,ThreadReader>):void {
 for(const formThread of threads.filter(t=>t.channel==='site_form')){
  const form=readers[formThread.id]?.form;if(!form)continue;
  const addresses=(value:string)=>Array.from(value.toLowerCase().match(/[^\s<>,;]+@[^\s<>,;]+/g)??[]);
  // Capture explicit persisted associations before adding address-only history.
  const linkedThreadIds=form.linkedThreadIds??=form.conversations?.map(c=>c.id)??[];
  const related=threads.filter(t=>t.channel==='email'&&(
   t.linkedType==='lead'&&Boolean(formThread.linkedSlug)&&t.linkedSlug===formThread.linkedSlug ||
   Boolean(form.email)&&readers[t.id]?.messages.some(m=>[m.fromEmail,...(m.to?[m.to]:[]),...(m.cc ?? [])].some(address=>Array.from(address?.toLowerCase().match(/[^\s<>,;]+@[^\s<>,;]+/g) ?? []).includes(form.email.toLowerCase())))
  ));
  form.conversations=[...new Map([...(form.conversations ?? []),...related.map(t=>({id:t.id,subject:t.subject}))].map(t=>[t.id,t])).values()];
  for(const email of related){email.websiteInquiry=formThread.id;if(readers[email.id])readers[email.id].websiteInquiry=formThread.id;}
  const createdAt=Date.parse(form.createdAt??'');
  const sent=Boolean(form.contactedAt&&linkedThreadIds.length)||related.some(t=>readers[t.id]?.messages.some(m=>
    m.outbound&&Boolean(form.email)&&addresses(m.to??'').includes(form.email.toLowerCase())&&(
      linkedThreadIds.includes(t.id)||t.linkedType==='lead'&&Boolean(formThread.linkedSlug)&&t.linkedSlug===formThread.linkedSlug||
      Number.isFinite(createdAt)&&typeof m.date==='number'&&m.date>=createdAt
    )
  ));
  if(sent){form.contacted=true;formThread.needsMeReason='Contacted';if(formThread.view==='needs_reply')formThread.view='awaiting_them';}
 }
}
