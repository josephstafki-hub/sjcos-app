import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { z } from 'zod';
import { registerGrantTools } from '../mcp/grants-tools.mjs';

// Real service/actions + real SQL, isolated QA DB ONLY. All fixture writes roll
// back. Auth, email, file storage and downstream business hooks are stubbed.
const url = process.env.SJCOS_ESIGN_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, 'localhost');
  assert.equal(parsed.port, '5499');
  assert.equal(parsed.pathname, '/sjcos');
}
const client = url ? new pg.Client({ connectionString: url }) : null;
const root = new URL('../', import.meta.url);
const lib = (p) => new URL(`lib/${p}.ts`, root).href;
let hookCalls = 0, stored = 0, mailCalls = 0, mailMode = 'disconnected';
let beforeHeaders = async () => {};
let beforeAttach = async () => {};
const run = async (sql, params) => {
  if (/UPDATE document_drafts SET signature_request_id = \$2/.test(sql)) await beforeAttach();
  return client.query(sql, params);
};
const txClient = {
  query(sql, params) {
    if (sql === 'BEGIN') return run('SAVEPOINT esign_service');
    if (sql === 'COMMIT') return run('RELEASE SAVEPOINT esign_service');
    if (sql === 'ROLLBACK') return run('ROLLBACK TO SAVEPOINT esign_service');
    return run(sql, params);
  },
  release() {},
};
globalThis.__esignTest = {
  query: run,
  headers: async () => { await beforeHeaders(); return new Headers(); },
  queryOne: async (sql, p) => (await run(sql, p)).rows[0] ?? null,
  pool: { connect: async () => txClient },
  gmailConfigured: () => mailMode !== 'disconnected',
  sendNewEmail: async () => { mailCalls++; if (mailMode === 'error') throw new Error('ZZ QA mail transport failed'); },
  storeBuffer: async () => { stored++; return { ok: false, error: 'Test storage disabled' }; },
  hook: async () => { hookCalls++; },
};
const fwd = (...names) => names.map(n => `export const ${n} = (...a) => globalThis.__esignTest.${n}(...a);`).join('\n');
const stubs = {
  'server-only': '',
  'next/cache': 'export const revalidatePath = () => {};',
  'next/headers': fwd('headers'),
  [lib('db')]: fwd('query', 'queryOne') + '\nexport const pool = globalThis.__esignTest.pool; export const bumpLiveChange = () => {};',
  [lib('dal')]: `const user = { id: null, role: 'client', name: 'ZZ QA Owner', linkSlug: 'lead:zz-qa-esign-regression' };
    export const requireAccess = async () => user; export const requireRole = async () => user;`,
  [lib('notify')]: 'export const emit = async () => {};',
  [lib('notify-owner')]: 'export const notifyOwner = async () => {};',
  [lib('agent-memory')]: 'export const captureAgentMemory = async () => {};',
  [lib('client-activity')]: `export const logClientActivity = async () => {}; export const ownerHrefForLinkSlug = () => '/today'; export const ownerHref = () => '/today';`,
  [lib('upload-store')]: fwd('storeBuffer'),
  [lib('uploads')]: "export const UPLOAD_DIR = '/nonexistent-esign-test-uploads';",
  [lib('gmail')]: fwd('gmailConfigured', 'sendNewEmail'),
  [lib('client-invites')]: `export const ensureClientInvite = async () => ({ token: 'zz-qa-test' }); export const inviteLink = () => 'https://example.test/portal';`,
  [lib('approval-gate')]: 'export const getApprovalGate = async () => ({});',
  [lib('doc-render')]: 'export const renderTemplatePdf = async () => Buffer.from(""); export const renderTemplateDocx = async () => Buffer.from("");',
  [lib('doc-templates/fill')]: `export const resolveAutoFields = async () => ({}); export const resolveEstimateLineFields = async () => null;
    export const applyFieldEdits = () => ({}); export const validateForRender = () => ({ ok: true, missing: [] });
    export const estimateLinesChanged = () => false; export const ESTIMATE_LINE_FIELDS = [];`,
  [lib('billing/server')]: 'export const billingOnSignatureSigned = (...a) => globalThis.__esignTest.hook(...a);',
  [lib('workflow/server')]: 'export const workflowOnSignatureSigned = (...a) => globalThis.__esignTest.hook(...a);',
  [lib('closeout/server')]: 'export const recordWrittenSignoffCmd = async () => ({ ok: true });',
  [lib('commands/db')]: `export const runDirect = async (sql, params) => (await globalThis.__esignTest.query(sql, params)).rows;
    export const withTransaction = async fn => fn(runDirect);`,
  [lib('workflow/agreement')]: 'export const prepareAgreementOnAcceptance = async () => ({ ok: true });',
  [lib('closeout/revisions')]: 'export const pinSignedSignatureRequest = async () => {};',
  [lib('direct-send-gate')]: 'export const directSendBlocked = async () => null;',

  [lib('workflow/engine')]: 'export const classifySignedDoc = () => "precon";',
};
registerHooks({
  resolve(s, c, next) {
    let dest = s;
    if (s.startsWith('@/')) dest = new URL(`${s.slice(2)}.ts`, root).href;
    else if (/^\.\.?\//.test(s) && !/\.[cm]?[jt]s$/.test(s) && c.parentURL?.endsWith('.ts')) dest = new URL(`${s}.ts`, c.parentURL).href;
    if (Object.hasOwn(stubs, dest)) return { url: `stub:${dest}`, shortCircuit: true };
    return next(dest, c);
  },
  load(url, c, next) {
    if (url.startsWith('stub:')) return { format: 'module', source: stubs[url.slice(5)], shortCircuit: true };
    return next(url, c);
  },
});
const drafts = await import('../lib/doc-drafts.ts');
const actions = await import('../lib/actions/esign.ts');
const reads = await import('../lib/esign.ts');
const skip = !client && 'Set SJCOS_ESIGN_TEST_DATABASE_URL to the isolated QA DB on localhost:5499';
before(async () => { if (client) await client.connect(); });
after(async () => { if (client) await client.end(); });
beforeEach(async () => { if (client) await run('BEGIN'); hookCalls = stored = mailCalls = 0; mailMode = 'disconnected'; beforeHeaders = beforeAttach = async () => {}; });
afterEach(async () => { if (client) await run('ROLLBACK'); });

async function fixture(status = 'submitted', requestStatus = 'sent') {
  const { rows: [sr] } = await run(`INSERT INTO signature_requests (lead_slug, doc_type, title, status, signer_name, signer_email)
    VALUES ('zz-qa-esign-regression','precon','ZZ QA signing regression',$1,'ZZ QA Client','qa@example.test') RETURNING id`, [requestStatus]);
  const { rows: [d] } = await run(`INSERT INTO document_drafts (lead_slug, template_key, title, status, signature_request_id)
    VALUES ('zz-qa-esign-regression','precon','ZZ QA signing regression',$1,$2) RETURNING id`, [status, sr.id]);
  return { id: Number(d.id), requestId: Number(sr.id) };
}
function form(inPerson = false) {
  const fd = new FormData(); fd.set('signedName', 'ZZ QA Client'); fd.set('consent', 'on');
  if (inPerson) fd.set('signatureData', 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(20)]).toString('base64'));
  return fd;
}
async function state(f) {
  return (await run(`SELECT d.status AS draft, sr.status AS request FROM document_drafts d JOIN signature_requests sr ON sr.id = d.signature_request_id WHERE d.id = $1`, [f.id])).rows[0];
}

test('voiding revokes open requests, hides the draft, and records the revocation', { skip }, async () => {
  const f = await fixture();
  await run('UPDATE document_drafts SET client_visible = true WHERE id = $1', [f.id]);
  assert.deepEqual(await drafts.voidDocDraft(f.id), { ok: true });
  assert.deepEqual(await state(f), { draft: 'void', request: 'void' });
  assert.equal((await drafts.getDocDraft(f.id)).client_visible, false);
  assert.equal((await run("SELECT count(*)::int AS n FROM signature_events WHERE request_id=$1 AND kind='voided'", [f.requestId])).rows[0].n, 1);
  await drafts.voidDocDraft(f.id);
  assert.equal((await run("SELECT count(*)::int AS n FROM signature_events WHERE request_id=$1 AND kind='voided'", [f.requestId])).rows[0].n, 1);
});
for (const inPerson of [false, true]) {
  test(`${inPerson ? 'in-person' : 'portal'} signing refuses a stale open request attached to a void draft`, { skip }, async () => {
    const f = await fixture('void');
    const result = await (inPerson ? actions.signInPersonAction : actions.signSignatureRequest)(f.requestId, form(inPerson));
    assert.equal(result.ok, false); assert.match(result.error, /void|no longer awaiting signature/i);
    assert.deepEqual(await state(f), { draft: 'void', request: 'sent' });
    assert.equal(hookCalls, 0); assert.equal(stored, 0);
    assert.equal((await run("SELECT count(*)::int AS n FROM signature_events WHERE request_id=$1 AND kind='signed'", [f.requestId])).rows[0].n, 0);
  });
  for (const status of ['draft', 'void', 'signed', 'declined']) {
    test(`${inPerson ? 'in-person' : 'portal'} refuses a ${status} request`, { skip }, async () => {
      const f = await fixture('submitted', status);
      assert.equal((await (inPerson ? actions.signInPersonAction : actions.signSignatureRequest)(f.requestId, form(inPerson))).ok, false);
      assert.equal(hookCalls, 0);
    });
  }
}
test('stale in-person link and portal lists do not offer a void draft for signature', { skip }, async () => {
  const f = await fixture('void');
  assert.equal((await reads.getSigningContext(f.requestId)).request.status, 'void');
  assert.equal((await reads.getLeadClientSignatures('zz-qa-esign-regression')).some(r => r.id === f.requestId), false);
});
test('valid signing still succeeds exactly once and preserves a signed record when later voided', { skip }, async () => {
  const f = await fixture();
  assert.equal((await actions.signSignatureRequest(f.requestId, form())).ok, true);
  assert.deepEqual(await state(f), { draft: 'signed', request: 'signed' });
  assert.equal(hookCalls, 2);
  assert.equal((await actions.signSignatureRequest(f.requestId, form())).ok, false);
  assert.equal(hookCalls, 2);
  await drafts.voidDocDraft(f.id);
  assert.deepEqual(await state(f), { draft: 'void', request: 'signed' });
});
async function renderedFixture() {
  const f = await fixture('rendered', 'void');
  // A source file is only a FK fixture; no real PDF or storage is read.
  await run(`INSERT INTO files (id, name, mime_type) VALUES ('zz-qa-esign-pdf','ZZ QA.pdf','application/pdf')`);
  await run(`UPDATE document_drafts SET signature_request_id=NULL, pdf_file_id='zz-qa-esign-pdf', field_values='{"client_name":"ZZ QA Client","client_email":"qa@example.test"}' WHERE id=$1`, [f.id]);
  return f;
}
for (const mode of ['disconnected', 'error']) {
  test(`${mode} delivery survives reload; retry reuses the request and persists success`, { skip }, async () => {
    mailMode = mode;
    const f = await renderedFixture();
    const sent = await drafts.submitDocDraftForSignature(f.id, { id: null, name: 'ZZ QA Owner' });
    assert.equal(sent.ok, true); assert.equal(sent.delivery.sent, false);
    const reloaded = await drafts.getDocDraft(f.id);
    assert.equal(reloaded.delivery.status, 'failed'); assert.equal(reloaded.delivery.note, sent.delivery.note);
    mailMode = 'ok';
    const retry = await drafts.retryDocDraftSignatureDelivery(f.id);
    assert.equal(retry.ok, true); assert.equal(retry.signatureRequestId, sent.signatureRequestId); assert.equal(retry.delivery.sent, true);
    const again = await drafts.getDocDraft(f.id);
    assert.equal(again.delivery.status, 'sent');
    assert.match(again.delivery.note, /Emailed/);
    assert.equal((await run('SELECT count(*)::int AS n FROM signature_requests WHERE id=$1', [sent.signatureRequestId])).rows[0].n, 1);
  });
}
test('in-person preparation persists intentional no-email state, and void drafts cannot be sent or retried', { skip }, async () => {
  const f = await renderedFixture();
  assert.equal((await drafts.submitDocDraftForSignature(f.id, { id: null, name: 'ZZ QA Owner' }, false, { inPerson: true })).ok, true);
  assert.equal((await drafts.getDocDraft(f.id)).delivery.status, 'in_person');
  assert.equal(mailCalls, 0);
  await drafts.voidDocDraft(f.id);
  assert.equal((await drafts.submitDocDraftForSignature(f.id, { id: null, name: 'ZZ QA Owner' })).ok, false);
  assert.equal((await drafts.retryDocDraftSignatureDelivery(f.id)).ok, false);
  assert.equal(mailCalls, 0);
});

for (const inPerson of [false, true]) {
  for (const change of ['draft', 'request']) {
    test(`${inPerson ? 'in-person' : 'portal'} rechecks ${change} after preflight before binding`, { skip }, async () => {
      const f = await fixture();
      beforeHeaders = async () => {
        beforeHeaders = async () => {};
        await run(change === 'draft'
          ? "UPDATE document_drafts SET status='void' WHERE id=$1"
          : "UPDATE signature_requests SET status='void' WHERE id=$1", [change === 'draft' ? f.id : f.requestId]);
      };
      const result = await (inPerson ? actions.signInPersonAction : actions.signSignatureRequest)(f.requestId, form(inPerson));
      assert.equal(result.ok, false); assert.match(result.error, /void|no longer awaiting/i);
      assert.equal(hookCalls, 0); assert.equal(stored, 0);
      assert.equal((await run("SELECT count(*)::int AS n FROM signature_events WHERE request_id=$1 AND kind IN ('signed','presented')", [f.requestId])).rows[0].n, 0);
    });
  }
}
test('voiding after send preflight cannot reattach a new request or email the void draft', { skip }, async () => {
  const f = await renderedFixture();
  beforeAttach = async () => {
    beforeAttach = async () => {};
    await drafts.voidDocDraft(f.id);
  };
  const result = await drafts.submitDocDraftForSignature(f.id, { id: null, name: 'ZZ QA Owner' });
  assert.equal(result.ok, false);
  assert.equal(mailCalls, 0);
  assert.equal((await drafts.getDocDraft(f.id)).status, 'void');
  assert.equal((await run("SELECT count(*)::int AS n FROM signature_requests WHERE lead_slug='zz-qa-esign-regression' AND status IN ('draft','sent')")).rows[0].n, 0);
});
test('valid in-person signature records presentation before signing and runs hooks once', { skip }, async () => {
  const f = await fixture();
  assert.equal((await actions.signInPersonAction(f.requestId, form(true))).ok, true);
  const { rows } = await run('SELECT kind FROM signature_events WHERE request_id=$1 ORDER BY id', [f.requestId]);
  assert.deepEqual(rows.map(r => r.kind), ['presented', 'signed']);
  assert.equal(hookCalls, 2);
});
test('legacy open requests with no draft remain signable', { skip }, async () => {
  const f = await fixture();
  await run('DELETE FROM document_drafts WHERE id=$1', [f.id]);
  assert.equal((await actions.signSignatureRequest(f.requestId, form())).ok, true);
});
test('MCP send forwards its owner grant, retries failed delivery through the same service, and refuses a void draft', { skip }, async () => {
  const registry = new Map();
  const grantId = '11111111-1111-4111-8111-111111111111';
  registerGrantTools({ registerTool: (name, schema, handler) => registry.set(name, { schema, handler }), server: {} }, {
    json: value => value,
    grantsCall: async (action, payload) => {
      assert.equal(action, 'perform'); assert.equal(payload.gated_action, 'send_document_for_signature');
      assert.equal(payload.grant_id, grantId);
      return drafts.submitDocDraftForSignature(Number(payload.target_id), { id: null, name: 'ZZ QA Owner' });
    },
  });
  const tool = registry.get('send_document_for_signature');
  assert.equal(z.object(tool.schema.inputSchema).safeParse({ draft_id: 1 }).success, false, 'grant remains required');
  const f = await renderedFixture();
  const first = await tool.handler({ draft_id: f.id, owner_grant_id: grantId });
  assert.equal(first.delivery.sent, false);
  mailMode = 'ok';
  const second = await tool.handler({ draft_id: f.id, owner_grant_id: grantId });
  assert.equal(second.delivery.sent, true); assert.equal(second.signatureRequestId, first.signatureRequestId);
  await drafts.voidDocDraft(f.id);
  assert.equal((await tool.handler({ draft_id: f.id, owner_grant_id: grantId })).ok, false);
  assert.equal(mailCalls, 1);
});

test('delivery migration revokes existing void drafts and is safe to apply twice', { skip }, async () => {
  const f = await fixture('void');
  const sql = readFileSync(new URL('../db/migrations/0058_signature_delivery.sql', import.meta.url), 'utf8');
  await run(sql);
  assert.deepEqual(await state(f), { draft: 'void', request: 'void' });
  await run(sql);
  assert.equal((await run("SELECT count(*)::int AS n FROM signature_events WHERE request_id=$1 AND kind='voided'", [f.requestId])).rows[0].n, 1);
});
