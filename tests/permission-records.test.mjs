import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
let permitted = true;
let rows = [];
let calls = [];
globalThis.__permissionAuth = async role => {assert.equal(role, 'owner'); if (!permitted) throw new Error('Owner only');};
globalThis.__permissionQuery = async (sql, params) => {calls.push({sql, params}); assert.doesNotMatch(sql, /client_phone/); return {rows};};
registerHooks({
 resolve(s,c,n) {if(s==='@/lib/dal')return {url:'stub:auth',shortCircuit:true}; if(s==='@/lib/db')return {url:'stub:db',shortCircuit:true}; if(s==='@/lib/comms/phone')return {url:new URL('../lib/comms/phone.ts', import.meta.url).href,shortCircuit:true}; return n(s,c);},
 load(u,c,n) {if(u==='stub:auth')return {format:'module',source:'export const requireRole=(...a)=>globalThis.__permissionAuth(...a)',shortCircuit:true}; if(u==='stub:db')return {format:'module',source:'export const query=(...a)=>globalThis.__permissionQuery(...a)',shortCircuit:true}; return n(u,c);}
});
const {searchPermissionRecords} = await import('../lib/actions/permission-records.ts');
test('record search requires owner access and binds search text as data', async () => {
 permitted = false;
 await assert.rejects(searchPermissionRecords('send_invoice','x'), /Owner only/);
 assert.equal(calls.length,0);
 permitted = true;
 rows = [{id:'3',label:'Invoice · Smith kitchen'}];
 const r = await searchPermissionRecords('send_invoice', "O'Brien");
 assert.deepEqual(r.records,rows);
 assert.equal(calls[0].params[0], "%O'Brien%");
 assert.ok(!calls[0].sql.includes("O'Brien"));
});
test('contact searches use existing fields and normalize phone grant targets', async () => {
 rows = [{id:'(612) 555-0123',label:'Smith · (612) 555-0123'},{id:'bad',label:'Invalid'}];
 const r = await searchPermissionRecords('send_sms','Smith');
 assert.equal(r.error,undefined);
 assert.equal(r.records.length,1);
 assert.equal(r.records[0].id,'+16125550123');
 const before = calls.length;
 assert.deepEqual(await searchPermissionRecords('DROP TABLE',''),{records:[]});
 assert.equal(calls.length,before);
});
