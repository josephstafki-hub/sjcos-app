import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateModule,validateTemplate} from '../lib/consult/forms/validate.ts';
import {approvedFormContent} from '../lib/consult/forms/approved-content.ts';
import {readFileSync} from 'node:fs';
const field={key:'length',label:'Length',type:'length',unit:'in',required:true,tier:'price_critical',range:[24,600],maps_to:{scope_key:'flooring.install',quantity_label:'Floor area',kind:'measurement'}};
const module={key:'room',version:1,title:'Room',repeatable:true,say:['Measure wall to wall.'],fields:[field],shots:[{key:'doorway',label:'From doorway',required:true,tier:'price_critical'}],coverage:[{key:'measured',text:'Measured the room',satisfied_by:['length']}]};
const registry={modules:[module],mappings:{'flooring.install':['Floor area']}};
test('approved scripts, all module/template tables and add-ons are preserved verbatim as content, not claimed executable seeds',()=>{const plan=readFileSync(new URL('../docs/plans/in-home-consult-plan.md',import.meta.url),'utf8');assert.equal(approvedFormContent,plan.slice(plan.indexOf('### 7.2 Shared scripts'),plan.indexOf('## 8. Recording consent')));});
test('form publication validation rejects missing tiers, invalid units, duplicate keys and unknown mapping',()=>{
 assert.deepEqual(validateModule(module,registry),module);
 for(const change of [m=>delete m.fields[0].tier,m=>m.fields[0].unit='lf',m=>m.fields.push({...field}),m=>m.fields[0].maps_to.quantity_label='Guess',m=>m.coverage[0].satisfied_by=['missing'],m=>m.fields[0].required={field:'unknown',op:'eq',value:true}]){const m=structuredClone(module);change(m);assert.throws(()=>validateModule(m,registry));}
});
test('templates require known modules and versioned quantity registry',()=>{const t={key:'general',version:1,title:'General',opening:[],closing:[],modules:[{module:'room',required:true,min:1}],derived:[]};assert.deepEqual(validateTemplate(t,registry),t);assert.throws(()=>validateTemplate({...t,modules:[{module:'missing',required:true}]},registry),/unknown_module/);});

test('conditional AST compiles compound sibling and consult conditions without evaluation',async()=>{
 const {compileCondition}=await import('../lib/consult/forms/conditions.ts');
 const known=new Set(['glass','plan','house.year_built','rooms']);
 const condition={all:[{field:'glass',op:'ne',value:'None'},{any:[{field:'plan',op:'in',value:['Replace','New']},{field:'house.year_built',op:'lt',value:1978}]}]};
 const check=compileCondition(condition,known);
 assert.equal(check({glass:'Sidelight',plan:'Replace'}),true);
 assert.equal(check({glass:'None',plan:'Replace'}),false);
 assert.equal(check({plan:'Replace'}),false);
 assert.equal(check({glass:'Sidelight',plan:'Keep','house.year_built':1970}),true);
 assert.equal(compileCondition({field:'rooms',op:'in',value:['Bath','Kitchen']},known)({rooms:['Bedroom','Bath']}),true);
 assert.throws(()=>compileCondition({field:'missing',op:'answered'},known),/unknown_condition_field/);
 assert.throws(()=>compileCondition({all:[]},known),/invalid_condition/);
 assert.throws(()=>compileCondition({field:'glass',op:'in',value:'bad'},known),/list_required/);
 let deep={field:'plan',op:'answered'};for(let i=0;i<20;i++)deep={not:deep};
 assert.throws(()=>compileCondition(deep,known),/too_complex/);
});

test('publication formula grammar, references, cycles and pinned template membership',()=>{
 const good=structuredClone(module);good.fields.push({...field,key:'area',derive:'length * length / 144'});
 assert.doesNotThrow(()=>validateModule(good,{...registry,modules:[good]}));
 for(const formula of ['length.constructor()', 'missing*2', 'length+', 'area*2']){const bad=structuredClone(good);bad.fields[1].derive=formula;assert.throws(()=>validateModule(bad,{...registry,modules:[bad]}));}
 const template={key:'general',version:1,title:'General',opening:[],closing:[],modules:[{module:'room',required:true}],derived:[{key:'area',label:'Area',formula:'room.length*room.length/144'}]};
 assert.doesNotThrow(()=>validateTemplate(template,registry));
 assert.throws(()=>validateTemplate({...template,derived:[...template.derived,...template.derived]},registry),/duplicate_derived/);
});
