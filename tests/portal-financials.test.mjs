import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import pg from 'pg';
const db=new pg.Client({connectionString:'postgresql://sjcos:qa@localhost:5499/sjcos'});
await db.connect();after(()=>db.end());
globalThis.__portalFinanceQuery=async (...a)=>(await db.query(...a)).rows[0]??null;
registerHooks({resolve(s,c,n){if(s==='./db')return {url:'stub:db',shortCircuit:true};return n(s,c);},load(u,c,n){if(u==='stub:db')return {format:'module',source:'export const queryOne=(...a)=>globalThis.__portalFinanceQuery(...a);',shortCircuit:true};return n(u,c);}});
const {getPortalFinancials}=await import('../lib/portal-financials.ts');
for(const slug of ['libby-mahowald','tierney-kitchen'])test(`${slug}: portal uses ledger including recorded money outside invoices, to the cent`,async()=>{
 const p=(await db.query('select total_cents,collected_cents from projects where slug=$1',[slug])).rows[0];
 const f=await getPortalFinancials(slug);
 assert.equal(f.paidCents,Number(p.collected_cents));assert.equal(f.currentCents,Number(p.total_cents));
 assert.equal(f.remainingCents,Math.max(0,Number(p.total_cents)-Number(p.collected_cents)));
});
