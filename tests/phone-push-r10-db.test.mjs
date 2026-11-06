// Expectations written FIRST in phone-push-r10-expectations.md.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setup } from './_harness/phone-r1.mjs';

// Expose only the private email transport for faking; dispatch/domain code is real.
registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (url.endsWith('/lib/providers/email.ts')) return { ...loaded, source: `${loaded.source}\nexport { defaultTransport };` };
  return loaded;
} });

let f, POST, telegram, baseCall;
let seq = 1000000000, messageId = 910000;
let calls = [], emails = [];
const originalFetch = globalThis.fetch;
before(async () => {
  // Fail closed if any unmocked provider is accidentally reached.
  globalThis.fetch = async () => { throw new Error('Unexpected network request in R10 test'); };
  process.env.NEXT_PUBLIC_APP_URL = 'https://os.sjcarpentryllc.com';
  f = await setup();
  ({ POST } = await import('../app/api/telegram/webhook/route.ts'));
  ({ defaultTransport: telegram } = await import('../lib/providers/telegram.ts'));
  baseCall = async (method, body) => {
    calls.push({ method, body });
    return { ok: true, status: 200, result: { message_id: ++messageId } };
  };
  const { defaultTransport: email } = await import('../lib/providers/email.ts');
  email.configured = () => true;
  email.send = async payload => { emails.push(payload); return { id: `qa-email-${emails.length}` }; };
  process.env.GMAIL_CLIENT_ID = 'qa';
  process.env.GMAIL_CLIENT_SECRET = 'qa';
  process.env.GMAIL_REFRESH_TOKEN = 'qa';
});
after(async () => {
  globalThis.fetch = originalFetch;
  (await import('../lib/providers/apns.ts')).closeApnsSessions();
  await f?.db.pool.end();
});
beforeEach(async () => {
  calls = []; emails = []; telegram.call = baseCall;
  process.env.SJC_OUTBOUND_DISABLED = '0'; // Both real transport objects are fake above.
  await f.run(`UPDATE users SET active=true,role='owner' WHERE id=$1`, [f.owner.id]);
  await f.run(`TRUNCATE push_actions,push_device_deliveries,owner_push_messages,push_outbox,telegram_updates,telegram_reply_targets RESTART IDENTITY CASCADE`);
  await f.run(`DELETE FROM work_items`);await f.run(`DELETE FROM decisions`);
});

function callback(c, verb, overrides = {}) {
  const chat = process.env.TELEGRAM_OWNER_CHAT_ID;
  return { update_id: ++seq, callback_query: {
    id: `r10-${seq}`, from: { id: chat }, message: { message_id: c.mid, chat: { id: chat } },
    data: c.d ? `d|${c.d.id}|${c.d.content_hash.slice(0, 12)}|${verb}` : `w|${c.w.id}|${verb}`,
    ...overrides,
  } };
}
async function post(update) {
  const response = await POST(new Request('http://local/api/telegram/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-secret' },
    body: JSON.stringify(update),
  }));
  assert.equal(response.status, 200);
  return response.json();
}
async function card(kind = 'decision') {
  const c = kind === 'decision' ? await f.decision() : await f.draft();
  c.mid = ++messageId;
  await f.run(`UPDATE owner_push_messages SET telegram_message_id=$2 WHERE id=$1`, [c.m.id, String(c.mid)]);
  const { rememberReplyTarget } = await import('../lib/decisions/owner-replies.ts');
  await rememberReplyTarget(f.run, { chatId: process.env.TELEGRAM_OWNER_CHAT_ID, messageId: c.mid, decisionId: c.d?.id, workItemId: c.w?.id, kind: 'card' });
  return c;
}
async function emailCard() {
  const c = await card('draft');
  const [p] = await f.run(`INSERT INTO projects(slug,name,client_email) VALUES($1,'Quote','client@example.test') RETURNING id`, [`zz-${crypto.randomUUID()}`]);
  await f.run(`UPDATE work_items SET project_id=$2 WHERE id=$1`, [c.w.id, p.id]);
  const [k] = await f.run(`INSERT INTO knowledge_items(content,kind,source,project_id,created_by) VALUES('To: client@example.test\nSubject: Displayed quote\n\nDisplayed $100.','draft','agent',$1,'qa') RETURNING id`, [p.id]);
  await f.run(`INSERT INTO agent_receipts(work_item_id,receipt_kind,uri,label) VALUES($1,'draft',$2,'Quote')`, [c.w.id, `knowledge_items/${k.id}`]);
  // Freeze the displayed binding after the receipt exists, as a real card does.
  c.m = await f.recordAppMessage({ kind: 'decision', title: 'Quote', telegram: { workItemId: c.w.id } });
  await f.run(`UPDATE owner_push_messages SET telegram_message_id=NULL WHERE work_item_id=$1`, [c.w.id]);
  await f.run(`UPDATE owner_push_messages SET telegram_message_id=$2 WHERE id=$1`, [c.m.id, String(c.mid)]);
  return c;
}
async function row(c) {
  return (await f.run(c.d ? `SELECT * FROM decisions WHERE id=$1` : `SELECT * FROM work_items WHERE id=$1`, [c.d?.id ?? c.w.id]))[0];
}

const approval = () => import('../lib/approve-work-item.ts');
async function sweep() { return (await import('../lib/dispatch/db.ts')).runDispatchPass(); }
async function checkpoint(c) { return (await f.run(`SELECT d.* FROM approved_draft_dispatches d JOIN approved_work_item_drafts a ON a.id=d.approved_draft_id WHERE a.work_item_id=$1 ORDER BY a.created_at DESC LIMIT 1`, [c.w.id]))[0]; }
async function claim(c) { return (await approval()).claimApproval(c.w.id,c.m.draft_binding); }
async function finish(c, saved) { return (await approval()).finishApproval({id:c.w.id,approvedDraftId:saved.approvedDraftId,title:saved.title,body:saved.body,assigneeKey:saved.assignee_key}); }
async function expire() { await f.run(`UPDATE approved_draft_dispatches SET lease_until=now()-interval '1 minute' WHERE phase='running'`); }
function inject(match, after = false) {
  const pool=f.db.pool,connect=pool.connect; let injected=false;
  pool.connect=function(...args) { if(args.length)return connect.apply(this,args);return connect.call(this).then(client=>{
    const query=client.query,release=client.release;let armed=false;
    client.query=async function(sql,...params) {
      if(typeof sql==='string' && match(sql)) { if(after)armed=true;else if(!injected){injected=true;throw new Error('R10 crash');} }
      const result=await query.call(this,sql,...params);
      if(after && armed && sql==='COMMIT' && !injected){injected=true;throw new Error('R10 crash');}
      return result;
    };
    client.release=function(...args){client.query=query;client.release=release;return release.apply(this,args);};return client;
  });};
  return ()=>{pool.connect=connect;assert.ok(injected,'crash injection reached actual boundary');};
}
async function crashApproval(c,channel) {
  const restore=inject(s=>s.includes('INSERT INTO approved_work_item_drafts'),true);
  try {
    if(channel==='telegram'){const u=callback(c,'a'); const r=await post(u);assert.equal(r.ok,false);return u;}
    await assert.rejects(()=>(approval().then(a=>a.approveWorkItemById(c.w.id,c.m.draft_binding))),/R10 crash/);
  }finally{restore();}
}
async function assertAtomic(c) {
  assert.equal((await row(c)).approval_status,'approved');
  assert.equal((await checkpoint(c)).phase,'pending');
  assert.equal((await f.run(`SELECT * FROM approved_work_item_drafts WHERE work_item_id=$1`,[c.w.id])).length,1);
  assert.equal((await f.run(`SELECT * FROM action_intents WHERE payload->>'work_item_id'=$1`,[c.w.id])).length,0);
  assert.equal(emails.length,0);
}
async function portalCard() {
  const c=await emailCard();const [w]=await f.run(`SELECT p.slug FROM projects p JOIN work_items w ON w.project_id=p.id WHERE w.id=$1`,[c.w.id]);
  await f.run(`INSERT INTO users(email,password_hash,name,role,initials,link_slug) VALUES($1,'x','Client','client','CL',$2)`,[`zz-${crypto.randomUUID()}@example.test`,w.slug]);
  await f.run(`UPDATE knowledge_items SET content='To: client portal\n\nFrozen portal $100.' WHERE id=(SELECT split_part(uri,'/',2)::uuid FROM agent_receipts WHERE work_item_id=$1 AND receipt_kind='draft')`,[c.w.id]);
  c.m=await f.recordAppMessage({kind:'decision',title:'Portal',telegram:{workItemId:c.w.id}});return c;
}

test('Telegram callback COMMIT crash has approved snapshot + pending dispatch; duplicate then real sweep sends once',async()=>{
 const c=await emailCard(),u=await crashApproval(c,'telegram');await assertAtomic(c);
 const r=await post(u);assert.equal(r.duplicate,true);assert.match(r.outcome,/dispatch pending/);
 await sweep();await sweep();assert.equal(emails.length,1);assert.equal((await checkpoint(c)).phase,'done');
});
test('Callable web COMMIT crash recovers once, retap cannot approve again',async()=>{
 const c=await emailCard();await crashApproval(c,'web');await assertAtomic(c);
 const r=await (await approval()).approveWorkItemById(c.w.id,c.m.draft_binding);assert.equal(r.ok,false);assert.match(r.error,/Already approved/);
 await sweep();await sweep();assert.equal(emails.length,1);assert.equal((await checkpoint(c)).phase,'done');
});
test('Portal COMMIT crash posts frozen body once via sweep',async()=>{
 const c=await portalCard();await crashApproval(c,'web');await assertAtomic(c);await sweep();await sweep();
 assert.equal((await checkpoint(c)).phase,'done');assert.equal(emails.length,0);
 const rows=await f.run(`SELECT body FROM chat_messages WHERE body='Frozen portal $100.'`);assert.equal(rows.length,1);
});
test('Provider accepted then completion write crashes: expired checkpoint is needs_review, never another email',async()=>{
 const c=await emailCard(),saved=await claim(c),pool=f.db.pool,query=pool.query;let injected=false;
 const restore=()=>{pool.query=query;assert.ok(injected);};
 pool.query=function(sql,...args){if(!injected && sql.startsWith('UPDATE approved_draft_dispatches SET phase=$2')){injected=true;return Promise.reject(new Error('R10 crash'));}return query.call(this,sql,...args);};
 try{await assert.rejects(()=>finish(c,saved),/R10 crash/);}finally{restore();}
 assert.equal(emails.length,1);await expire();await sweep();await sweep();
 assert.equal(emails.length,1);assert.equal((await checkpoint(c)).phase,'needs_review');assert.equal((await checkpoint(c)).result.needsReview,true);assert.equal((await checkpoint(c)).result.evidence.sends.length,1);assert.match((await row(c)).blocked_reason,/needs a check/);
});
test('Provider accepted before intent outcome COMMIT crashes: intent reconciliation never resends',async()=>{
 const c=await emailCard(),saved=await claim(c);let restore;
 const {defaultTransport:email}=await import('../lib/providers/email.ts');const send=email.send;
 email.send=async p=>{const r=await send(p);restore=inject(s=>s.includes('UPDATE action_intents') && s.includes('provider_ref'));return r;};
 try{await assert.rejects(()=>finish(c,saved),/R10 crash/);}finally{email.send=send;restore?.();}
 await expire();await f.run(`UPDATE action_intents SET lease_until=now()-interval '1 minute' WHERE state='leased'`);
 await sweep();await sweep();assert.equal(emails.length,1);assert.equal((await checkpoint(c)).phase,'needs_review');
});
test('Concurrent sweeps dispatch one pending approved snapshot',async()=>{
 const c=await emailCard();await claim(c);await Promise.all([sweep(),sweep()]);assert.equal(emails.length,1);assert.equal((await checkpoint(c)).phase,'done');
});
test('Stalled sweep transport holds no owner or work-item lock; second sweep finishes',async()=>{
 const c=await emailCard();await claim(c);const {defaultTransport:email}=await import('../lib/providers/email.ts');const send=email.send;
 let release,reached;const gate=new Promise(r=>release=r),at=new Promise(r=>reached=r);email.send=async p=>{reached();await gate;return send(p);};
 const pending=sweep();try{
 await Promise.race([at,new Promise((_,r)=>setTimeout(()=>r(new Error('transport not reached')),5000))]);
 const client=await f.db.pool.connect();try{await client.query('BEGIN');await client.query(`SET LOCAL lock_timeout='1500ms'`);await client.query(`UPDATE users SET name='Profile' WHERE id=$1`,[f.owner.id]);await client.query(`SELECT id FROM work_items WHERE id=$1 FOR UPDATE`,[c.w.id]);await client.query('COMMIT');}finally{await client.query('ROLLBACK');client.release();}
 await sweep();assert.equal((await row(c)).approval_status,'approved');
 }finally{release();await pending;email.send=send;}assert.equal(emails.length,1);
});
test('Rollback after checkpoint insert leaves no snapshot, approval or outbound effect; retry works',async()=>{
 const c=await emailCard(),restore=inject(s=>s.includes("UPDATE work_items w SET approval_status='approved'"));
 try{await assert.rejects(()=>claim(c),/R10 crash/);}finally{restore();}
 assert.equal((await row(c)).approval_status,'requested');assert.equal(await checkpoint(c),undefined);assert.equal(emails.length,0);
 await claim(c);await sweep();assert.equal(emails.length,1);
});
test('Recovery sends immutable approved body and recipient after source edits',async()=>{
 const c=await emailCard();await crashApproval(c,'web');await f.run(`UPDATE knowledge_items SET content='To: other@example.test\nSubject: Wrong\n\nChanged $9900.'`);await f.run(`UPDATE projects SET client_email='other@example.test'`);
 await sweep();assert.equal(emails.length,1);assert.equal(emails[0].to,'client@example.test');assert.equal(emails[0].bodyText,'Displayed $100.');
});
test('Non-email checkpoint completes once and retains no-email notice',async()=>{
 const c=await card('draft');await claim(c);await sweep();await sweep();assert.equal(emails.length,0);assert.equal((await checkpoint(c)).phase,'done');assert.match((await checkpoint(c)).result.notice,/Nothing was emailed/);
});
test('Worker can recover email and portal; narrow roles cannot mint or edit approval evidence',async()=>{
 for(const kind of ['email','portal']) {
 const c=await(kind==='portal'?portalCard():emailCard());await claim(c);
 const pool=f.db.pool,connect=pool.connect,query=pool.query,worker=await pool.connect();
 await worker.query('SET ROLE sjcos_worker');const release=worker.release;worker.release=()=>{};
 pool.query=(...args)=>worker.query(...args);pool.connect=async()=>worker;
 try{await (await approval()).sweepApprovedDrafts();}finally{pool.query=query;pool.connect=connect;await worker.query('RESET ROLE');worker.release=release;worker.release();}
 assert.equal((await checkpoint(c)).phase,'done');
 for(const role of ['sjcos_agent','sjcos_worker']){const conn=await pool.connect();try{await conn.query(`SET ROLE ${role}`);for(const sql of [`INSERT INTO approved_work_item_drafts(work_item_id,binding,snapshot) VALUES('${c.w.id}','x','{}')`,`UPDATE approved_work_item_drafts SET snapshot='{}'`,`INSERT INTO approved_draft_dispatches(approved_draft_id) VALUES('${(await checkpoint(c)).approved_draft_id}')`])await assert.rejects(()=>conn.query(sql),/permission denied/);}finally{await conn.query('RESET ROLE');conn.release();}}
 }
 assert.equal(emails.length,1);
});
async function refusal(c,inactive=false) {
 if(inactive===true)await f.run(`UPDATE users SET active=false WHERE id=$1`,[f.owner.id]);
 const u=callback(c,'a');
 telegram.call=async(method,body)=>{if(method==='answerCallbackQuery') {
 const [audit]=await f.run(`SELECT decision_id FROM telegram_updates WHERE update_id=$1`,[u.update_id]);assert.ok(audit,'refusal audit committed before toast');assert.equal(audit.decision_id,null);
 }return baseCall(method,body);};
 const r=await post(u);telegram.call=baseCall;assert.equal(r.ok,true,JSON.stringify(r));
 const [audit]=await f.run(`SELECT u.decision_id,u.outcome,s.state FROM telegram_updates u JOIN source_events s ON s.event_id=u.update_id::text AND s.provider='telegram' WHERE u.update_id=$1`,[u.update_id]);
 assert.equal(audit.decision_id,null);assert.equal(audit.state,'done');assert.match(audit.outcome,/refused/);
 assert.equal(calls.filter(x=>x.method==='answerCallbackQuery').at(-1).body.text,inactive?'No active owner account. Nothing was changed.':'That decision no longer exists.');
 assert.equal((await post(u)).duplicate,true);assert.equal(emails.length,0);
}
test('Missing decision refusal commits NULL audit FK and post-commit toast',async()=>{
 const d={id:crypto.randomUUID(),content_hash:'a'.repeat(32)};await refusal({d,mid:++messageId});
});
test('Deleted real decision card refusal commits and retry is harmless',async()=>{
 const c=await card();await f.run(`DELETE FROM owner_push_messages WHERE decision_id=$1`,[c.d.id]);await f.run(`DELETE FROM decisions WHERE id=$1`,[c.d.id]);await refusal(c);
});
test('Inactive owner and owner deactivated after target lookup both commit missing-target refusal',async()=>{
 await refusal({d:{id:crypto.randomUUID(),content_hash:'a'.repeat(32)},mid:++messageId},true);
 await f.run(`UPDATE users SET active=true WHERE id=$1`,[f.owner.id]);
 const pool=f.db.pool,connect=pool.connect;let changed=false;
 pool.connect=function(...args){if(args.length)return connect.apply(this,args);return connect.call(this).then(client=>{
 const query=client.query,release=client.release;
 client.query=async function(sql,...params){if(!changed && sql==='SELECT active, role FROM users WHERE id = $1 FOR SHARE'){changed=true;await f.run(`UPDATE users SET active=false WHERE id=$1`,[f.owner.id]);}return query.call(this,sql,...params);};
 client.release=function(...args){client.query=query;client.release=release;return release.apply(this,args);};return client;
 });};
 try{await refusal({d:{id:crypto.randomUUID(),content_hash:'a'.repeat(32)},mid:++messageId},'late');}finally{pool.connect=connect;}
 assert.ok(changed);
});
test('Phone interrupted approval retains terminal needs_review while pending snapshot can recover safely',async()=>{
 const c=await emailCard(),id=crypto.randomUUID(),restore=inject(s=>s.includes('INSERT INTO approved_work_item_drafts'),true);
 try{const r=await f.action(c.m,'approve',undefined,id);assert.equal(r.status,500);}finally{restore();}
 await f.run(`UPDATE push_actions SET lease_until=now()-interval '1 minute' WHERE id=$1`,[id]);
 const r=await f.action(c.m,'approve',undefined,id);assert.equal(r.body.outcome,'needs_review');assert.equal(r.body.needsReview,true);
 await sweep();await sweep();assert.equal(emails.length,1);assert.equal((await f.action(c.m,'approve',undefined,id)).body.outcome,'needs_review');
});
