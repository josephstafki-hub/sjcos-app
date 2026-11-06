// R5 expectations superseded by Joe: see phone-push-r6-expectations.md.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setup } from './_harness/phone-r1.mjs';

// Request adapters only. DAL, JWT verification, DB users, claims and dispatch
// are real. React cache has no render dispatcher in this CLI (no auth cache).
registerHooks({
  resolve(s, c, next) {
    if (s === 'next/headers' || s === 'next/navigation') return { url: `r5:${s}`, shortCircuit: true };
    return next(s, c);
  },
  load(u, c, next) {
    const source = {
      'r5:next/headers': 'export const cookies=async()=>({get:()=>globalThis.r5Session ? {value:globalThis.r5Session} : undefined}); export const headers=async()=>new Headers();',
      'r5:next/navigation': 'export function redirect(path){throw new Error("redirect:"+path)}',
    }[u];
    return source ? { format: 'module', source, shortCircuit: true } : next(u, c);
  },
});
let f, dal, encrypt, providers, engine, ops, waiting, decisions, previews, staff, staffToken;
const changed = 'This draft changed since you opened it. Nothing was sent. Read the new version and approve again.';
before(async () => {
  f = await setup();
  dal = await import('../lib/dal.ts');
  ({ encrypt } = await import('../lib/session.ts'));
  providers = await import('../lib/providers/types.ts');
  engine = await import('../lib/actions/engine.ts');
  ops = await import('../lib/actions/record-ops.ts');
  waiting = await import('../lib/actions/approvals.ts');
  decisions = await import('../lib/decisions/actions.ts');
  ({ workItemDraftPreviews: previews } = await import('../lib/work-item-draft.ts'));
  [staff] = await f.run(`INSERT INTO users(email,password_hash,name,role,initials,permissions) VALUES($1,'x','Staff','staff','S','{engine,today}') RETURNING *`, [`zz-${crypto.randomUUID()}@example.test`]);
  staffToken = await encrypt({ userId: staff.id, role: 'staff', perms: ['engine', 'today'], authAt: Math.floor(Date.now()/1000) });
  process.env.GMAIL_CLIENT_ID = 'qa'; process.env.GMAIL_CLIENT_SECRET = 'qa'; process.env.GMAIL_REFRESH_TOKEN = 'qa';
});
after(async () => { (await import('../lib/providers/apns.ts')).closeApnsSessions(); await f?.db.pool.end(); });
beforeEach(async () => {
  process.env.SJC_OUTBOUND_DISABLED = '1'; providers.resetFakeOutbox();
  await f.run(`DELETE FROM session_revocations WHERE user_id=$1`, [f.owner.id]);
  await f.run(`UPDATE users SET role='owner',active=true WHERE id=$1`, [f.owner.id]);
  await f.run(`UPDATE users SET active=true,permissions='{engine,today}' WHERE id=$1`, [staff.id]);
  await f.run(`DELETE FROM authority_grants WHERE user_id=$1`, [staff.id]);
  globalThis.r5Session = f.bearer;
});
const sends = () => providers.fakeOutbox.filter(x => x.provider === 'email');
async function draft(kind = 'project') {
  const slug = `zz-${crypto.randomUUID()}`, col = kind === 'project' ? 'project_id' : 'lead_id';
  const [p] = await f.run(kind === 'project' ? `INSERT INTO projects(slug,name,client_email) VALUES($1,'Oak kitchen','client@example.test') RETURNING id` : `INSERT INTO leads(slug,name,email) VALUES($1,'Oak kitchen','client@example.test') RETURNING id`, [slug]);
  const [w] = await f.run(`INSERT INTO work_items(title,body,${col},approval_status,status,source_kind,created_by) VALUES('Email quote','Quote',$1,'requested','approval_needed','agent','qa') RETURNING id`, [p.id]);
  const [k] = await f.run(`INSERT INTO knowledge_items(content,kind,source,${col},created_by) VALUES('To: client@example.test\nSubject: Authorized?\n\nDisplayed quote.','draft','agent',$1,'qa') RETURNING id`, [p.id]);
  await f.run(`INSERT INTO agent_receipts(work_item_id,receipt_kind,uri,label) VALUES($1,'draft',$2,'Quote')`, [w.id, `knowledge_items/${k.id}`]);
  const [v] = await previews({ ids: [w.id] });
  return { w, k, slug, kind, v };
}
async function evidence(c) {
  const row = c.d ? (await f.run(`SELECT * FROM decisions WHERE id=$1`, [c.d.id]))[0] : (await f.run(`SELECT * FROM work_items WHERE id=$1`, [c.w.id]))[0];
  const [counts] = await f.run(`SELECT (SELECT count(*) FROM approved_work_item_drafts)::int AS snapshots,(SELECT count(*) FROM agent_receipts)::int AS receipts,(SELECT count(*) FROM decision_events)::int AS events,(SELECT count(*) FROM action_intents)::int AS intents`);
  return { row, counts, sends: sends().length };
}
async function denied(c, call) {
  const before = await evidence(c);
  try {
    const result = await call(c);
    assert.equal(result?.ok, false);
  } catch (e) { assert.match(e.message, /^redirect:/); }
  assert.deepEqual(await evidence(c), before, 'refusal must not mutate approval/evidence or send');
}
async function authMatrix(c, call, approve, outcome = approve ? 'approved' : 'rejected') {
  await f.run(`DELETE FROM authority_grants WHERE user_id=$1`,[staff.id]);
  globalThis.r5Session = staffToken;
  assert.equal((await dal.getCurrentUser()).role, 'staff');
  await f.run(`UPDATE users SET permissions='{}' WHERE id=$1`, [staff.id]);
  await denied(c, call);
  await f.run(`UPDATE users SET permissions='{engine,today}' WHERE id=$1`, [staff.id]);
  await f.run(`INSERT INTO session_revocations(user_id,revoked_before) VALUES($1,now()+interval '1 second')`, [staff.id]);
  assert.equal(await dal.getCurrentUser(), null);
  await denied(c, call);
  await f.run(`DELETE FROM session_revocations WHERE user_id=$1`, [staff.id]);
  globalThis.r5Session = f.bearer;
  await f.run(`INSERT INTO session_revocations(user_id,revoked_before) VALUES($1,now()+interval '1 second')`, [f.owner.id]);
  assert.equal(await dal.getCurrentUser(), null);
  await denied(c, call);
  await f.run(`DELETE FROM session_revocations WHERE user_id=$1`, [f.owner.id]);
  assert.equal((await dal.getCurrentUser()).role, 'owner');
  // A still-valid owner JWT cannot retain lost areas/decision authority.
  await f.run(`UPDATE users SET role='staff',permissions='{}' WHERE id=$1`, [f.owner.id]);
  await denied(c, call);
  await f.run(`UPDATE users SET role='owner' WHERE id=$1`, [f.owner.id]);
  // Also exercise an authorized staff click against a separate fresh card.
  const staffCase = c.w ? await draft(c.kind) : await decision();
  if (c.d) await grantAuthority();
  globalThis.r5Session = staffToken;
  assert.equal((await call(staffCase)).ok, true);
  if (c.w) {
    assert.equal((await f.run(`SELECT approval_status FROM work_items WHERE id=$1`,[staffCase.w.id]))[0].approval_status,approve?'approved':'rejected');
    assert.equal(sends().length,approve?1:0);
  }
  if (c.w && approve) {
    assert.equal(sends().length, 1);
    assert.equal(sends()[0].payload.subject, staffCase.v.subject);
    assert.equal(sends()[0].payload.bodyText, staffCase.v.body);
    assert.equal((await call(staffCase)).ok, false);
    assert.equal(sends().length, 1);
  }
  if (c.d) {
    assert.equal((await f.run(`SELECT status FROM decisions WHERE id=$1`, [staffCase.d.id]))[0].status, outcome === 'changes_requested' ? 'rejected' : outcome);
    assert.equal((await f.run(`SELECT id FROM decision_events WHERE decision_id=$1 AND kind=$2`, [staffCase.d.id, outcome])).length, 1);
  }
  providers.resetFakeOutbox();
  globalThis.r5Session = f.bearer;
  assert.equal((await call(c)).ok, true);
  if (c.w) {
    assert.equal((await f.run(`SELECT approval_status FROM work_items WHERE id=$1`, [c.w.id]))[0].approval_status, approve ? 'approved' : 'rejected');
    assert.equal(sends().length, approve ? 1 : 0);
    if (approve) {
      assert.equal(sends()[0].payload.subject, c.v.subject);
      assert.equal(sends()[0].payload.bodyText, c.v.body);
      assert.equal((await f.run(`SELECT id FROM approved_work_item_drafts WHERE work_item_id=$1`, [c.w.id])).length, 1);
      assert.equal((await call(c)).ok, false); assert.equal(sends().length, 1);
    }
  } else {
    assert.equal((await f.run(`SELECT status FROM decisions WHERE id=$1`, [c.d.id]))[0].status, outcome === 'changes_requested' ? 'rejected' : outcome);
    assert.equal((await f.run(`SELECT id FROM decision_events WHERE decision_id=$1 AND kind=$2`, [c.d.id, outcome])).length, 1);
  }
}
const paths = [
  ['Engine Approve', 'project', true, c => engine.approveWorkItem(c.w.id, c.v.binding)],
  ['Engine Reject', 'project', false, c => engine.rejectWorkItem(c.w.id)],
  ...['project', 'lead'].flatMap(kind => [
    [`${kind} Ops Approve`, kind, true, c => ops.approveRecordWorkItem(c.w.id, kind, c.slug, c.v.binding)],
    [`${kind} Ops Reject`, kind, false, c => ops.rejectRecordWorkItem(c.w.id, kind, c.slug)],
  ]),
  ['Today/notifications/popup Approve', 'project', true, c => waiting.approveWaiting(`work_item:${c.w.id}`, c.v.binding)],
  ['Today/notifications/popup Decline', 'project', false, c => waiting.declineWaiting(`work_item:${c.w.id}`, c.v.binding)],
];
for (const [name, kind, approve, call] of paths) test(`${name}: real DAL staff with area allowed, without area/revoked/demoted refused, owner allowed`, async () => authMatrix(await draft(kind), call, approve));
for (const popup of [false, true]) for (const approve of [true, false]) test(`${popup ? 'Popup' : 'Direct'} decision ${approve ? 'Approve' : 'Reject'}: real DAL auth matrix`, async () => {
  const c = await decision();
  const call = popup ? c => (approve ? waiting.approveWaiting : waiting.declineWaiting)(`decision:${c.d.id}`, c.d.content_hash) : c => approve ? decisions.approveDecisionAction(c.d.id, c.d.content_hash) : decisions.rejectDecisionAction(c.d.id, 'Declined', c.d.content_hash);
  await authMatrix(c, call, approve);
  // Request changes shares the direct decision resolver; test its exported
  // action too so delegated authority covers every changed web entry point.
  if (!popup && !approve) await authMatrix(await decision(), c => decisions.requestChangesAction(c.d.id, 'Use oak', c.d.content_hash), false, 'changes_requested');
});
test('owner JWT cannot override a database demotion on any approve path', async () => {
  const c = await draft(), d = await decision();
  await f.run(`UPDATE users SET role='staff',permissions='{}' WHERE id=$1`, [f.owner.id]);
  assert.equal((await dal.getCurrentUser()).role, 'staff');
  for (const [, , approve, call] of paths) if (approve) await denied(c, call);
  await denied(d, c => decisions.approveDecisionAction(c.d.id, c.d.content_hash));
});
test('notification polling offers staff only authorized cards; revoked sessions see none', async () => {
  const c = await draft();
  globalThis.r5Session = staffToken;
  assert.equal((await waiting.pollNotificationCenter(null)).approvals.find(a => a.id === c.w.id).contentHash, c.v.binding);
  await f.run(`UPDATE users SET permissions='{}' WHERE id=$1`, [staff.id]);
  assert.deepEqual((await waiting.pollNotificationCenter(null)).approvals, []);
  globalThis.r5Session = f.bearer;
  const v = (await waiting.pollNotificationCenter(null)).approvals.find(a => a.id === c.w.id);
  assert.equal(v.contentHash, c.v.binding);
  await f.run(`INSERT INTO session_revocations(user_id,revoked_before) VALUES($1,now()+interval '1 second')`, [f.owner.id]);
  assert.equal(await waiting.pollNotificationCenter(null), null);
});
test('all staff and owner web approve paths refuse stale drafts with the exact recovery copy', async () => {
  for (const token of [staffToken, f.bearer]) {
    globalThis.r5Session = token;
    for (const [, kind, approve, call] of paths) if (approve) {
      const c = await draft(kind), before = await evidence(c);
      await f.run(`UPDATE knowledge_items SET content='Subject: New quote\n\nNew $9900.' WHERE id=$1`, [c.k.id]);
      assert.deepEqual(await call(c), { ok: false, error: changed });
      assert.deepEqual(await evidence(c), before);
    }
  }
});

async function decision() {
  const c = await f.decision();
  [c.d] = await f.run(`UPDATE decisions SET kind='proposal',action='proposal' WHERE id=$1 RETURNING *`, [c.d.id]);
  return c;
}
async function grantAuthority() {
  await f.run(`INSERT INTO authority_grants(user_id,action_type,granted_by) VALUES($1,'proposal',$2)`, [staff.id, f.owner.id]);
}
for (const area of ['engine', 'today']) test(`${area}-only staff can answer only that area's work-item surfaces`, async () => {
  globalThis.r5Session = staffToken;
  await f.run(`UPDATE users SET permissions=$2 WHERE id=$1`, [staff.id, [area]]);
  for (const [name, kind, approve, call] of paths) {
    const c = await draft(kind), allowed = name.startsWith('Engine') ? area === 'engine' : area === 'today';
    if (allowed) assert.equal((await call(c)).ok, true, name);
    else await denied(c, call);
  }
});
test('decision authority, rather than area access, authorizes staff web answers', async () => {
  globalThis.r5Session = staffToken;
  for (const call of [c => decisions.approveDecisionAction(c.d.id,c.d.content_hash), c => decisions.rejectDecisionAction(c.d.id,'No',c.d.content_hash), c => decisions.requestChangesAction(c.d.id,'Oak',c.d.content_hash)]) {
    const c = await decision(); await denied(c,call);
    await grantAuthority(); assert.equal((await call(c)).ok,true);
    await f.run(`DELETE FROM authority_grants WHERE user_id=$1`,[staff.id]);
  }
});
test('grant decisions stay owner-only through direct and popup web actions', async () => {
  globalThis.r5Session = staffToken; await grantAuthority();
  const c = await decision();
  [c.d] = await f.run(`UPDATE decisions SET kind='grant' WHERE id=$1 RETURNING *`,[c.d.id]);
  for (const call of [c => decisions.approveDecisionAction(c.d.id,c.d.content_hash),c => decisions.rejectDecisionAction(c.d.id,'No',c.d.content_hash),c => decisions.requestChangesAction(c.d.id,'Oak',c.d.content_hash),c => waiting.approveWaiting(`decision:${c.d.id}`,c.d.content_hash),c => waiting.declineWaiting(`decision:${c.d.id}`,c.d.content_hash)]) await denied(c,call);
  assert.ok(!(await waiting.pollNotificationCenter(null)).approvals.some(a => a.id === c.d.id));
});
async function telegram(c, verb, mapped = true, isDecision = false) {
  const chat=process.env.TELEGRAM_OWNER_CHAT_ID, mid=++globalThis.phoneTelegramSeq, uid=++globalThis.phoneTelegramSeq;
  if (mapped && !isDecision) {
    const m=await f.recordAppMessage({kind:'decision',title:'Quote',telegram:{workItemId:c.w.id}});
    await f.run(`UPDATE owner_push_messages SET telegram_message_id=$2 WHERE id=$1`,[m.id,String(mid)]);
  }
  const {POST}=await import('../app/api/telegram/webhook/route.ts');
  const r=await POST(new Request('http://local/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'test-secret'},body:JSON.stringify({update_id:uid,callback_query:{id:`qa-${uid}`,from:{id:chat},message:{message_id:mid,chat:{id:chat}},data:isDecision?`d|${c.d.id}|${c.d.content_hash.slice(0,12)}|${verb}`:`w|${c.w.id}|${verb}`}})}));
  assert.equal(r.status,200); return r.json();
}
for (const state of ['inactive','demoted','absent']) test(`Telegram ${state} owner: bound/legacy draft and decision callbacks refuse without effects`, async () => {
  for (const [verb,mapped,isDecision] of [['a',true,false],['r',true,false],['r',false,false],['a',false,true],['c',false,true],['h',false,true]]) {
    const c=isDecision?await decision():await draft();
    // 'absent' has no owner row at all, not merely an inactive owner.
    await f.run(state==='inactive'?`UPDATE users SET active=false WHERE id=$1`:state==='demoted'?`UPDATE users SET role='staff' WHERE id=$1`:`DELETE FROM users WHERE id=$1`,[f.owner.id]);
    const before=await evidence(c), r=await telegram(c,verb,mapped,isDecision);
    assert.equal(r.ok,true); assert.equal(r.outcome,'refused: no owner principal');
    assert.deepEqual(await evidence(c),before);
    if(state==='absent') await f.run(`INSERT INTO users(id,email,password_hash,name,role,initials) VALUES($1,$2,'x','Joe','owner','JS')`,[f.owner.id,f.owner.email]);
    else await f.run(`UPDATE users SET active=true,role='owner' WHERE id=$1`,[f.owner.id]);
  }
});
test('Telegram active owner: frozen bound Approve, bound/legacy Reject and decision verbs work', async () => {
  const c=await draft(); assert.equal((await telegram(c,'a')).ok,true);
  assert.equal(sends().length,1); assert.equal(sends()[0].payload.bodyText,c.v.body);
  assert.equal((await telegram(c,'a')).ok,true); assert.equal(sends().length,1);
  for(const mapped of [true,false]) {const c=await draft(); await telegram(c,'r',mapped); assert.equal((await f.run(`SELECT approval_status FROM work_items WHERE id=$1`,[c.w.id]))[0].approval_status,'rejected');}
  for(const verb of ['a','c','h']) {const c=await decision(); const r=await telegram(c,verb,false,true); assert.equal(r.ok,true); assert.ok(!r.outcome.startsWith('refused'));}
});
