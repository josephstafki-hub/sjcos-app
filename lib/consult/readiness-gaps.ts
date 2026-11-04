import type {ConsultScopeFactsV1} from './scope-facts.ts';
import type {Gap} from '../estimating/types.ts';
export function consultReadinessGaps(f:ConsultScopeFactsV1,today=new Date().toISOString().slice(0,10)):Gap[]{
 const gaps:Gap[]=[];const add=(kind:Gap['kind'],severity:Gap['severity'],detail:string)=>gaps.push({kind,severity,detail,ref:f.scope_key});
 if(f.state==='unreviewed'&&f.measurements.length)add('consult_not_complete','soft','Consultation is not complete');
 if(f.state==='conflicted'||f.conflicts.length)add('consult_conflict','hard','Consultation has unresolved source conflicts');
 if(f.trade_walks.some(w=>w.needed&&w.status!=='done'))add('trade_walk_pending','hard','Trade walk is pending');
 if(f.flags.some(v=>v.disposition==='sub_must_look'))add('flag_sub_must_look','hard','Sub must inspect flagged condition');
 if(f.assumptions.length)add('assumption_to_verify','soft',f.assumptions.map(a=>`${a.text}: ${a.verification_point}`).join('; '));
 if(f.rrp.applies&&(!f.rrp.firm_cert||!f.rrp.renovator_cert||!f.rrp.expiry||f.rrp.expiry<today))add('rrp_cert_missing','hard','RRP certification is missing or expired');
 return gaps;
}
