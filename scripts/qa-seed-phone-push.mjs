#!/usr/bin/env node
// Additive QA fixtures. Never load .env here: the CLI URL is the only DB target.
process.env.SJC_OUTBOUND_DISABLED = '1';

const { registerHooks } = await import('node:module');
const { statSync } = await import('node:fs');
const { randomUUID, randomBytes } = await import('node:crypto');
const assert = (await import('node:assert/strict')).default;
const raw = process.argv[2];
let url;
try { url = new URL(raw); } catch { throw new Error('Usage: node scripts/qa-seed-phone-push.mjs <QA_DATABASE_URL>'); }
// Reject libpq query-string overrides (including host/port/dbname/service).
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.port !== '5499' ||
    !/^\/sjcos_qa_[A-Za-z0-9_]+$/.test(url.pathname) || url.search || url.hash ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('Refusing seed: require localhost:5499/sjcos_qa_* with no URL query overrides.');
}
process.env.DATABASE_URL = url.href;
// Do not inherit a narrow-login connection to another database.
for (const key of ['DATABASE_URL_AGENT', 'DATABASE_URL_WORKER', 'DATABASE_URL_READONLY', 'DATABASE_URL_BACKUP']) process.env[key] = url.href;
process.env.TELEGRAM_BOT_TOKEN = 'qa-phone-seed-fake-token';
process.env.TELEGRAM_OWNER_CHAT_ID = '549900000';
// Keep stdout machine-readable even when imported app code logs diagnostics.
console.log = (...args) => console.error(...args);
const root = new URL('../', import.meta.url);
const stubs = {
  'server-only': '',
  'next/cache': 'export const revalidatePath=()=>{};',
};
// Same TS/alias resolver as tests/phone-push-db.test.mjs, with ONLY the two
// framework boundaries above stubbed. All domain code and providers are real.
registerHooks({
  resolve(s, c, next) {
    let canonical = s;
    if (s.startsWith('.') && c.parentURL?.startsWith('file:')) {
      const u = new URL(s, c.parentURL);
      if (u.href.startsWith(root.href)) canonical = '@/' + u.href.slice(root.href.length).replace(/\.ts$/, '');
    }
    if (Object.hasOwn(stubs, canonical)) return { url: 'phone-stub:' + canonical, shortCircuit: true };
    if (s.startsWith('@/') || s.startsWith('.') && c.parentURL?.startsWith('file:') && !/\.[cm]?[jt]sx?$/.test(s)) {
      const base = s.startsWith('@/') ? new URL(s.slice(2), root) : new URL(s, c.parentURL);
      for (const ext of ['', '.ts', '.mjs', '/index.ts', '/index.mjs']) try {
        if (statSync(new URL(base.href + ext)).isFile()) return { url: base.href + ext, shortCircuit: true };
      } catch {}
    }
    // Next's extensionless CommonJS entrypoints need their real .js files in Node.
    if (s.startsWith('next/') && !s.endsWith('.js')) {
      try { return next(s, c); } catch (err) {
        if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
        return next(s + '.js', c);
      }
    }
    return next(s, c);
  },
  load(u, c, next) {
    if (u.startsWith('phone-stub:')) return { format: 'module', source: stubs[u.slice(11)], shortCircuit: true };
    return next(u, c);
  },
});

const { pool, query, queryOne } = await import('../lib/db.ts');
const summary = { runId: randomUUID(), database: url.pathname.slice(1), owner: null, devices: [], states: [], errors: [], verification: {}, limitations: [] };
try {
  const actual = await queryOne(`SELECT current_database() AS name, inet_server_port() AS port`);
  assert.equal(actual.name, url.pathname.slice(1));
  assert.equal(actual.port, 5499);
  const {setFakeOutcome}=await import('../lib/providers/types.ts');let fakeTelegramId=549910000;setFakeOutcome(provider=>provider==='telegram'?{responseClass:'accepted',transmitted:true,providerRef:String(++fakeTelegramId)}:null);
  const { stageAndAnnounce } = await import('../lib/decisions/notify.ts');
  const { notifyOwner, notifyApprovalNeeded, notifyPortalMessage, sendOwnerPushesNow } = await import('../lib/notify-owner.ts');
  const { savePushSettings, shapePushMessage } = await import('../lib/phone-push.ts');
  const { resolvePhoneAction } = await import('../lib/owner-actions.ts');
  const { requestGrant } = await import('../lib/owner-grants.ts');
  const { replyToOwner } = await import('../lib/owner-reply-delivery.ts');
  const { enqueueIntent } = await import('../lib/commands/intents.ts');
  const { runDirect } = await import('../lib/commands/db.ts');
  const { workItemDraftPreviews } = await import('../lib/work-item-draft.ts');
  const { workItemKeyboard } = await import('../lib/decisions/keyboards.ts');
  const { fakeApnsDeliveries, buildPushPayload } = await import('../lib/providers/apns.ts');
  const owner = await queryOne(`SELECT id,email,name FROM users WHERE role='owner' AND active ORDER BY created_at LIMIT 1`);
  assert.ok(owner, 'QA database must contain an active owner');
  summary.owner = owner;
  const principal = { kind: 'user', userId: owner.id, role: 'owner', name: owner.name, permissions: [] };
  const agent = { kind: 'agent', agent: 'qa-phone-seed', onBehalfOf: null };
  const project = await queryOne(`SELECT p.id,p.slug,p.name,COALESCE(NULLIF(p.client_email,''),l.email) AS email
    FROM projects p LEFT JOIN leads l ON l.id=p.lead_id
    WHERE COALESCE(NULLIF(p.client_email,''),l.email) LIKE '%@%' ORDER BY p.created_at LIMIT 1`);
  assert.ok(project, 'QA database must contain a project with a client email');
  const lead = await queryOne(`SELECT id,slug,name FROM leads ORDER BY created_at LIMIT 1`);
  summary.context = { project, lead };
  await savePushSettings({ app: true, telegram: true });
  let staff = await queryOne(`SELECT id,email FROM users WHERE role='staff' AND active ORDER BY created_at LIMIT 1`);
  if (!staff) staff = await queryOne(`INSERT INTO users(email,password_hash,name,role,initials) VALUES($1,'disabled QA login','QA staff','staff','QA') RETURNING id,email`, [`qa-phone-${summary.runId}@example.invalid`]);
  for (const [user, label] of [[owner, 'owner'], [staff, 'staff']]) {
    const token = randomBytes(32).toString('hex');
    const device = await queryOne(`INSERT INTO push_devices(user_id,token,platform,environment,app_version,build,device_name,session_auth_at,session_expires_at)
      VALUES($1,$2,'ios','sandbox','QA','7',$3,now(),now()+interval '30 days') RETURNING id,user_id,platform,environment`, [user.id, token, `QA ${label} ${summary.runId}`]);
    summary.devices.push({ ...device, role: label, tokenSuffix: token.slice(-6) });
  }
  // Advance a separate delivery clock one day per seed. Noon Chicago (18 UTC)
  // works in CST and CDT; start after every existing queue timestamp. This
  // bypasses neither gate nor domain code and never drains unrelated rows.
  const clock = await queryOne(`SELECT greatest(now(),max(sent_at),max(send_after)) AS latest FROM push_outbox`);
  let noon = new Date(clock.latest); noon.setUTCDate(noon.getUTCDate() + 1); noon.setUTCHours(18, 0, 0, 0);
  async function seed(label, fn) {
    const before = await queryOne(`SELECT COALESCE(max(id),0)::text AS id FROM push_outbox`);
    const start = await queryOne(`SELECT clock_timestamp() AS ts`);
    const value = await fn();
    const outbox = (await query(`SELECT id::text FROM push_outbox WHERE id>$1 ORDER BY id`, [before.id])).rows;
    noon.setUTCDate(noon.getUTCDate() + 1);
    await sendOwnerPushesNow(outbox.map(r => r.id), new Date(noon));
    const messages = (await query(`SELECT * FROM owner_push_messages WHERE push_outbox_id=ANY($1::bigint[]) OR created_at >= $2 ORDER BY created_at,id`, [outbox.map(r => r.id), start.ts])).rows;
    assert.ok(messages.length, `${label}: app functions produced no phone alert`);
    const shaped = messages.map(row => {
      const m = shapePushMessage(row);
      return { id: m.id, thread_key: m.threadKey, category: m.category, approvalKey: m.approvalKey, contentHash: m.contentHash, kind: m.kind, from:m.from,agentName:m.agentName,draftBinding:m.draftBinding,state: m.state, outcome: m.outcome, sends: m.sends, replyToId: m.replyToId };
    });
    summary.states.push({ state: label, messages: shaped });
    return { value, messages };
  }
  const title = s => `[QA ${summary.runId.slice(0,8)}] ${s}`;
  async function decision(label, sends = false) {
    return seed(label, async () => {
      const emailPayload = { to: project.email, subject: title(`Schedule update: ${label}`), bodyText: 'Your cabinet installation is ready for scheduling.' };
      const staged = await stageAndAnnounce({ kind: 'decision', action: sends ? 'send_email' : 'qa.review',
        title: title(sends ? `Email ${project.name}: schedule update` : 'Review cabinet layout'),
        projectId: project.id, targetKind: sends ? 'email' : 'project', targetId: sends ? project.email : project.id,
        recipient: sends ? project.email : null, content: sends ? emailPayload : { run: summary.runId, label },
        summary: { effect: sends ? `Sends an email to ${project.email}.` : 'Records the layout review for the team.', inclusions: ['Confirm cabinet layout and installation dates.'] }, requestedBy: agent });
      if (sends) await enqueueIntent(runDirect, { operationKey: `qa:${summary.runId}:${label}`, kind: 'send_email',
        targetKind: 'email', targetId: project.email, recipient: project.email, projectId: project.id,
        decisionId: staged.decision.id, principal: agent, hold: 'Waiting for owner approval',
        payload: emailPayload });
      return staged;
    });
  }
  const sendDecision=await decision('open_decision_email', true);
  assert.equal(sendDecision.messages[0].category,'SJC_DECISION_SEND');
  await decision('open_decision_internal');
  await seed('permission_waiting', async () => {
    // Each run files a fresh request using the real grant replacement rules.
    const r = await requestGrant({ action: 'send_email', targetId: project.email,
      reason: title('Please approve this client schedule email.'), requestedBy: 'qa-phone-seed',
      staged: { action: 'send_email', target_id: project.email,
        email: { to: project.email, subject: title('Confirm installation'), body: `Hello, may we confirm installation? QA run ${summary.runId}` } } });
    assert.ok(r.ok, r.error); return r;
  });
  async function draft(label, email = false, long = false) {
    return seed(label, async () => {
      const body = long ? 'Bonjour José et Zoë — façade, chêne et finitions. 🪚🏡✨\n'.repeat(150) : email ? 'Hello, here is the proposed cabinet installation schedule. Please let us know what works.' : 'Review the internal installation checklist and confirm material quantities.';
      const content = email ? `To: ${project.email}\nSubject: ${title('Installation schedule')}\n\n${body}` : body;
      const w = await queryOne(`INSERT INTO work_items(title,body,project_id,status,approval_status,requires_approval,source_kind,created_by)
        VALUES($1,$2,$3,'approval_needed','requested',true,'agent','qa-phone-seed') RETURNING id,title`, [title(label), body, project.id]);
      const k = await queryOne(`INSERT INTO knowledge_items(content,kind,source,project_id,created_by) VALUES($1,'draft','agent',$2,'qa-phone-seed') RETURNING id`, [content, project.id]);
      await query(`INSERT INTO agent_receipts(work_item_id,receipt_kind,uri,label,metadata) VALUES($1,'draft',$2,'QA draft ready','{}')`, [w.id, `knowledge_items/${k.id}`]);
      if (long) {
        // notifyApprovalNeeded deliberately previews only 1,200 code units.
        // Exercise the real transport with the full draft to test APNs bytes.
        await notifyOwner({ kind: 'decision', title: w.title, body: content, href: `/projects/${project.slug}`,
          telegram: { workItemId: w.id, buttons: workItemKeyboard(w.id, { sends: email }) } }, new Date(noon));
      } else await notifyApprovalNeeded(w.id, w.title, new Date(noon));
      return w;
    });
  }
  const sendDraft = await draft('draft_approve_and_send', true);
  const internal = await draft('draft_approve_internal');
  assert.ok(sendDraft.messages[0].sends); assert.equal(internal.messages[0].sends, false);
  const long = await draft('long_multibyte_draft', true, true);
  const longMessage = long.messages.find(m => m.work_item_id === long.value.id);
  assert.ok(Buffer.byteLength(longMessage.body) > 3072);
  const payload = buildPushPayload(longMessage, 0);
  summary.verification.longDraft = { storedBytes: Buffer.byteLength(longMessage.body), payloadBytes: Buffer.byteLength(JSON.stringify(payload)), trimmed: payload.aps.alert.body.length < longMessage.body.length };
  assert.ok(summary.verification.longDraft.trimmed); assert.ok(summary.verification.longDraft.payloadBytes <= 4096);

  const portal = await seed('portal_client_message', async () => {
    let thread = await queryOne(`SELECT channel_key,author_name,author_initials,author_user_id FROM chat_messages WHERE channel_key LIKE 'portal:%' AND author_kind='user' ORDER BY created_at DESC LIMIT 1`);
    if (!thread) thread = { channel_key: `portal:${project.slug}`, author_name: project.name, author_initials: 'QA', author_user_id: null };
    const m = await queryOne(`INSERT INTO chat_messages(channel_key,author_kind,author_name,author_initials,author_user_id,body) VALUES($1,'user',$2,$3,$4,$5) RETURNING id,body`, [thread.channel_key, thread.author_name, thread.author_initials, thread.author_user_id, title('Could we use the warmer oak finish?')]);
    await notifyPortalMessage({ surface: 'client', channelKey: thread.channel_key, messageId: String(m.id), name: thread.author_name, body: m.body, href: '/client-portal', context: project.name }, new Date(noon));
  });
  async function action(label, rootMessage, verb, text) {
    return seed(label, async () => {
      const r = await resolvePhoneAction({ messageId: rootMessage.id, action: verb, text }, principal);
      assert.ok(r.ok, `${label}: ${r.message}`); return r;
    });
  }
  await action('portal_joe_reply_and_ack', portal.messages[0], 'reply', 'Yes, the warmer oak works. I will bring a sample to our next meeting.');
  const conversation = await decision('changes_conversation_alert');
  await action('changes_joe_note_and_system_ack', conversation.messages[0], 'changes', 'Please confirm whether the oak upgrade changes the allowance before we proceed.');
  const duplicateEdits = (await query(`SELECT id FROM owner_push_messages WHERE decision_id=$1 AND reply_to_id IS NULL AND id<>$2 AND state='decided' AND outcome IS NULL`, [conversation.value.decision.id, conversation.messages[0].id])).rows;
  assert.equal(duplicateEdits.length,0,'Request changes must not create phantom roots');
  const reply = await queryOne(`SELECT id FROM owner_replies WHERE decision_id=$1 ORDER BY created_at DESC LIMIT 1`, [conversation.value.decision.id]);
  await seed('changes_agent_question', async () => {
    const r = await replyToOwner({ ownerReplyId: reply.id, text: 'The oak upgrade is $240 above the allowance. Should I price the standard oak as well?', outcome: 'question', agent: 'Claude' });
    assert.ok(r.ok, r.error); return r;
  });
  // Approvals/holds may only update an existing row, with no new message.
  // Report the original card after the real phone resolver has changed it.
  async function history(label, fixture, verb, text) {
    const r = verb ? await resolvePhoneAction({ messageId: fixture.messages[0].id, action: verb, text }, principal) : { ok: true, message: 'Already pulled back through the phone changes action.', outcome: 'changes_requested' };
    assert.ok(r.ok, `${label}: ${r.message}`);
    const row = await queryOne(`SELECT * FROM owner_push_messages WHERE id=$1`, [fixture.messages[0].id]);
    const m = shapePushMessage(row);
    summary.states.push({ state: label, result: r, messages: [{ id: m.id, thread_key: m.threadKey, category: m.category, approvalKey: m.approvalKey, contentHash: m.contentHash, state: m.state, outcome: m.outcome }] });
  }
  await history('history_approved', await decision('history_approved_alert', true), 'approve');
  await history('history_declined', await draft('history_declined_alert'), 'decline');
  await history('history_on_hold', await decision('history_on_hold_alert'), 'hold');
  await history('history_changes_requested', conversation);
  const heldCard = summary.states.find(s => s.state === 'history_on_hold').messages[0];
  assert.equal(heldCard.state,'decided');assert.match(heldCard.outcome,/On hold until/);
  const [waitingDraft]=await workItemDraftPreviews({ids:[sendDraft.value.id],limit:1});
  const waitingPreview=[waitingDraft?.to?`To: ${waitingDraft.to}`:'',waitingDraft?.subject?`Subject: ${waitingDraft.subject}`:'',waitingDraft?.body??'','Approve sends this email now.'].filter(Boolean).join('\n');
  const info = {
    payment: ['Payment received', 'A client payment of $2,500 was recorded.', 'Money'],
    contract_signed: ['Contract signed', 'The client signed the construction contract.', 'Documents'],
    voice_call: ['Call completed', 'Client asked to confirm the installation date.', 'Client portal'],
    sms_inbound: ['New client text', 'Can we meet at 9 tomorrow?', 'Client portal'],
    agent_failure: ['Agent needs attention', 'The estimating run could not finish. Review and retry.', 'Overview'],
    urgent_item: ['Material delivery needs attention', 'Confirm access before the delivery arrives.', 'Overview'],
    comms: ['Email connection needs attention', 'The last mailbox sync failed. Check the connection.', 'Client portal'],
    stale_approval: ['Draft waiting for approval', waitingPreview, 'Overview'],
  };
  for (const [kind, [heading, body, tab]] of Object.entries(info)) await seed(kind, () => notifyOwner({ kind, title: title(heading), body, href: `/projects/${project.slug}?tab=${encodeURIComponent(tab)}`,
    ...(kind === 'stale_approval' ? { telegram: { workItemId: sendDraft.value.id, buttons: workItemKeyboard(sendDraft.value.id,{sends:true}) } } : {}) }, new Date(noon)));
  const suffix = summary.devices.find(d => d.role === 'staff').tokenSuffix;
  assert.equal(fakeApnsDeliveries.filter(d => d.tokenSuffix === suffix).length, 0);
  const ownerSuffix = summary.devices.find(d => d.role === 'owner').tokenSuffix;
  const ownerDeliveries = fakeApnsDeliveries.filter(d => d.tokenSuffix === ownerSuffix).length;
  assert.ok(ownerDeliveries > 0);
  summary.verification.ownerDeliveries = ownerDeliveries;
  summary.verification.staffDeliveries = 0;
  summary.verification.fakeApnsDeliveries = fakeApnsDeliveries.length;
  // Refresh states captured before later actions, and include every thread row.
  for (const state of summary.states) for (const message of state.messages) {
    const row = await queryOne(`SELECT * FROM owner_push_messages WHERE id=$1`, [message.id]);
    message.state = row.state; message.outcome = row.outcome;
  }
  summary.verification.outboundDisabled = process.env.SJC_OUTBOUND_DISABLED === '1';
} catch (err) {
  summary.errors.push(err.stack ?? String(err));
  process.exitCode = 1;
} finally {
  await pool.end();
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}
