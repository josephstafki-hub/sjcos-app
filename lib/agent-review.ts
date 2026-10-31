export interface RunChange {
  id: string; label: string; href: string | null; action: string;
  evidence: string; at: string; fields: {field:string;before:string;after:string}[];
}
export interface RunReview { runId:string; status:string; log:string; durationSeconds:number; toolCount:number|null; changes:RunChange[] }
export function effectEvidence(e:{source:string;action:string;detail:Record<string,unknown>}): string {
  if(e.source==='hermes-inferred')return 'Inferred activity';
  if((e.source==='app'||e.detail.confirmed===true)&&e.action!=='touched')return 'Confirmed change';
  return 'Reported activity';
}
const FIELDS=new Set(['name','title','status','stage','due_at','snoozed_until','description','amount','number','quantity','unit_price','notes','email','phone','address','client_name','archived_at']);
export function visibleChangeFields(detail:Record<string,unknown>):RunChange['fields'] {
  const before=detail.before, after=detail.after;
  if(!before||!after||typeof before!=='object'||typeof after!=='object')return [];
  const a=before as Record<string,unknown>, b=after as Record<string,unknown>;
  return Object.keys(b).filter(k=>FIELDS.has(k)&&a[k]!==b[k]&&[a[k],b[k]].every(v=>v==null||['string','number','boolean'].includes(typeof v)))
    .map(k=>({field:k.replace(/_/g,' '),before:String(a[k]??'—').slice(0,500),after:String(b[k]??'—').slice(0,500)}));
}
export function workSummary(seconds:number,tools:number|null,steps:number):string {
  return `Worked for ${Math.max(0,Math.round(seconds))}s · ${tools==null?`${steps} steps`:`${tools} tools`}`;
}
