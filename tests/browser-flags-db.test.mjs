import test from 'node:test';
import assert from 'node:assert/strict';
import {withTestDb} from './_harness/testdb.mjs';
import {evaluatePhase1Flags} from '../lib/browser/phase-flags.mjs';
const uid='123e4567-e89b-42d3-a456-426614174000';
const settings={'browser.enabled':'true','browser.staff_enabled':'true','browser.pilot_user_ids':JSON.stringify([uid])};
for(const envValue of [undefined,'','true','0','2'])test('A0 env '+String(envValue)+' denies admission',()=>assert.equal(evaluatePhase1Flags({settings,env:{SJC_BROWSER_ENABLED:envValue},user:{id:uid,role:'owner',active:true}}).can_start,false));
for(const [label,patch,user] of [
 ['empty pilots',{'browser.pilot_user_ids':'[]'},{id:uid,role:'owner',active:true}],
 ['invalid DB flag',{'browser.enabled':'1'},{id:uid,role:'owner',active:true}],
 ['staff disabled',{'browser.staff_enabled':'false'},{id:uid,role:'staff',active:true}],
 ['inactive',{}, {id:uid,role:'owner',active:false}],
 ['client',{}, {id:uid,role:'client',active:true}],
])test('A0 '+label+' denies admission',()=>assert.equal(evaluatePhase1Flags({settings:{...settings,...patch},env:{SJC_BROWSER_ENABLED:'1'},user}).can_start,false));
test('A0 named pilot owner and staff are independent; later flags forced off',()=>{
 for(const role of ['owner','staff']){const result=evaluatePhase1Flags({settings:{...settings,'browser.vault_enabled':'true'},env:{SJC_BROWSER_ENABLED:'1'},user:{id:uid,role,active:true}});assert.equal(result.can_start,true);assert.equal(result.flags.vault_enabled,false);}
});
test('A0 fresh database defaults are dark and pilots empty',()=>withTestDb(async(url,c)=>{
 const rows=(await c.query("SELECT key,value FROM app_settings WHERE key LIKE 'browser.%'")).rows;
 const s=Object.fromEntries(rows.map(r=>[r.key,r.value]));
 assert.equal(s['browser.pilot_user_ids'],'[]');assert.equal(s['browser.takeover_confirm_suppressed_user_ids'],'[]');
 assert.equal(evaluatePhase1Flags({settings:s,env:{SJC_BROWSER_ENABLED:'1'},user:{id:uid,role:'owner',active:true}}).can_start,false);
}));
