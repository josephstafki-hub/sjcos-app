import test from 'node:test';
import assert from 'node:assert/strict';
import {removedAreas,audienceSentence,acknowledgementLabel,showRowWarnings,normalizeFilename} from '../lib/project-file-writes.mjs';
const options=Array.from({length:21},(_,i)=>({key:`a${i}`,label:`Area ${i}`}));
for(let n=0;n<=21;n++)test(`unknown context: ${n} removals, one exact acknowledgement`,()=>{
 const baseline=options.map(o=>o.key),selected=baseline.slice(n),removed=removedAreas(baseline,selected);
 assert.deepEqual(removed,baseline.slice(0,n));assert.equal(showRowWarnings(removed),n>0&&n<=3);
 const label=acknowledgementLabel(selected,removed,options,'Larson bath');
 if(n===21)assert.equal(label,'I checked this canvas. Share it with everyone who can open Larson bath files.');
 if(n>2&&n<21)assert.match(label,new RegExp(`\\+${n-2} more`));
 if(selected.length>3)assert.equal(audienceSentence('staff',selected,options,'Larson bath'),'Only Joe and staff with every ticked area can read this copy.');
});
test('safe filename and no path',()=>{assert.equal(normalizeFilename('Permit steps',2),'Permit steps (v2).html');assert.throws(()=>normalizeFilename('x',1,'../x.html'));});
test('naturally empty baseline has no removal acknowledgement',()=>assert.deepEqual(removedAreas([],[]),[]));

import {createCanvasFileCall} from '../mcp/canvas-file-call.mjs';
test('Canvas files closed transport refuses HTTP, bare stdio and HTTP ALS before forwarding',async()=>{
 let calls=0;const id='11111111-1111-4111-8111-111111111111',env={SJC_RUN_ID:id,SJC_CONVERSATION_ID:id,SJC_PRINCIPAL_USER_ID:id,SJC_RUN_PROFILE:'operator',SJC_RUN_STARTED_S:'1'};
 for(const settings of [{transportKind:'http',env},{transportKind:'stdio',env:{}},{transportKind:'stdio',env,httpActive:()=>true}]){const call=createCanvasFileCall({...settings,internalCall:async()=>{calls++;}});assert.equal((await call('read',{file_id:'x'})).ok,false);}
 assert.equal(calls,0);
 const paths=[];const call=createCanvasFileCall({transportKind:'stdio',env,internalCall:async(p,b)=>{paths.push(p);assert.equal(b.context.principal_user_id,id);return {ok:true};}});assert.equal((await call('list',{project_slug:'p'})).ok,true);assert.deepEqual(paths,['/api/internal/canvas','/api/internal/canvas-files']);
});
