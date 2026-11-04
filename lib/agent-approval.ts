export function approvalState(g:{status:string;expiresAt:string;uses:number}, now=Date.now()):string {
  if(g.uses>0)return 'Used';
  if(g.status==='requested'&&Date.parse(g.expiresAt)<=now)return 'Expired';
  return ({requested:'Waiting',approved:'Approved',denied:'Denied',revoked:'Revoked',expired:'Expired',used:'Used'} as Record<string,string>)[g.status]??g.status;
}
export function approvalOutcome(result:{ok:boolean;error?:string;message?:string}):{ok:boolean;message:string} {
  return {ok:result.ok,message:result.ok?(result.message??'Decision saved.'):(result.error??'The decision could not be saved. Try again.')};
}
