import type {Run} from '../commands/core.ts';
import type {PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {canonicalJson} from './queue.ts';
import {consultScopeFactsV1Schema} from './scope-facts-schema.ts';
import type {ConsultScopeFactsV1,ScopeUnit} from './scope-facts.ts';
import type {FieldDef,ModuleDef,TemplateDef} from './form-types.ts';
import {scopeLabelRegistry} from './forms/seed.ts';
import {pinnedDerivations} from './derive.ts';
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
export async function consultScopeFacts(run:Run,projectId:string,scopeKey:string,consultId?:string):Promise<ConsultScopeFactsV1>{
 if(consultId)return visitScopeFacts(run,projectId,scopeKey,consultId);
 const visits=await run<{id:string}>("SELECT id FROM consults WHERE project_id=$1 AND status<>'cancelled' ORDER BY scheduled_at DESC,id",[projectId]);
 if(!visits.length)return visitScopeFacts(run,projectId,scopeKey);
 const facts=await Promise.all(visits.map(v=>visitScopeFacts(run,projectId,scopeKey,v.id)));
 const out=facts[0];
 for(const f of facts.slice(1)){
  if(f.state==='conflicted')out.state='conflicted';else if(f.state==='unreviewed'&&out.state!=='conflicted')out.state='unreviewed';
  for(const m of f.measurements){const existing=out.measurements.find(x=>x.label===m.label&&x.unit===m.unit&&m.unit!=='in');if(existing){existing.value=Math.round((existing.value+m.value)*10000)/10000;existing.instance_ids=[...new Set([...existing.instance_ids,...m.instance_ids])].sort();existing.answer_revisions.push(...m.answer_revisions);existing.answer_revisions.sort((a,b)=>a-b);}else out.measurements.push(m);}
  for(const k of ['conditions','flags','photos','assumptions','exclusions','trade_walks','new_work','conflicts'] as const)(out[k] as unknown[]).push(...f[k]);
  out.rrp.applies ||= f.rrp.applies;
 }
 if(out.source_version)out.source_version.aggregate_hash=hash({...out,source_version:facts.map(f=>({consult_id:f.source_version?.consult_id,review_revision:f.source_version?.review_revision,form_checksums:f.source_version?.form_checksums}))});
 return consultScopeFactsV1Schema.parse(out);
}
async function visitScopeFacts(run:Run,projectId:string,scopeKey:string,consultId?:string):Promise<ConsultScopeFactsV1>{
 if(!SCOPE_RULES.some(r=>r.items.some(i=>i.key===scopeKey)) && !(await run('SELECT 1 FROM scope_items WHERE project_id=$1 AND key=$2',[projectId,scopeKey])).length && !(await run('SELECT 1 FROM consult_mapping_registries WHERE mappings ? $1',[scopeKey])).length)throw new Error('unknown_scope_key');
 const out=empty(projectId,scopeKey);
 const [visit]=await run<{id:string;status:string;completion_generation:string;photos_ok:boolean}>(`SELECT id,status,completion_generation,photos_ok FROM consults WHERE project_id=$1 AND status<>'cancelled' AND ($2::uuid IS NULL OR id=$2) ORDER BY scheduled_at DESC,id LIMIT 1`,[projectId,consultId??null]);
 if(!visit)return out;
 const pins=await run<{checksum:string;definition:ModuleDef}>(`SELECT p.checksum,v.definition FROM consult_form_pins p JOIN consult_form_versions v ON v.id=p.form_id WHERE p.consult_id=$1`,[visit.id]);
 const instances=await run<{id:string;module_key:string;parent_id:string|null}>(`SELECT id,module_key,parent_id FROM consult_instances WHERE consult_id=$1 AND removed_at IS NULL ORDER BY id`,[visit.id]);
 const answers=await run<{id:string;instance_id:string;field_key:string;status:string;value:unknown;unit:string;server_revision:string;skip_reason:string;skip_note:string}>(`SELECT a.* FROM consult_field_heads h JOIN consult_answers a ON a.id=h.current_answer_id JOIN consult_instances i ON i.id=a.instance_id WHERE h.consult_id=$1 AND i.removed_at IS NULL ORDER BY a.instance_id,a.field_key`,[visit.id]);
 const [evidence]=await run<{evidence:Record<string,any>;actor:string;updated_at:string}>('SELECT evidence,actor,updated_at FROM consult_close_evidence WHERE consult_id=$1',[visit.id]);
 const ev=evidence?.evidence??{};
 const moduleDefs=pins.map(p=>p.definition).filter(d=>'fields' in d);
 const templates=pins.map(p=>p.definition as unknown as TemplateDef).filter(d=>'derived' in d);
 const projection=pinnedDerivations(moduleDefs,templates,instances,answers);
 const global:Record<string,unknown>={};for(const module of moduleDefs)for(const field of module.fields){const values=instances.filter(i=>i.module_key===module.key).map(i=>projection.scalar(i,field.key)).filter(v=>v!==undefined);if(values.length)global[`${module.key}.${field.key}`]=values.length===1?values[0]:values;}
 const groups=new Map<string,ConsultScopeFactsV1['measurements'][number]>();
 for(const instance of instances){
  const mod=pins.find(p=>p.definition.key===instance.module_key)?.definition;if(!mod?.fields)continue;
  const rows=answers.filter(a=>a.instance_id===instance.id),values={...global,...Object.fromEntries(mod.fields.map(f=>[f.key,projection.scalar(instance,f.key)]))};
  if(mod.key==='selections'){
   const who=rows.find(a=>a.field_key==='who_buys'&&a.status==='answered'&&a.value==='Client');
   const decision=rows.find(a=>a.field_key==='decision'&&a.status==='answered');
   if(who&&decision)out.exclusions.push({text:`Client supplied: ${String(decision.value)}`,source_answer_id:who.id});
  }
  for(const field of mod.fields){
   let a=rows.find(a=>a.field_key===field.key);const map=field.maps_to;
   let revisions=a?[safe(a.server_revision)]:[];
   if(field.derive||field.derive_cases){
    const result=projection.field(instance,field.key);
    revisions=result?.answer_revisions??[];
    if(result)a={id:rows[0]?.id,instance_id:instance.id,field_key:field.key,status:'answered',value:result.value,unit:field.unit??'',server_revision:String(Math.max(0,...revisions)),skip_reason:'',skip_note:''};
   }
   const derivedScalar=projection.scalar(instance,field.key);if(!a&&derivedScalar!==undefined&&rows[0])a={...rows[0],field_key:field.key,status:'answered',value:derivedScalar,unit:field.unit??''};
   for(const [index,flag] of [...(field.flag?[field.flag]:[]),...(field.flags??[])].entries())if(conditionMatches(flag.when,key=>values[key])){
    const key=`${instance.id}:${field.key}${index?':'+index:''}`,d=ev.flags?.[key];out.flags.push({key,text:flag.issue,disposition:d?.disposition??null,reason:d?.note??null,decided_by:d?evidence.actor:null,decided_at:d?new Date(evidence.updated_at).toISOString():null});
   }
   if(!map||map.scope_key!==scopeKey||!a)continue;
   if(a.status==='skipped'){
    const assumption=ev.skips?.[`${instance.id}:${field.key}`]?.assumption;
    if(assumption)out.assumptions.push({field_path:`${instance.id}:${field.key}`,text:assumption.text,quantity:assumption.quantity,unit:units.has(assumption.unit)?assumption.unit:null,responsible_trade:assumption.responsible_trade,verification_point:assumption.verification_point});
    if(a.skip_reason==='Sub/supplier will measure')out.exclusions.push({text:`Field measure by ${field.key==='circuits_countertop_20a'?'the electrician':'supplier'}: ${field.label}`,source_answer_id:a.id});
    continue;
   }
   if(a.status!=='answered')continue;
   if(map.kind==='measurement'&&map.quantity_label&&typeof a.value==='number'&&Number.isFinite(a.value)&&units.has(a.unit)){
    // Only areas, runs and counts are additive. Dimensions stay per-instance.
    const additive=['sf','lf','ea'].includes(a.unit);const k=`${map.quantity_label}:${a.unit}${additive?'':':'+instance.id}`;
    const g=groups.get(k)??{key:field.key,label:map.quantity_label,value:0,unit:a.unit as ScopeUnit,instance_ids:[],answer_revisions:[]};
    if(g.instance_ids.includes(instance.id))out.conflicts.push({key:k,source_ids:rows.filter(r=>r.status==='answered').map(r=>r.id),reason:'Ambiguous overlapping quantity contributions'});
    g.value=Math.round((g.value+a.value)*10000)/10000;g.instance_ids.push(instance.id);g.answer_revisions.push(...revisions);groups.set(k,g);
   }else if(['observation','client_answer','decision','issue'].includes(map.kind))out.conditions.push({key:field.key,text:String(a.value),source_answer_id:a.id});
   else if(map.kind==='new_work'&&a.value&&typeof a.value==='object'){
    const v=a.value as {origin:string;text:string};if(v.origin==='client_requested_optional'||v.origin==='found_condition_required')out.new_work.push({origin:v.origin,label:v.origin==='client_requested_optional'?'Upsell — optional addition':'Scope change — required work',text:v.text});
   }
  }
 }
 // Template quantities own their label, replacing module intermediates. This
 // prevents whole-basement dimensions from adding to room totals twice.
 for(const {definition:d,result:r} of projection.derived){
  if(d.maps_to?.scope_key!==scopeKey||!d.maps_to.quantity_label)continue;
  for(const [key,g] of groups)if(g.label===d.maps_to.quantity_label)groups.delete(key);
  if(!r)continue;
  const mapped=moduleDefs.flatMap(m=>m.fields).find(f=>f.maps_to?.scope_key===scopeKey&&f.maps_to.quantity_label===d.maps_to?.quantity_label);
  const unit=mapped?.unit??SCOPE_RULES.flatMap(r=>r.items).find(i=>i.key===scopeKey)?.quantity_labels?.find(q=>q.label===d.maps_to?.quantity_label)?.unit??scopeLabelRegistry.find(q=>q.scope_key===scopeKey&&q.quantity_label===d.maps_to?.quantity_label)?.unit;if(!unit||!units.has(unit))continue;
  for(const [key,g] of groups)if(g.label===d.maps_to.quantity_label)groups.delete(key);
  groups.set(`template:${d.key}`,{key:d.key,label:d.maps_to.quantity_label,value:r.value,unit:unit as ScopeUnit,instance_ids:r.instance_ids,answer_revisions:r.answer_revisions});
 }
 out.measurements=[...groups.values()].map(g=>({...g,instance_ids:[...new Set(g.instance_ids)].sort(),answer_revisions:g.answer_revisions.sort((a,b)=>a-b)}));
 const conflicts=await run<{instance_id:string;field_key:string;current_answer_id:string;proposed_answer_id:string}>(`SELECT * FROM consult_conflicts WHERE consult_id=$1 AND resolved_at IS NULL ORDER BY id`,[visit.id]);
 out.conflicts.push(...conflicts.map(c=>({key:`${c.instance_id}:${c.field_key}`,source_ids:[c.current_answer_id,c.proposed_answer_id],reason:'Unresolved answer conflict'})));
 out.state=out.conflicts.length?'conflicted':visit.status==='complete'?'reviewed':'unreviewed';
 if(visit.photos_ok&&(await run<{ok:boolean}>('SELECT consult_photos_allowed($1) ok',[visit.id]))[0]?.ok)out.photos=await run(`SELECT m.file_id,m.shot_key,m.instance_id,coalesce(m.field_key,'') caption FROM consult_media m JOIN consult_instances i ON i.id=m.instance_id WHERE m.consult_id=$1 AND m.kind IN ('photo','markup') AND m.removed_at IS NULL AND i.removed_at IS NULL AND m.shot_key IS NOT NULL ORDER BY m.id`,[visit.id]);
 out.trade_walks=(ev.trade_walks??[]).map((w:{trade:string;needed:boolean})=>({trade:w.trade,needed:w.needed,status:w.needed?'not_scheduled':'not_needed',work_item_id:null}));
 const val=(module:string,key:string)=>answers.find(a=>instances.find(i=>i.id===a.instance_id)?.module_key===module&&a.field_key===key&&a.status==='answered')?.value;
 out.permits.authority=String(val('house','permit_city')??val('house','permit_authority')??'')||null;
 out.permits.building_inspector=String(val('house','permit_building_inspector')??'')||null;
 const electrical=String(val('house','permit_electrical')??'').toLowerCase();out.permits.electrical_inspector=electrical==='city'||electrical==='dli'?electrical:null;
 const year=Number(val('house','year_built'));out.rrp.applies=!year||year<1978;
 for(const key of ['firm_cert','renovator_name','renovator_cert','expiry'] as const)out.rrp[key]=String(val('era',key)??'')||null;
 out.rrp.firm_cert=String(val('era','firm_cert_number')??out.rrp.firm_cert??'')||null;
 out.rrp.expiry=String(val('era','renovator_expiry')??out.rrp.expiry??'')||null;
 const firmExpiry=String(val('era','firm_cert_expiry')??'');if(firmExpiry&&firmExpiry<new Date().toISOString().slice(0,10))out.rrp.firm_cert=null;
 const tasks=await run<{id:string;source_id:string;status:string;due_at:string|null}>("SELECT id,source_id,status,due_at FROM work_items WHERE source_kind='consult' AND source_id LIKE $1",[`${visit.id}:trade:%`]);
 out.trade_walks=out.trade_walks.map(w=>{const t=tasks.find(t=>t.source_id===`${visit.id}:trade:${w.trade}`);return {...w,work_item_id:t?.id??null,status:!w.needed?'not_needed':t?.status==='done'?'done':t?.due_at?'scheduled':'not_scheduled'};});
 out.source_version={consult_id:visit.id,review_revision:safe(visit.completion_generation),form_checksums:[...new Set(pins.map(p=>p.checksum))].sort(),aggregate_hash:hash(out)};
 return consultScopeFactsV1Schema.parse(out);
}
/** Project → consult → scope lock ordering. Caller owns BEGIN/COMMIT. Never calls
 * the old first-compatible-plan-item path and never writes estimate prices. */
export async function reconcileConsultFindings(c:PoolClient,ctx:ConsultContext,input:{consult_id:string;expected_generation:number;operation_id:string}){
 const {consult_id:id,expected_generation:generation}=input;
 // SQL authenticates an active owner or the visit’s current assigned visitor.
 await c.query('SELECT consult_verify_context($1,$2,$3)',[ctx,id,'apply']);
 if(JSON.parse(ctx.payload).mode!=='person')throw new Error('person_required');
 return applyCompleteConsultFindings(c,input);
}
/** Internal executor; reachable only through an authorized command or fenced job. */
export async function applyCompleteConsultFindings(c:PoolClient,input:{consult_id:string;expected_generation:number;operation_id:string}){
 const {consult_id:id,expected_generation:generation}=input;
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
  const facts=await consultScopeFacts(run,ref.project_id,scope.key,id);
  if(facts.source_version?.consult_id!==id)throw new Error('superseded_visit');if(facts.state==='conflicted')throw new Error('conflict');
  const evidenceFacts=[
   ...facts.conditions.map(f=>({key:`${f.key}:${f.source_answer_id}`,kind:'observation',text:f.text,media:null})),
   ...facts.flags.map(f=>({key:f.key,kind:'issue',text:`${f.text} — ${f.disposition??'undecided'}: ${f.reason??''}`,media:null})),
   ...facts.photos.map(f=>({key:`photo:${f.file_id}`,kind:'photo',text:f.caption,media:f.file_id})),
   ...facts.assumptions.map(f=>({key:`assumption:${f.field_path}`,kind:'observation',text:`Assumption: ${f.text}; verify: ${f.verification_point}`,media:null})),
   ...facts.exclusions.map(f=>({key:`exclusion:${f.source_answer_id}`,kind:'observation',text:f.text,media:null})),
   ...facts.new_work.map((f,n)=>({key:`new_work:${n}`,kind:'new_work',text:`${f.label}: ${f.text}`,media:null}))
  ];
  for(const f of evidenceFacts){
   const finding=(await run<{id:string}>(`INSERT INTO site_visit_findings(project_id,scope_key,fact_key,kind,statement,media_ref,source_note,consult_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(project_id,fact_key) DO UPDATE SET statement=excluded.statement RETURNING id`,[ref.project_id,scope.key,`consult:${id}:${generation}:${scope.key}:${f.kind}:${f.key}`,f.kind,f.text,f.media,`consult:${id}`,id,locked?'needs_clarification':'applied']))[0];
   const plan_item_ids:string[]=[];
   if(!locked&&plan&&f.kind==='photo'){
    const photo=facts.photos.find(p=>p.file_id===f.media);
    for(const item of plan.items)if(photo&&item.id&&item.scope_key===scope.key&&item.kind==='photo'&&item.consult_target?.instance_id===photo.instance_id&&item.consult_target?.shot_key===photo.shot_key){item.status='answered';item.finding_id=finding.id;plan_item_ids.push(item.id);}
   }
   results.push({scope_key:scope.key,label:f.text,status:locked?'proposed':'applied',finding_id:finding.id,plan_item_ids});
  }
  for(const m of facts.measurements){
   if(m.unit==='in'){
    await run(`INSERT INTO site_visit_findings(project_id,scope_key,fact_key,kind,statement,measurement,unit,source_note,consult_id,status) VALUES($1,$2,$3,'measurement',$4,$5,'in',$6,$7,'applied') ON CONFLICT(project_id,fact_key) DO NOTHING`,[ref.project_id,scope.key,`consult:${id}:${generation}:${scope.key}:dimension:${m.key}:${m.instance_ids.join(':')}`,m.label,m.value,`consult:${id}`,id]);continue;
   } // non-additive evidence only
   const others=await run<{quantity:string;manifest:any}>('SELECT q.quantity,q.manifest FROM consult_quantity_contributions q JOIN consults c ON c.id=q.consult_id WHERE c.project_id=$1 AND q.consult_id<>$2 AND scope_key=$3 AND label=$4 AND unit=$5 AND superseded_at IS NULL AND retracted_at IS NULL',[ref.project_id,id,scope.key,m.label,m.unit]);
   const source=`consult:${id}:${scope.key}:${m.label}:${m.unit}`;
   const existing=scope.quantities.find(q=>q.label===m.label);
   if(locked||others.some(q=>q.manifest.instance_ids?.some((i:string)=>m.instance_ids.includes(i)))||(existing&&existing.source!==source&&existing.source!==`consult-aggregate:${scope.key}:${m.label}:${m.unit}`)) {results.push({scope_key:scope.key,label:m.label,status:'proposed',reason:locked?'estimate_locked':'ambiguous_quantity_provenance'});continue;}
   const finding=(await run<{id:string}>(`INSERT INTO site_visit_findings(project_id,scope_key,fact_key,kind,statement,measurement,unit,source_note,consult_id,status) VALUES($1,$2,$3,'measurement',$4,$5,$6,$7,$8,'applied') RETURNING id`,[ref.project_id,scope.key,`${source}:${generation}`,m.label,m.value,m.unit,source,id]))[0];
   await run(`INSERT INTO consult_quantity_contributions(consult_id,generation,scope_key,label,unit,quantity,manifest,source_hash,finding_id,prior_quantities) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,generation,scope.key,m.label,m.unit,m.value,JSON.stringify({...m,formula_version:1,photo_ids:facts.photos.map(p=>p.file_id)}),hash(m),finding.id,JSON.stringify(scope.quantities)]);
   const next=scope.quantities.filter(q=>q.label!==m.label);next.push({label:m.label,qty:Math.round((m.value+others.reduce((n,q)=>n+Number(q.quantity),0))*10000)/10000,unit:m.unit,basis:'site_measurement',source:`consult-aggregate:${scope.key}:${m.label}:${m.unit}`});
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
 await run('UPDATE site_visit_findings SET superseded_at=now() WHERE consult_id=$1 AND retracted_at IS NOT NULL AND superseded_at IS NULL',[id]);
 await run('UPDATE consult_quantity_contributions SET superseded_at=now() WHERE consult_id=$1 AND generation<$2 AND superseded_at IS NULL',[id,generation]);
 const result={generation,results};
 await run(`INSERT INTO consult_finding_applications(consult_id,project_id,generation,source_revision,source_hash,status,provenance,result,applied_at) VALUES($1,$2,$3,$4,$5,'applied',$6,$6,now())`,[id,ref.project_id,generation,s.revision,hash(result),JSON.stringify(result)]);
 return result;
}
