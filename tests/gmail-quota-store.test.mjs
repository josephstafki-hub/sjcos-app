// lib/gmail.ts re-reads only what Gmail says changed, books every call against
// the per-minute budget, keeps sends patient, and (opt-in) hands a refused send
// to Gmail's mail server. A fake mailbox with real historyId semantics stands
// in for Google: no credentials, no network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

process.env.GMAIL_CLIENT_ID = 'test';
process.env.GMAIL_CLIENT_SECRET = 'test';
process.env.GMAIL_RETRY_SCALE = '0.001';
process.env.GMAIL_SMTP_FALLBACK = '1';

// ─── Fake mailbox ────────────────────────────────────────────────────────────
const box = {
  history: 100, floor: 0, records: [], threads: new Map(), calls: {}, sendFailures: 0, sent: [],
  rateLimit: () => Object.assign(new Error("Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'"), { code: 429 }),
};
const count = (k) => { box.calls[k] = (box.calls[k] ?? 0) + 1; };
const message = (threadId, n, from = 'Client <client@example.test>') => ({
  id: `${threadId}-m${n}`, threadId, internalDate: String(1_000_000 + n), labelIds: ['INBOX'], snippet: `hello ${n}`,
  payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: from }, { name: 'To', value: 'joe@example.test' }, { name: 'Subject', value: `Subject ${threadId}` }, { name: 'Message-ID', value: `<${threadId}-${n}@mail.test>` }], body: { data: Buffer.from(`Body ${n}`).toString('base64url') } },
});
function touch(threadId, kind = 'labelsAdded') {
  box.history += 1;
  const t = box.threads.get(threadId);
  t.historyId = String(box.history);
  box.records.push({ id: String(box.history), [kind]: [{ message: { id: t.messages.at(-1).id, threadId } }] });
}
function seed(ids) {
  box.history = 100; box.floor = 0; box.records = []; box.threads = new Map(); box.calls = {}; box.sendFailures = 0; box.sent = [];
  ids.forEach((id, i) => box.threads.set(id, { id, historyId: String(50 + i), messages: [message(id, i + 1)] }));
}
const threadOut = (t) => ({ id: t.id, historyId: t.historyId, snippet: t.messages.at(-1).snippet, messages: structuredClone(t.messages) });

globalThis.__quotaFake = {
  mailbox: { email: 'joe@example.test', refreshToken: 'tok-1' },
  api: { users: {
    getProfile: async () => { count('getProfile'); return { data: { emailAddress: 'joe@example.test', historyId: String(box.history) } }; },
    history: { list: async ({ startHistoryId }) => {
      count('history.list');
      if (Number(startHistoryId) < box.floor) throw Object.assign(new Error('Requested entity was not found.'), { code: 404 });
      return { data: { history: box.records.filter((r) => Number(r.id) > Number(startHistoryId)), historyId: String(box.history) } };
    } },
    threads: {
      list: async ({ maxResults = 100 }) => { count('threads.list'); return { data: { threads: [...box.threads.values()].reverse().slice(0, maxResults).map((t) => ({ id: t.id, historyId: t.historyId, snippet: '' })) } }; },
      get: async ({ id, format }) => { count(`threads.get:${format}`); count(`get:${id}`); const out = threadOut(box.threads.get(id)); if (box.gate) await box.gate; return { data: out }; },
      modify: async ({ id }) => { count('threads.modify'); touch(id, 'labelsRemoved'); return { data: {} }; },
      trash: async ({ id }) => { count('threads.trash'); touch(id); return { data: {} }; },
    },
    labels: {
      list: async () => { count('labels.list'); return { data: { labels: [{ id: 'L1', name: 'Jobs', type: 'user' }, { id: 'INBOX', name: 'INBOX', type: 'system' }] } }; },
      get: async () => { count('labels.get'); return { data: { threadsTotal: 7 } }; },
    },
    messages: {
      send: async (args) => {
        count('messages.send');
        if (box.sendFailures > 0) { box.sendFailures--; throw box.rateLimit(); }
        box.sent.push(args);
        return { data: { id: 'sent-1', threadId: args.requestBody?.threadId ?? 'new-thread' } };
      },
      list: async () => { count('messages.list'); return { data: { messages: [{ id: 'm', threadId: 'smtp-thread' }] } }; },
    },
  } },
};

registerHooks({
  resolve(s, c, n) {
    if (s === 'server-only') return { url: 'qfake:empty', shortCircuit: true };
    if (s === 'googleapis') return { url: 'qfake:google', shortCircuit: true };
    if (s === './mailbox' && c.parentURL?.endsWith('/lib/gmail.ts')) return { url: 'qfake:mailbox', shortCircuit: true };
    if (s.startsWith('./') && c.parentURL?.endsWith('.ts') && !s.endsWith('.ts')) { try { return n(s + '.ts', c); } catch {} }
    return n(s, c);
  },
  load(u, c, n) {
    const sources = {
      'qfake:empty': '',
      'qfake:mailbox': 'export const activeMailbox = () => globalThis.__quotaFake.mailbox;',
      'qfake:google': `export const google = { auth: { OAuth2: class { setCredentials() {} async getAccessToken() { return { token: 'access-token' }; } } }, gmail: () => globalThis.__quotaFake.api };`,
    };
    return u in sources ? { format: 'module', source: sources[u], shortCircuit: true } : n(u, c);
  },
});
const gmail = await import('../lib/gmail.ts');
const quota = await import('../lib/gmail-quota.ts');
const smtp = await import('../lib/gmail-smtp.ts');

let tokenN = 0;
beforeEach(() => {
  // A fresh credential per test = a fresh mailbox store and quota ledger.
  globalThis.__quotaFake.mailbox = { email: 'joe@example.test', refreshToken: `tok-${++tokenN}` };
  quota.resetGmailQuotaForTests();
});

test('an unchanged mailbox reloads the inbox for one 2-unit history check — no list, no thread reads', async () => {
  seed(['A', 'B', 'C']);
  const first = await gmail.fetchThreadPage(50);
  assert.equal(first.threads.length, 3);
  assert.equal(box.calls['threads.get:full'], 3);
  box.calls = {};
  gmail.expireGmailSyncForTests(); // past the 5 s reuse window
  const again = await gmail.fetchThreadPage(50);
  assert.deepEqual(again.threads.map((t) => t.id), first.threads.map((t) => t.id));
  assert.deepEqual(box.calls, { 'history.list': 1 }, 'one change-log check, nothing else');
});

test('a change Gmail reports re-reads exactly that thread; the rest come from kept copies', async () => {
  seed(['A', 'B', 'C']);
  await gmail.fetchThreadPage(50);
  box.threads.get('B').messages.push(message('B', 9));
  touch('B', 'messagesAdded');
  await gmail.modifyThread('C', { removeLabelIds: ['INBOX'] }); // our own change marks C too
  box.calls = {};
  gmail.expireGmailSyncForTests();
  const page = await gmail.fetchThreadPage(50);
  assert.equal(box.calls['threads.list'], 1, 'one re-list');
  assert.equal(box.calls['threads.get:full'], 2, 'only B and C re-read');
  assert.equal(box.calls['get:A'], undefined);
  assert.equal(page.threads.find((t) => t.id === 'B').bodyParas[0], 'Body 9', 'the new message shows');
});

test('a history point Gmail can no longer replay starts over from the profile instead of serving stale mail', async () => {
  seed(['A', 'B']);
  await gmail.fetchThreadPage(50);
  box.floor = 10_000; // every history point is now "too old"
  touch('A');
  box.calls = {};
  gmail.expireGmailSyncForTests();
  await gmail.fetchThreadPage(50);
  assert.equal(box.calls['history.list'], 1);
  assert.equal(box.calls.getProfile, 1, 'baseline re-read');
  assert.equal(box.calls['threads.get:full'], 2, 'everything re-read once after the reset');
});

test('the hourly scan reuses copies whose historyId has not moved (including full copies from the inbox)', async () => {
  seed(['A', 'B', 'C', 'D']);
  await gmail.fetchThreadPage(2); // C and D read in full by the inbox
  box.calls = {};
  const first = await gmail.fetchThreadMetadata({ max: 100 });
  assert.equal(first.length, 4);
  assert.equal(box.calls['threads.get:metadata'], 2, 'A and B only — C and D come from the full copies');
  touch('A', 'messagesAdded');
  box.calls = {};
  await gmail.fetchThreadMetadata({ max: 100 });
  assert.equal(box.calls['threads.get:metadata'], 1, 'only the thread that moved');
  assert.equal(box.calls['get:A'], 1);
});

test('label counts are re-counted only after a change, not on every refresh', async () => {
  seed(['A']);
  const first = await gmail.fetchLabelCounts();
  assert.deepEqual(first, [{ id: 'L1', name: 'Jobs', count: 7 }]);
  await gmail.fetchLabelCounts();
  await gmail.fetchLabelCounts();
  assert.equal(box.calls['labels.list'], 1);
  assert.equal(box.calls['labels.get'], 1);
});

test('database-only link actions no longer force a Gmail reload', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../lib/actions/inbox.ts', import.meta.url), 'utf8'));
  for (const fn of ['linkThread', 'unlinkThread', 'retryInquiryLinkAction']) {
    const body = src.slice(src.indexOf(`export async function ${fn}`), src.indexOf('\n}\n', src.indexOf(`export async function ${fn}`)));
    assert.doesNotMatch(body, /invalidateInboxCache\(\)/, `${fn} only touches our database`);
  }
});

test('opening a thread the inbox already read costs nothing; HTML is kept per message', async () => {
  seed(['A']);
  await gmail.fetchThreadPage(50);
  box.calls = {};
  const convo = await gmail.fetchConversation('A');
  assert.equal(convo.messages.length, 1);
  assert.equal(box.calls['threads.get:full'], undefined);
});

test('a send Gmail refuses for quota goes through the mail server when the backstop is on', async () => {
  seed(['A']);
  const script = [];
  smtp.smtpTransport.connect = async () => fakeSmtpServer(script, { auth: 'ok' });
  box.sendFailures = 1;
  const sent = await gmail.sendNewEmail({ to: 'client@example.test', cc: 'ana@example.test', subject: 'Plans', bodyText: 'See attached.\n.\nThanks' });
  assert.equal(box.calls['messages.send'], 1, 'one API try, then straight to SMTP');
  assert.equal(box.sent.length, 0);
  assert.ok(script.includes('RCPT TO:<client@example.test>') && script.includes('RCPT TO:<ana@example.test>'));
  const data = script.find((l) => l.startsWith('DATA-BODY:'));
  assert.match(data, /From: joe@example\.test/);
  assert.match(data, /\r\n\.\.\r\n/, 'a lone dot line is dot-stuffed');
  assert.equal(sent.threadId, 'smtp-thread', 'thread found by Message-ID for linking');
});

test('without mail-server permission the send waits out the quota on the API instead', async () => {
  seed(['A']);
  smtp.smtpTransport.connect = async () => fakeSmtpServer([], { auth: 'refused' });
  box.sendFailures = 2;
  const sent = await gmail.sendNewEmail({ to: 'client@example.test', subject: 'Plans', bodyText: 'Hi' });
  assert.equal(sent.threadId, 'new-thread');
  assert.equal(box.calls['messages.send'], 3, 'one try, SMTP refused, then patient retries until it lands');
  assert.equal(box.sent.length, 1);
});

test('a reply that keeps getting refused retries patiently (whole minute), not 3 tries in 5 s', async () => {
  seed(['A']);
  process.env.GMAIL_SMTP_FALLBACK = '0';
  try {
    box.sendFailures = 4;
    await gmail.sendReply({ threadId: 'A', bodyText: 'Thanks' });
    assert.equal(box.calls['messages.send'], 5);
    assert.equal(box.sent[0].requestBody.threadId, 'A');
  } finally {
    process.env.GMAIL_SMTP_FALLBACK = '1';
  }
});

test('if the mail server drops after taking the message, the send says it may have gone — and is not retried', async () => {
  seed(['A']);
  smtp.smtpTransport.connect = async () => fakeSmtpServer([], { auth: 'ok', dropAfterData: true });
  box.sendFailures = 1;
  await assert.rejects(gmail.sendNewEmail({ to: 'client@example.test', subject: 'Plans', bodyText: 'Hi' }), /may have been sent/);
  assert.equal(box.calls['messages.send'], 1, 'no second copy through the API');
});

test('a mail server that is unavailable before the message goes falls back to waiting on the API', async () => {
  seed(['A']);
  smtp.smtpTransport.connect = async () => fakeSmtpServer([], { auth: 'ok', greeting: '421 4.7.0 Try again later' });
  box.sendFailures = 1;
  const sent = await gmail.sendNewEmail({ to: 'client@example.test', subject: 'Plans', bodyText: 'Hi' });
  assert.equal(sent.threadId, 'new-thread');
  assert.equal(box.sent.length, 1);
});

test('SMTP message hygiene: Bcc stays off the headers, long lines stay on the API, dots are stuffed by line', () => {
  const p = smtp.prepareSmtpMime('To: a@x.test\r\nBcc: secret@x.test,\r\n other@x.test\r\nSubject: Hi\r\n\r\nBody', 'joe@example.test');
  assert.doesNotMatch(p.mime, /secret|other@/);
  assert.match(p.mime, /^From: joe@example\.test\r\n/);
  assert.deepEqual(smtp.mimeRecipients('To: A <a@x.test>\r\nCc: b@x.test\r\nBcc: c@x.test\r\n\r\nx'), ['a@x.test', 'b@x.test', 'c@x.test']);
  assert.equal(smtp.smtpSafe('To: a\r\n\r\n' + 'x'.repeat(999)), false);
  assert.equal(smtp.smtpData('a\u2028.b\n.c\n'), 'a\u2028.b\r\n..c\r\n.\r\n');
});

test('a thread read that was in flight when the mailbox changed is used but not kept', async () => {
  seed(['A', 'B']);
  let open;
  box.gate = new Promise((r) => { open = r; });
  const reading = gmail.fetchConversation('A');
  await new Promise((r) => setImmediate(r));
  await gmail.modifyThread('B', { addLabelIds: ['STARRED'] }); // mailbox moves mid-read
  open(); box.gate = null;
  await reading;
  await gmail.fetchConversation('A');
  assert.equal(box.calls['get:A'], 2, 'read again rather than trusting a copy that may predate the change');
});

// ─── Scripted SMTP server ────────────────────────────────────────────────────
function fakeSmtpServer(log, { auth, greeting = '220 smtp.gmail.com ESMTP', dropAfterData = false }) {
  const handlers = {};
  let inData = false, data = '';
  const reply = (line) => setImmediate(() => handlers.data?.(Buffer.from(line + '\r\n')));
  setImmediate(() => reply(greeting));
  return {
    on(ev, cb) { handlers[ev] = cb; },
    write(chunk) {
      if (inData) {
        data += chunk;
        if (data.endsWith('\r\n.\r\n')) { inData = false; log.push('DATA-BODY:' + data); if (dropAfterData) setImmediate(() => handlers.close?.()); else reply('250 2.0.0 OK queued'); }
        return;
      }
      for (const line of chunk.split('\r\n').filter((l, i, a) => i < a.length - 1)) {
        log.push(line.startsWith('AUTH') ? 'AUTH' : line);
        if (line.startsWith('EHLO')) reply('250-smtp.gmail.com\r\n250-8BITMIME\r\n250 AUTH XOAUTH2');
        else if (line.startsWith('AUTH')) reply(auth === 'ok' ? '235 2.7.0 Accepted' : '334 eyJzdGF0dXMiOiI0MDAifQ==');
        else if (line === '' && auth !== 'ok') reply('535 5.7.8 Username and Password not accepted');
        else if (line.startsWith('MAIL') || line.startsWith('RCPT')) reply('250 2.1.0 OK');
        else if (line === 'DATA') { inData = true; reply('354 Go ahead'); }
        else if (line === 'QUIT') reply('221 bye');
      }
    },
    end() { setImmediate(() => handlers.close?.()); },
    destroy() {},
  };
}
