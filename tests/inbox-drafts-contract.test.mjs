import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { grantLines } from '../scripts/db-roles-sql.mjs';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const stubs={
 'next/server':`export class NextResponse extends Response {static json(body,options){return new NextResponse(JSON.stringify(body),{...options,headers:{'content-type':'application/json'}})}}`,
 '@/lib/inbox-autodraft':`export const sweepInboxDrafts=async()=>{globalThis.__cronCalls++;return {ready:1}};`,
 '@/lib/gmail':`export const isGmailRateLimit=e=>e?.code===429;`,
 '@/lib/notify':`export const emit=async()=>{};`,
 '@/lib/db':`export const query=async()=>({rows:[]});`,
 '@/lib/worker/cron-runs':`export const recordCronRun=async()=>{};`,
};
registerHooks({resolve(s,c,n){if(s in stubs)return {url:'stub:contract:'+s,shortCircuit:true};if(s==='../_lib/guard')return n(new URL('app/api/cron/_lib/guard.ts',root).href,c);return n(s,c)},load(u,c,n){return u.startsWith('stub:contract:')?{format:'module',source:stubs[u.slice(14)],shortCircuit:true}:n(u,c)}});
const {GET,POST}=await import('../app/api/cron/inbox-drafts/route.ts');
test('migration has mailbox/user isolation, per-message idempotency, model restrictions and website-only grants',()=>{
 const sql=read('db/migrations/0068_inbox_drafts.sql');const manifest=JSON.parse(read('deploy/db-roles.manifest.json'));
 assert.match(sql,/user_id uuid REFERENCES users\(id\)/);assert.match(sql,/mailbox = lower\(mailbox\)/);
 assert.match(sql,/\(mailbox, thread_key, source_message_id\) WHERE source = 'ai'/);
 assert.match(sql,/\(mailbox, user_id, thread_key, channel\) WHERE source = 'human'/);
 assert.match(sql,/model IN \('claude','hermes'\)/);assert.match(sql,/version integer NOT NULL DEFAULT 1 CHECK \(version > 0\)/);
 assert.deepEqual(manifest.tables.inbox_drafts.sjcos_readonly,['SELECT']);assert.equal(manifest.tables.inbox_drafts.sjcos_agent,undefined);assert.equal(manifest.tables.inbox_drafts.sjcos_worker,undefined);
 for(const grant of grantLines(manifest,['inbox_drafts']))assert.ok(sql.includes(grant));
});
test('static role scan reports only intentionally withheld privileges, no new missing grants',()=>{
 const output=execFileSync(process.execPath,['scripts/db-roles-scan.mjs','--diff'],{cwd:root,encoding:'utf8'});
 const lines=output.split('\n').filter(line=>line.startsWith('  '));assert.ok(lines.every(line=>line.includes('withheld on purpose')));assert.doesNotMatch(output,/inbox_drafts/);
});
test('cron fails closed without CRON_SECRET or with wrong bearer, authorized GET/POST only stage drafts',async()=>{
 const previous=process.env.CRON_SECRET;globalThis.__cronCalls=0;
 try {
  delete process.env.CRON_SECRET;assert.equal((await GET(new Request('http://test/'))).status,401);
  process.env.CRON_SECRET='stub-secret';assert.equal((await POST(new Request('http://test/',{headers:{authorization:'Bearer wrong'}}))).status,401);assert.equal(__cronCalls,0);
  for(const handle of [GET,POST]){const response=await handle(new Request('http://test/',{headers:{authorization:'Bearer stub-secret'}}));assert.equal(response.status,200);assert.equal((await response.json()).ready,1);}
  assert.equal(__cronCalls,2);
 } finally {if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;}
});
test('settings expose default-on auto drafts and default-Claude model with both controls; timer is offset',()=>{
 assert.match(read('lib/settings.ts'),/key: "ai.inboxAutoDraft"[^\n]+default: true/);
 assert.match(read('lib/settings.ts'),/inboxDraftModel: get\("ai.inboxDraftModel"\) === "hermes" \? "hermes" : "claude"/);
 assert.match(read('components/settings/SettingsClient.tsx'),/InboxDraftModelPicker initial=\{data.inboxDraftModel\}/);
 assert.match(read('deploy/sjcos-inbox-drafts.timer'),/OnCalendar=\*:7\/10/);
 assert.match(read('deploy/sjcos-inbox-drafts.sh'),/api\/cron\/inbox-drafts/);
});
