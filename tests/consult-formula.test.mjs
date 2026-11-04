import {test} from 'node:test';import assert from 'node:assert/strict';
import {evaluateFormula,formulaReferences} from '../lib/consult/forms/formula.ts';import {pinnedDerivations} from '../lib/consult/derive.ts';
import {compileCondition} from '../lib/consult/forms/conditions.ts';
test('bounded functions, pair parts, comparisons and lazy branches',()=>{assert.equal(evaluateFormula('ceil(sqrt(size.w*size.w+size.h*size.h))+abs(-2)+min(3,4)',{'size.w':3,'size.h':4}),10);assert.equal(evaluateFormula('x>0?10/x:0',{x:0}),0);assert.equal(evaluateFormula('x+1',{x:undefined}),null);for(const x of ['global.process','x.constructor()','sqrt(1,2)','x;1'])assert.throws(()=>formulaReferences(x,new Set(['x'])));});
test('repeat terms sum products per row, pairs are square inches; applicable missing stays gap',()=>{
 const field=(key,type='number',required=true)=>({key,label:key,type,required,tier:'record'}),modules=[{key:'room',version:1,title:'Room',repeatable:true,say:[],fields:[field('length'),field('width'),field('size','length_pair')],shots:[],coverage:[]}],instances=[{id:'a',module_key:'room'},{id:'b',module_key:'room'},{id:'removed',module_key:'room',removed_at:'today'}];
 const answers=instances.flatMap((i,index)=>[['length',index?24:12],['width',index?36:12],['size',index?[24,36]:[12,12]]].map(([field_key,value])=>({id:field_key+i.id,instance_id:i.id,field_key,status:'answered',value,server_revision:'1'})));
 const t={key:'test',version:1,title:'Test',opening:[],closing:[],modules:[],derived:[{key:'area',label:'Area',formula:'room.length*room.width/144+room.size/144'}]};assert.equal(pinnedDerivations(modules,[t],instances,answers).derived[0].result.value,14);
 assert.equal(pinnedDerivations(modules,[t],instances,answers.filter(a=>a.id!=='widthb')).derived[0].result,null);
});
test('cross-module repeating condition means any live value matches',()=>{assert.equal(compileCondition({field:'room.use',op:'eq',value:'Bath'},new Set(['room.use']))({'room.use':['Kitchen','Bath']}),true);});
