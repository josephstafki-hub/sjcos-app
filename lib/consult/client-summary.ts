/** Client hand-over payload: constructed from an allowlist, never a consult snapshot. */
export interface ClientSummary {
  client_name:string; visit_date:string;
  /** Only rooms with something actually covered; `work` is what was done there, in plain words. */
  rooms:{name:string;work:string[]}[];
  /** Places with nothing covered yet, by names the client knows: "Not measured today: …". Never claimed as looked over. */
  come_back?:string[];
  /** Grouped by room/area (§6 "Still to decide · faucet"). */
  still_to_decide:{group:string;items:string[]}[];
  open_questions:string[]; formal_estimate_date:string;
}
/** At most this many per group on the client view, then "+ n more for the estimate". */
export const STILL_TO_DECIDE_SHOWN = 5;
export function clientSummary(input:ClientSummary):ClientSummary {
  return {client_name:input.client_name,visit_date:input.visit_date,
    rooms:input.rooms.map(room=>({name:room.name,work:[...room.work]})),
    come_back:[...(input.come_back??[])].map(String),
    still_to_decide:(input.still_to_decide??[]).map(g=>({group:String(g.group),items:[...g.items].map(String)})),
    open_questions:[...input.open_questions],formal_estimate_date:input.formal_estimate_date};
}
export function handBackAllowed(held_ms:number,pin_verified:boolean):boolean {
  return pin_verified || (Number.isFinite(held_ms) && held_ms>=2000);
}

/** Text preview used when the visitor records why initials were unavailable. */
export function clientRecapText(input:ClientSummary):string {
 const s=clientSummary(input);
 return ["What we went over",s.client_name,s.visit_date,
 ...s.rooms.flatMap(r=>[r.name,r.work.join(' · ')]),
 ...s.still_to_decide.flatMap(g=>['Still to decide',g.group,...g.items.slice(0,STILL_TO_DECIDE_SHOWN),...(g.items.length>STILL_TO_DECIDE_SHOWN?['More choices in the estimate']:[])]),
 ...(s.come_back?.length?['Not measured today: '+s.come_back.join(', ')]:[]),
 ...s.open_questions,'Next',s.formal_estimate_date?'Joe sends your formal estimate by '+s.formal_estimate_date+'.':'Joe will confirm the estimate date.',
 'This is what we talked about today. It is not a contract or a price.'].filter(Boolean).join('\n');
}
