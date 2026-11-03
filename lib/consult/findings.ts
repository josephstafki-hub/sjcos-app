import type {Run} from '../commands/core.ts';
import type {PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {canonicalJson} from './queue.ts';
import {consultScopeFactsV1Schema} from './scope-facts-schema.ts';
import type {ConsultScopeFactsV1,ScopeUnit} from './scope-facts.ts';
import type {FieldDef,ModuleDef} from './form-types.ts';
import {evaluateFormula,formulaReferences} from './forms/formula.ts';
import {conditionMatches} from './completeness.ts';
import type {ConsultContext} from './uploads.ts';
import {recomputeDraftEstimate} from '../estimating/assembly.ts';
import {SCOPE_RULES} from '../estimating/rules.ts';
const hash=(x:unknown)=>createHash('sha256').update(canonicalJson(x)).digest('hex');
const safe=(x:unknown)=>{const n=Number(x);if(!Number.isSafeInteger(n)||n<0)throw new Error('unsafe_revision');return n;};
const units=new Set(['in','sf','lf','ea']);
function empty(project:string,key:string):ConsultScopeFactsV1{return {schema_version:1,project_id:project,scope_key:key,state:'none',source_version:null,measurements:[],conditions:[],flags:[],photos:[],assumptions:[],exclusions:[],trade_walks:[],permits:{authority:null,building_inspector:null,electrical_inspector:null},rrp:{applies:false,firm_cert:null,renovator_name:null,renovator_cert:null,expiry:null},new_work:[],conflicts:[]};}
/** Trusted DB export. Callers must authorize project access before invoking. No URLs
 * or financials are selected. It does not apply findings or change lifecycle. */
export async function consultScopeFacts(run:Run,projectId:string,scopeKey:string):Promise<ConsultScopeFactsV1>{
 if(!SCOPE_RULES.some(r=>r.items.some(i=>i.key===scopeKey)) && !(await run('SELECT 1 FROM scope_items WHERE project_id=$1 AND key=$2',[projectId,scopeKey])).length && !(await run('SELECT 1 FROM consult_mapping_registries WHERE mappings ? $1',[scopeKey])).length)throw new Error('unknown_scope_key');
 const out=empty(projectId,scopeKey);
 const [visit]=await run<{id:string;status:string;completion_generation:string;photos_ok:boolean}>(`SELECT id,status,completion_generation,photos_ok FROM consults WHERE project_id=$1 AND status<>'cancelled' ORDER BY scheduled_at DESC,id LIMIT 1`,[projectId]);
 if(!visit)return out;
 const pins=await run<{checksum:string;definition:ModuleDef}>(`SELECT p.checksum,v.definition FROM consult_form_pins p JOIN consult_form_versions v ON v.id=p.form_id WHERE p.consult_id=$1`,[visit.id]);
 const instances=await run<{id:string;module_key:string}>(`SELECT id,module_key FROM consult_instances WHERE consult_id=$1 AND removed_at IS NULL ORDER BY id`,[visit.id]);
 const answers=await run<{id:string;instance_id:string;field_key:string;status:string;value:unknown;unit:string;server_revision:string;skip_reason:string;skip_note:string}>(`SELECT a.* FROM consult_field_heads h JOIN consult_answers a ON a.id=h.current_answer_id JOIN consult_instances i ON i.id=a.instance_id WHERE h.consult_id=$1 AND i.removed_at IS NULL ORDER BY a.instance_id,a.field_key`,[visit.id]);
 const [evidence]=await run<{evidence:Record<string,any>;actor:string;updated_at:string}>('SELECT evidence,actor,updated_at FROM consult_close_evidence WHERE consult_id=$1',[visit.id]);
 const ev=evidence?.evidence??{};
 const groups=new Map<string,ConsultScopeFactsV1['measurements'][number]>();
 for(const instance of instances){
  const mod=pins.find(p=>p.definition.key===instance.module_key)?.definition;if(!mod?.fields)continue;
  const rows=answers.filter(a=>a.instance_id===instance.id),values=Object.fromEntries(rows.filter(a=>a.status==='answered').map(a=>[a.field_key,a.value]));
  for(const field of mod.fields){
   let a=rows.find(a=>a.field_key===field.key);const map=field.maps_to;
   let revisions=a?[safe(a.server_revision)]:[];
   if(field.derive){
    const numeric:Record<string,number|undefined>=Object.fromEntries(mod.fields.map(f=>[f.key,typeof values[f.key]==='number'?values[f.key] as number:undefined]));
    const value=evaluateFormula(field.derive,numeric);
    const refs=formulaReferences(field.derive,new Set(Object.keys(numeric)));
    revisions=rows.filter(r=>refs.includes(r.field_key)).map(r=>safe(r.server_revision));
    if(value!==null)a={id:rows[0]?.id,instance_id:instance.id,field_key:field.key,status:'answered',value,unit:field.unit??'',server_revision:String(Math.max(...revisions)),skip_reason:'',skip_note:''};
   }
   if(!map||map.scope_key!==scopeKey||!a)continue;
   if(a.status==='skipped'){
    const assumption=ev.skips?.[`${instance.id}:${field.key}`]?.assumption;
    if(assumption)out.assumptions.push({field_path:`${instance.id}:${field.key}`,text:assumption.text,quantity:assumption.quantity,unit:units.has(assumption.unit)?assumption.unit:null,responsible_trade:assumption.responsible_trade,verification_point:assumption.verification_point});
    if(a.skip_reason==='Sub/supplier will measure')out.exclusions.push({text:`Field measure by supplier: ${field.label}`,source_answer_id:a.id});
    continue;
   }
   if(a.status!=='answered')continue;
   if(map.kind==='measurement'&&map.quantity_label&&typeof a.value==='number'&&Number.isFinite(a.value)&&units.has(a.unit)){
    // Only areas, runs and counts are additive. Dimensions stay per-instance.
    const additive=['sf','lf','ea'].includes(a.unit);const k=`${map.quantity_label}:${a.unit}${additive?'':':'+instance.id}`;
    const g=groups.get(k)??{key:field.key,label:map.quantity_label,value:0,unit:a.unit as ScopeUnit,instance_ids:[],answer_revisions:[]};
    if(g.instance_ids.includes(instance.id))out.conflicts.push({key:k,source_ids:rows.filter(r=>r.status==='answered').map(r=>r.id),reason:'Ambiguous overlapping quantity contributions'});
    g.value=Math.round((g.value+a.value)*10000)/10000;g.instance_ids.push(instance.id);g.answer_revisions.push(...revisions);groups.set(k,g);
   }else if(map.kind==='observation')out.conditions.push({key:field.key,text:String(a.value),source_answer_id:a.id});
   else if(map.kind==='new_work'&&a.value&&typeof a.value==='object'){
    const v=a.value as {origin:string;text:string};if(v.origin==='client_requested_optional'||v.origin==='found_condition_required')out.new_work.push({origin:v.origin,label:v.origin==='client_requested_optional'?'Upsell — optional addition':'Scope change — required work',text:v.text});
   }
   if(field.flag&&conditionMatches(field.flag.when,key=>values[key])){
    const d=ev.flags?.[`${instance.id}:${field.key}`];out.flags.push({key:`${instance.id}:${field.key}`,text:field.flag.issue,disposition:d?.disposition??null,reason:d?.note??null,decided_by:d?evidence.actor:null,decided_at:d?new Date(evidence.updated_at).toISOString():null});
   }
  }
 }
 out.measurements=[...groups.values()].map(g=>({...g,instance_ids:[...new Set(g.instance_ids)].sort(),answer_revisions:g.answer_revisions.sort((a,b)=>a-b)}));
 const conflicts=await run<{instance_id:string;field_key:string;current_answer_id:string;proposed_answer_id:string}>(`SELECT * FROM consult_conflicts WHERE consult_id=$1 AND resolved_at IS NULL ORDER BY id`,[visit.id]);
 out.conflicts.push(...conflicts.map(c=>({key:`${c.instance_id}:${c.field_key}`,source_ids:[c.current_answer_id,c.proposed_answer_id],reason:'Unresolved answer conflict'})));
 out.state=out.conflicts.length?'conflicted':visit.status==='complete'?'reviewed':'unreviewed';
 if(visit.photos_ok)out.photos=await run(`SELECT m.file_id,m.shot_key,m.instance_id,coalesce(m.field_key,'') caption FROM consult_media m JOIN consult_instances i ON i.id=m.instance_id WHERE m.consult_id=$1 AND m.kind IN ('photo','markup') AND m.removed_at IS NULL AND i.removed_at IS NULL AND m.shot_key IS NOT NULL ORDER BY m.id`,[visit.id]);
 out.trade_walks=(ev.trade_walks??[]).map((w:{trade:string;needed:boolean})=>({trade:w.trade,needed:w.needed,status:w.needed?'not_scheduled':'not_needed',work_item_id:null}));
 const val=(module:string,key:string)=>answers.find(a=>instances.find(i=>i.id===a.instance_id)?.module_key===module&&a.field_key===key&&a.status==='answered')?.value;
 out.permits.authority=String(val('house','permit_authority')??'')||null;
 const year=Number(val('house','year_built'));out.rrp.applies=!year||year<1978;
 for(const key of ['firm_cert','renovator_name','renovator_cert','expiry'] as const)out.rrp[key]=String(val('era',key)??'')||null;
 out.source_version={consult_id:visit.id,review_revision:safe(visit.completion_generation),form_checksums:[...new Set(pins.map(p=>p.checksum))].sort(),aggregate_hash:hash(out)};
 return consultScopeFactsV1Schema.parse(out);
}
/** Project → consult → scope lock ordering. Caller owns BEGIN/COMMIT. Never calls
 * the old first-compatible-plan-item path and never writes estimate prices. */
export async function reconcileConsultFindings(c:PoolClient,ctx:ConsultContext,input:{consult_id:string;expected_generation:number;operation_id:string}){
 const {consult_id:id,expected_generation:generation}=input;
 await c.query('SELECT consult_verify_context($1,$2,$3)',[ctx,id,'apply']);
 if(JSON.parse(ctx.payload).mode!=='person')throw new Error('person_required');
 const run:Run=async(sql,args)=>(await c.query(sql,args)).rows;
 const [ref]=await run<{project_id:string}>('SELECT project_id FROM consults WHERE id=$1',[id]);
 await run('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[ref.project_id]);
 const [s]=await run<{status:string;completion_generation:string;revision:string;site_visit_plan_id:string|null;site_visit_plan_revision:number|null}>('SELECT status,completion_generation,revision,site_visit_plan_id,site_visit_plan_revision FROM consults WHERE id=$1 FOR UPDATE',[id]);
 if(s.status!=='complete')throw new Error('consult_not_complete');if(safe(s.completion_generation)!==generation)throw new Error('rebase_required');
 const [prior]=await run<{result:unknown}>("SELECT result FROM consult_finding_applications WHERE consult_id=$1 AND generation=$2 AND status='applied'",[id,generation]);if(prior)return prior.result;
 const scopes=await run<{key:string;quantities:any[]}>('SELECT key,quantities FROM scope_items WHERE project_id=$1 ORDER BY key FOR UPDATE',[ref.project_id]);
 const [plan]=s.site_visit_plan_id?await run<{id:string;revision:number;items:any[]}>('SELECT id,revision,items FROM site_visit_plans WHERE id=$1 FOR UPDATE',[s.site_visit_plan_id]):[];
 if(plan&&plan.revision!==s.site_visit_plan_revision)throw new Error('plan_remap_required');
 const locked=(await run("SELECT id FROM estimates WHERE project_id=$1 AND kind='formal' AND estimate_out_to_client(id) IS NOT NULL FOR UPDATE",[ref.project_id])).length>0;
 const results=[];
 for(const scope of scopes){
  const facts=await consultScopeFacts(run,ref.project_id,scope.key);
  if(facts.source_version?.consult_id!==id)throw new Error('superseded_visit');if(facts.state==='conflicted')throw new Error('conflict');
  for(const m of facts.measurements){
   if(m.unit==='in')continue; // non-additive evidence only
   const [other]=await run('SELECT q.id FROM consult_quantity_contributions q JOIN consults c ON c.id=q.consult_id WHERE c.project_id=$1 AND q.consult_id<>$2 AND scope_key=$3 AND label=$4 AND unit=$5 AND superseded_at IS NULL AND retracted_at IS NULL',[ref.project_id,id,scope.key,m.label,m.unit]);
   const source=`consult:${id}:${scope.key}:${m.label}:${m.unit}`;
   const existing=scope.quantities.find(q=>q.label===m.label);
   if(locked||other||(existing&&existing.source!==source)) {results.push({scope_key:scope.key,label:m.label,status:'proposed',reason:locked?'estimate_locked':'ambiguous_quantity_provenance'});continue;}
   const finding=(await run<{id:string}>(`INSERT INTO site_visit_findings(project_id,scope_key,fact_key,kind,statement,measurement,unit,source_note,consult_id,status) VALUES($1,$2,$3,'measurement',$4,$5,$6,$7,$8,'applied') RETURNING id`,[ref.project_id,scope.key,`${source}:${generation}`,m.label,m.value,m.unit,source,id]))[0];
   await run(`INSERT INTO consult_quantity_contributions(consult_id,generation,scope_key,label,unit,quantity,manifest,source_hash,finding_id,prior_quantities) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,generation,scope.key,m.label,m.unit,m.value,JSON.stringify(m),hash(m),finding.id,JSON.stringify(scope.quantities)]);
   const next=scope.quantities.filter(q=>q.label!==m.label);next.push({label:m.label,qty:m.value,unit:m.unit,basis:'site_measurement',source});
   await run('UPDATE scope_items SET quantities=$3,revision=revision+1 WHERE project_id=$1 AND key=$2',[ref.project_id,scope.key,JSON.stringify(next)]);scope.quantities=next;
   const plan_item_ids:string[]=[];
   if(plan)for(const item of plan.items){
    const target=item.consult_target;
    if(item.scope_key===scope.key&&item.kind==='measurement'&&item.unit===m.unit&&target?.field_key===m.key&&m.instance_ids.includes(target.instance_id)&&item.quantity_label===m.label){item.status='answered';item.finding_id=finding.id;plan_item_ids.push(item.id);}
   }
   results.push({scope_key:scope.key,label:m.label,status:'applied',finding_id:finding.id,plan_item_ids});
  }
 }
 if(plan)await run('UPDATE site_visit_plans SET items=$2 WHERE id=$1',[plan.id,JSON.stringify(plan.items)]);
 const pins=await run<{definition:ModuleDef}>(`SELECT v.definition FROM consult_form_pins p JOIN consult_form_versions v ON v.id=p.form_id WHERE p.consult_id=$1 AND p.kind='module'`,[id]);
 const unknown=[...new Set(pins.flatMap(p=>p.definition.fields.map(f=>f.maps_to?.scope_key).filter((k):k is string=>!!k&&!scopes.some(s=>s.key===k))))];
 for(const key of unknown)await run(`INSERT INTO site_visit_findings(project_id,scope_key,fact_key,kind,statement,source_note,consult_id,status) VALUES($1,$2,$3,'observation','No scope item — add one?',$4,$5,'needs_clarification') ON CONFLICT(project_id,fact_key) DO NOTHING`,[ref.project_id,key,`consult:${id}:${generation}:missing:${key}`,`consult:${id}`,id]);
 if(results.length)await run(`INSERT INTO work_items(title,project_id,assignee_key,source_kind,source_id,created_by) SELECT 'Consultation quantities changed — price the scope',$1,(SELECT id::text FROM users WHERE role='owner' AND active ORDER BY created_at LIMIT 1),'consult',$2,'consult' WHERE NOT EXISTS(SELECT 1 FROM work_items WHERE source_kind='consult' AND source_id=$2)`,[ref.project_id,`consult-apply:${id}:${generation}`]);
 if(!locked&&results.some(r=>r.status==='applied'))for(const e of await run<{id:number}>("SELECT id::int id FROM estimates WHERE project_id=$1 AND kind='formal'",[ref.project_id]))await recomputeDraftEstimate(run,e.id);
 const result={generation,results};
 await run(`INSERT INTO consult_finding_applications(consult_id,project_id,generation,source_revision,source_hash,status,provenance,result,applied_at) VALUES($1,$2,$3,$4,$5,'applied',$6,$6,now())`,[id,ref.project_id,generation,s.revision,hash(result),JSON.stringify(result)]);
 return result;
}
