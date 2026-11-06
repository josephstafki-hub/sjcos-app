// Expectations written FIRST in phone-push-r9-expectations.md.
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
let seq = 990000000, messageId = 910000;
let calls = [], emails = [];
const originalFetch = globalThis.fetch;
before(async () => {
  // Fail closed if any unmocked provider is accidentally reached.
  globalThis.fetch = async () => { throw new Error('Unexpected network request in R9 test'); };
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
    id: `r9-${seq}`, from: { id: chat }, message: { message_id: c.mid, chat: { id: chat } },
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
async function countEvents(c, kind) {
  return (await f.run(`SELECT count(*)::int AS n FROM decision_events WHERE decision_id=$1 AND kind=$2`, [c.d.id, kind]))[0].n;
}
async function committedAndUnlocked(c, update) {
  // Independent connection: same non-key update as Profile, same judge timeout.
  const client = await f.db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout='1500ms'`);
    await client.query(`UPDATE users SET name='Legitimate Profile edit',initials='LP' WHERE id=$1`, [f.owner.id]);
    await client.query(c.d ? `SELECT id FROM decisions WHERE id=$1 FOR UPDATE` : `SELECT id FROM work_items WHERE id=$1 FOR UPDATE`, [c.d?.id ?? c.w.id]);
    const { rows: [audit] } = await client.query(`SELECT u.outcome,s.state,s.processed_at FROM telegram_updates u JOIN source_events s ON s.provider='telegram' AND s.event_id=u.update_id::text WHERE u.update_id=$1`, [update.update_id]);
    assert.ok(audit?.outcome, 'update outcome committed before transport');
    assert.equal(audit.state, 'done');
    assert.ok(audit.processed_at);
    await client.query('COMMIT');
  } finally {
    await client.query('ROLLBACK'); client.release();
  }
}
function deferred() {
  let resolve;
  return { promise: new Promise(r => { resolve = r; }), resolve: () => resolve() };
}
async function within(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Expected Telegram call never reached')), 5000); })]);
  } finally { clearTimeout(timer); }
}
async function stalled(c, update, method, verify) {
  const reached = deferred(), release = deferred();
  let intercepted = false, settled = false, captured;
  telegram.call = async (name, body) => {
    if (!intercepted && name === (method === 'routeEdit' ? 'editMessageText' : method) && (method !== 'routeEdit' || /^\[SJC OS\] (?:Declined:|Emailed )/.test(body.text))) {
      intercepted = true; captured = body; reached.resolve(); await release.promise;
    }
    return baseCall(name, body);
  };
  const pending = post(update).finally(() => { settled = true; });
  try {
    await within(Promise.race([reached.promise, pending.then(result => { throw new Error(`Webhook finished without reaching ${method}: ${JSON.stringify(result)}`); })]));
    assert.equal(settled, false, 'transport remains paused');
    await committedAndUnlocked(c, update);
    await verify(captured);
    assert.equal(settled, false, 'Profile update finished while transport is still paused');
  } finally {
    release.resolve(); telegram.call = baseCall;
    const result = await pending;
    assert.equal(result.ok, true, JSON.stringify(result));
  }
}
async function replay(update) {
  const result = await post(update);
  assert.equal(result.ok, true); assert.equal(result.duplicate, true);
}

test('Hold card edit stall: judge repro commits Hold and frees Profile/target locks', async () => {
  const c = await card(), update = callback(c, 'h');
  await stalled(c, update, 'editMessageText', async body => {
    assert.ok((await row(c)).held_until);
    assert.equal(await countEvents(c, 'held'), 1);
    const { getDecision } = await import('../lib/commands/decisions.ts');
    const { cardText } = await import('../lib/decisions/cards.ts');
    assert.equal(body.text, cardText(await getDecision(f.run, c.d.id), { appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://os.sjcarpentryllc.com' }) + '\n(held 4h)');
    assert.equal(calls.find(x => x.method === 'answerCallbackQuery').body.text, 'Held for 4 hours.');
    await replay(update);
    assert.equal(await countEvents(c, 'held'), 1);
  });
});

test('Hold callback toast stall also releases Profile/target locks', async () => {
  const c = await card(), update = callback(c, 'h');
  await stalled(c, update, 'answerCallbackQuery', async body => {
    assert.equal(body.text, 'Held for 4 hours.');
    assert.ok((await row(c)).held_until);
    assert.equal(await countEvents(c, 'held'), 1);
    assert.equal(calls.length, 0, 'card edit follows the toast');
  });
});

test('First decision Approve toast and card edit wait only after approval commit', async () => {
  for (const method of ['answerCallbackQuery', 'editMessageText']) {
    const c = await card(), update = callback(c, 'a');
    await stalled(c, update, method, async body => {
      assert.equal((await row(c)).status, 'approved');
      assert.equal(await countEvents(c, 'approved'), 1);
      if (method === 'answerCallbackQuery') assert.equal(body.text, 'Approved ✓');
      else assert.match(body.text, /Status: approved via telegram/);
      await replay(update);
      assert.equal(await countEvents(c, 'approved'), 1);
    });
  }
});

test('New-update Approve replay defers both toast and card edit without reapproving', async () => {
  for (const method of ['answerCallbackQuery', 'editMessageText']) {
    const c = await card(); assert.equal((await post(callback(c, 'a'))).ok, true);
    const before = await row(c), update = callback(c, 'a');
    await stalled(c, update, method, async body => {
      assert.deepEqual(await row(c), before);
      assert.equal(await countEvents(c, 'approved'), 1);
      if (method === 'answerCallbackQuery') assert.match(body.text, /^Approved ✓ — already approved .* via telegram\.$/);
      else assert.match(body.text, /Status: approved via telegram/);
    });
  }
});

test('Draft Reject commits before stalled toast/card edit and duplicates never send', async () => {
  for (const method of ['answerCallbackQuery', 'editMessageText', 'routeEdit']) {
    const c = await card('draft'), update = callback(c, 'r');
    await stalled(c, update, method, async body => {
      assert.equal((await row(c)).approval_status, 'rejected');
      assert.match(body.text, /[Dd]eclined|[Rr]ejected/);
      await replay(update); assert.equal(emails.length, 0);
      assert.equal((await row(c)).approval_status, 'rejected');
    });
  }
});

test('Email draft Approve sends displayed snapshot once before stalled toast/card edit', async () => {
  for (const method of ['answerCallbackQuery', 'editMessageText', 'routeEdit']) {
    emails = [];
    const c = await emailCard(), update = callback(c, 'a');
    await stalled(c, update, method, async body => {
      assert.equal((await row(c)).approval_status, 'approved');
      assert.equal(body.text, method === 'answerCallbackQuery' ? 'Emailed client@example.test — Displayed quote' : method === 'routeEdit' ? '[SJC OS] Emailed client@example.test — Displayed quote\nhttps://os.sjcarpentryllc.com/today' : '[SJC OS] Review internal checklist\nEmailed client@example.test — Displayed quote');
      assert.equal((await f.run(`SELECT count(*)::int AS n FROM approved_work_item_drafts WHERE work_item_id=$1`, [c.w.id]))[0].n, 1);
      assert.equal(emails.length, 1);
      assert.equal(emails[0].subject, 'Displayed quote'); assert.equal(emails[0].bodyText, 'Displayed $100.');
      await replay(update); assert.equal(emails.length, 1);
    });
  }
});

test('Request changes toast and sendMessage prompt are post-commit and duplicate-safe', async () => {
  for (const method of ['answerCallbackQuery', 'sendMessage']) {
    calls = [];
    const c = await card(), update = callback(c, 'c');
    await stalled(c, update, method, async body => {
      assert.equal((await row(c)).status, 'pending');
      assert.equal((await f.run(`SELECT count(*)::int AS n FROM owner_replies WHERE decision_id=$1`, [c.d.id]))[0].n, 0);
      assert.equal(body.text, method === 'answerCallbackQuery' ? 'Reply with what should change.' : `What should change on "${c.d.title}"?\nReply to this message. That pulls the request and sends your note to the agent that filed it.`);
      await replay(update);
    });
    assert.equal(calls.filter(x => x.method === 'sendMessage').length, 1);
    assert.equal((await f.run(`SELECT count(*)::int AS n FROM telegram_reply_targets WHERE decision_id=$1 AND kind='prompt'`, [c.d.id]))[0].n, 1);
  }
});

test('Text changes reply commits pull/note/handoff before stalled acknowledgment', async () => {
  const c = await card(), chat = process.env.TELEGRAM_OWNER_CHAT_ID;
  const update = { update_id: ++seq, message: { message_id: ++messageId, chat: { id: chat }, from: { id: chat }, text: 'Use oak please.', reply_to_message: { message_id: c.mid } } };
  await stalled(c, update, 'sendMessage', async body => {
    const d = await row(c); assert.equal(d.status, 'rejected'); assert.equal(d.decision_note, 'Changes requested: Use oak please.');
    const notes = await f.run(`SELECT body,state,trigger_id FROM owner_replies WHERE decision_id=$1`, [c.d.id]);
    assert.equal(notes.length, 1); assert.equal(notes[0].body, 'Use oak please.'); assert.equal(notes[0].state, 'delivered'); assert.ok(notes[0].trigger_id);
    assert.equal(body.text, `Got it. Pulled "${c.d.title}". No chat is attached to that request, so the operating agent takes your note (within a few minutes). Its answer comes here.`);
    await replay(update);
    assert.equal((await f.run(`SELECT count(*)::int AS n FROM owner_replies WHERE decision_id=$1`, [c.d.id]))[0].n, 1);
  });
  assert.equal(calls.filter(x => x.method === 'sendMessage').length, 1);
});

test('Stale/inactive/resolved refusal toasts commit evidence and free locks', async () => {
  for (const kind of ['stale', 'inactive', 'changes-resolved', 'hold-resolved']) {
    const c = await card(); let expected, update;
    if (kind.endsWith('resolved')) {
      await post(callback(c, 'a'));
      update = callback(c, kind === 'changes-resolved' ? 'c' : 'h');
      expected = kind === 'changes-resolved' ? 'Already approved.' : 'Cannot hold — already approved.';
    } else if (kind === 'inactive') {
      await f.run(`UPDATE users SET active=false WHERE id=$1`, [f.owner.id]);
      update = callback(c, 'h'); expected = 'No active owner account. Nothing was changed.';
    } else {
      update = callback(c, 'h', { data: `d|${c.d.id}|${c.d.content_hash[0] === 'f' ? 'e' : 'f'}00000000000|h` });
      expected = 'This card is out of date — the package changed. Open the current card in SJC OS.';
    }
    const before = await row(c);
    await stalled(c, update, 'answerCallbackQuery', async body => {
      assert.equal(body.text, expected); assert.deepEqual(await row(c), before);
      if (kind === 'stale') assert.equal(await countEvents(c, 'replay_ignored'), 1);
      await replay(update); assert.deepEqual(await row(c), before);
    });
    await f.run(`UPDATE users SET active=true WHERE id=$1`, [f.owner.id]);
  }
});

test('Rollback after Hold produces no outbound replies or committed dedupe; retry works once', async () => {
  const c = await card(), update = callback(c, 'h'), pool = f.db.pool, connect = pool.connect;
  const before = await row(c); let injected = false;
  pool.connect = function (...args) {
    if (args.length) return connect.apply(this, args);
    return connect.call(this).then(client => {
      const query = client.query, done = client.release;
      client.query = function (sql, ...params) {
        if (!injected && typeof sql === 'string' && sql.startsWith('UPDATE telegram_updates SET outcome')) {
          injected = true; return Promise.reject(new Error('R9 forced pre-commit failure'));
        }
        return query.call(this, sql, ...params);
      };
      client.release = function (...args) { client.query = query; client.release = done; return done.apply(this, args); };
      return client;
    });
  };
  try {
    const result = await post(update); assert.equal(result.ok, false); assert.equal(result.error, 'R9 forced pre-commit failure');
  } finally { pool.connect = connect; }
  assert.equal(injected, true); assert.deepEqual(await row(c), before); assert.deepEqual(calls, []);
  assert.equal(await countEvents(c, 'held'), 0);
  assert.equal((await f.run(`SELECT * FROM telegram_updates WHERE update_id=$1`, [update.update_id])).length, 0);
  assert.equal((await f.run(`SELECT * FROM source_events WHERE provider='telegram' AND event_id=$1`, [String(update.update_id)])).length, 0);
  assert.equal((await post(update)).ok, true); await replay(update);
  assert.equal(await countEvents(c, 'held'), 1);
});
