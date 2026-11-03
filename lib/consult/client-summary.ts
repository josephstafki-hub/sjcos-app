/** Client hand-over payload: constructed from an allowlist, never a consult snapshot. */
export interface ClientSummary {
  client_name:string; visit_date:string; rooms:{name:string;work:string[]}[];
  still_to_decide:string[]; open_questions:string[]; formal_estimate_date:string;
}
export function clientSummary(input:ClientSummary):ClientSummary {
  return {client_name:input.client_name,visit_date:input.visit_date,
    rooms:input.rooms.map(room=>({name:room.name,work:[...room.work]})),
    still_to_decide:[...input.still_to_decide],open_questions:[...input.open_questions],formal_estimate_date:input.formal_estimate_date};
}
export function handBackAllowed(held_ms:number,pin_verified:boolean):boolean {
  return pin_verified || (Number.isFinite(held_ms) && held_ms>=2000);
}
