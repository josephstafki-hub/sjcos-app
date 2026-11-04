import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Only the connector and pure rules run. No real SDK, credentials, DB or network.
const calls = { get: 0, sent: [] };
let mailbox = { email: 'joe@example.test', refreshToken: 'fake-one' };
const msg = (id, from, extra = {}, labels = []) => ({ id, internalDate: String(Number(id) * 1000), labelIds: labels,
  snippet: `snippet ${id}`, payload: { mimeType: 'multipart/mixed', headers: Object.entries({ From: from, To: 'Joe <joe@example.test>', Subject: 'Plans', 'Message-ID': `<${id}@mail.test>`, ...extra }).map(([name,value]) => ({name,value})), parts: [
    { mimeType: 'text/plain', body: { data: Buffer.from(`Please review these plans ${id}`).toString('base64url') } },
    { mimeType: 'text/html', body: { data: Buffer.from(`<p>html ${id}</p><script>bad()</script>`).toString('base64url') } },
    { filename: 'plan.pdf', mimeType: 'application/pdf', body: { attachmentId: `a${id}`, size: 4096 } },
  ] } });
let messages = [msg('1', 'Client <client@example.test>', { 'Reply-To': 'Tom <tom@example.test>', Cc: 'Ana <ana@example.test>, Joe <joe@example.test>', References: '<prior@mail.test>' }), msg('2', 'SJC <alias@example.test>', {}, ['SENT'])];
globalThis.__inboxFake = { calls, get mailbox() { return mailbox; }, api: { users: {
  getProfile: async () => ({data: {emailAddress: mailbox.email}}),
  threads: { get: async () => { calls.get++; return { data: {id: 'thread', messages} }; } },
  messages: { send: async (args) => { calls.sent.push(args); return {data: {}}; }, attachments: { get: async () => { throw Error('unexpected attachment read'); } } },
} } };
registerHooks({
  resolve(s,c,n) {
    if (s === 'server-only') return {url:'fake:empty',shortCircuit:true};
    if (s === 'googleapis') return {url:'fake:google',shortCircuit:true};
    if (s === './mailbox' && c.parentURL?.endsWith('/lib/gmail.ts')) return {url:'fake:mailbox',shortCircuit:true};
    if (s.startsWith('./') && c.parentURL?.endsWith('.ts') && !s.endsWith('.ts')) { try { return n(s+'.ts',c); } catch {} }
    return n(s,c);
  },
  load(u,c,n) {
    const sources = {
      'fake:empty':'',
      'fake:mailbox':'export const activeMailbox = () => globalThis.__inboxFake.mailbox;',
      'fake:google':'export const google = { auth: { OAuth2: class { setCredentials() {} } }, gmail: () => globalThis.__inboxFake.api };',
    };
    return u in sources ? {format:'module',source:sources[u],shortCircuit:true} : n(u,c);
  }
});
const rules = await import('../lib/inbox-rules.ts');
const gmail = await import('../lib/gmail.ts');

test('reply target uses last inbound Reply-To, excludes every own address, opt-in reply-all', () => {
  const entries = [ {fromEmail:'client@example.test',fromName:'Client',replyTo:'Tom <tom@example.test>',to:['joe@example.test'],cc:['ana@example.test','joe@example.test'],messageId:'<1@mail.test>',references:'<prior@mail.test>'}, {fromEmail:'alias@example.test',outbound:true} ];
  const r = rules.resolveReplyTarget(entries, ['joe@example.test','alias@example.test']);
  assert.equal(r.toEmail,'tom@example.test'); assert.equal(r.toName,'Tom');
  assert.deepEqual(r.cc, ['ana@example.test']);
  assert.equal(r.inReplyTo,'<1@mail.test>'); assert.equal(r.references,'<prior@mail.test> <1@mail.test>');
  assert.equal(rules.resolveReplyTarget([{fromEmail:'joe@example.test'}],['joe@example.test']),null);
});

test('automated and bulk senders never need a reply, even unread', () => {
  for (const address of ['noreply@x.test','no-reply@x.test','notifications@x.test','mailer-daemon@x.test','notifications@github.com']) assert.equal(rules.isAutomatedSender(address),true,address);
  assert.equal(rules.isAutomatedSender('person@x.test','promotions'),true);
  assert.equal(rules.isAutomatedSender('person@x.test','primary'),false);
  assert.equal(rules.needsMeReason({channel:'email',inbound:true,automated:true,unread:true}),undefined);
  assert.equal(rules.needsMeReason({channel:'email',automated:true,draftReady:true}),undefined);
});

test('needs-me explains human last inbound, pending drafts, done, staff and unread', () => {
  assert.equal(rules.needsMeReason({channel:'email',inbound:true,audience:'client',age:'2h'}),'Client replied · 2h');
  assert.equal(rules.needsMeReason({channel:'sub_portal',inbound:true}),'Sub replied');
  assert.equal(rules.needsMeReason({channel:'site_form',inbound:true}),'New website inquiry');
  assert.equal(rules.needsMeReason({channel:'email',inbound:true,isLead:true}),'Lead replied');
  assert.equal(rules.needsMeReason({channel:'email',inbound:false,draftReady:true}),'Draft ready to review');
  for (const extra of [{done:true},{inbound:false},{staff:true}]) assert.equal(rules.needsMeReason({channel:'email',inbound:true,...extra}),undefined);
  assert.equal(rules.needsMeReason({channel:'email',unread:true}),'Unread');
});

test('whole conversation has stable message metadata, complete bodies and attachments; HTML is per-message and cached', async () => {
  const conversation = await gmail.fetchConversation('thread');
  assert.equal(conversation.messages.length,2);
  assert.equal(conversation.messages[0].id,'1');
  assert.equal(conversation.messages[0].fromEmail,'client@example.test');
  assert.deepEqual(conversation.messages[0].cc,['Ana <ana@example.test>', 'Joe <joe@example.test>']);
  assert.deepEqual(conversation.messages[0].attachments,[{id:'a1',name:'plan.pdf',size:4096,type:'application/pdf'}]);
  assert.deepEqual(conversation.messages[0].body,['Please review these plans 1']);
  const first = await gmail.fetchMessageHtml('thread','1');
  assert.match(first,/html 1/); assert.doesNotMatch(first,/<script/);
  assert.match(await gmail.fetchMessageHtml('thread','2'),/html 2/);
  await gmail.fetchConversation('thread'); await gmail.fetchMessageHtml('thread','1');
  assert.equal(calls.get,1,'open, expand and reopen share the same scoped detail cache');
  mailbox = {...mailbox,refreshToken:'fake-two'};
  await gmail.fetchConversation('thread'); assert.equal(calls.get,2,'cache is mailbox scoped');
  mailbox = {...mailbox,refreshToken:'fake-one'};
});

test('typed reply without AI resolves To server-side and carries threading headers; reply-all is opt-in', async () => {
  await gmail.sendReply({threadId:'thread',toEmail:'',subject:'untrusted subject',bodyText:'Yes'});
  let raw = Buffer.from(calls.sent.at(-1).requestBody.raw,'base64url').toString();
  assert.match(raw,/To: tom@example.test\r\n/); assert.doesNotMatch(raw,/\r\nCc:/);
  assert.match(raw,/In-Reply-To: <1@mail.test>/); assert.match(raw,/References: <prior@mail.test> <1@mail.test>/);
  assert.match(raw,/Subject: Re: Plans/);
  await gmail.sendReply({threadId:'thread',bodyText:'Both',replyAll:true});
  raw = Buffer.from(calls.sent.at(-1).requestBody.raw,'base64url').toString();
  assert.match(raw,/Cc: ana@example.test/);
  await assert.rejects(() => gmail.sendReply({threadId:'thread',bodyText:'bad',toEmail:'x@test.test\r\nBcc: victim@test.test'}),/recipient/i);
});

test('duplicate chat previews render once, including truncated subjects; SMS segments include unicode', () => {
  assert.equal(rules.showThreadSubject({channel:'sms',subject:'Hello',preview:'Hello there'}),false);
  assert.equal(rules.showThreadSubject({channel:'client_portal',subject:'Hello',preview:'Hello'}),false);
  assert.equal(rules.showThreadSubject({channel:'email',subject:'Plans',preview:'Here'}),true);
  assert.equal(rules.smsSegments('a'.repeat(161)),2);
  assert.equal(rules.smsSegments('🌲'.repeat(36)),2);
  assert.equal(rules.smsSegments('^'.repeat(81)),2);
});

test('short replies and long email bodies are preserved in full', async () => {
  mailbox = {...mailbox,refreshToken:'short-body'};
  messages = [msg('3','Client <client@example.test>')];
  messages[0].payload.parts = [{mimeType:'text/plain',body:{data:Buffer.from('Yes!').toString('base64url')}}];
  assert.deepEqual((await gmail.fetchConversation('short')).messages[0].body,['Yes!']);
  messages[0].payload.parts[0].body.data = Buffer.from(Array.from({length:25},(_,i)=>`Please review paragraph number ${i}.`).join('\n\n')).toString('base64url');
  assert.equal((await gmail.fetchConversation('long')).messages[0].body.length,25);
});

test('full Gmail payload supplies bulk headers without another request; only no-reply addresses refuse a send', async () => {
  mailbox={...mailbox,refreshToken:'header-cases'};
  messages=[msg('10','Frank <frank.v@easternfinancialpartners.test>',{'List-Unsubscribe':'<mailto:leave@example.test>'})];
  const before=calls.get;
  const conversation=await gmail.fetchConversation('header-cases');
  assert.equal(conversation.messages[0].automated,true);
  assert.equal(calls.get,before+1);
  // Filed under Other, but Joe chose "Reply anyway": a real address still sends.
  const sent=calls.sent.length;
  await gmail.sendReply({threadId:'header-cases',bodyText:'Not interested, thanks.'});
  assert.equal(calls.sent.length,sent+1);
  // A true no-reply address never gets a send.
  mailbox={...mailbox,refreshToken:'noreply-case'};
  messages=[msg('11','Bank <no-reply@bank.test>',{})];
  await assert.rejects(()=>gmail.sendReply({threadId:'noreply-case',bodyText:'Please do not send'}),/doesn't accept replies/);
  assert.equal(calls.sent.length,sent+1);
});

test('attachments are metadata on open; only deliberate retrieval downloads bytes and validates membership',async()=>{
 mailbox={...mailbox,refreshToken:'attachment-click'};messages=[msg('20','Client <client@example.test>')];
 let downloads=0;
 globalThis.__inboxFake.api.users.messages.attachments.get=async args=>{downloads++;assert.equal(args.messageId,'20');assert.equal(args.id,'a20');return {data:{data:Buffer.from('PDF bytes').toString('base64url')}};};
 const conversation=await gmail.fetchConversation('attachments');assert.equal(downloads,0);assert.equal(conversation.messages[0].attachments[0].name,'plan.pdf');
 const before=calls.get;
 const attachment=await gmail.fetchInboxAttachment('attachments','20','a20');assert.equal(attachment.bytes.toString(),'PDF bytes');assert.equal(attachment.name,'plan.pdf');assert.equal(downloads,1);assert.equal(calls.get,before);
 await assert.rejects(()=>gmail.fetchInboxAttachment('attachments','other-message','a20'),/not found/);
 await assert.rejects(()=>gmail.fetchInboxAttachment('attachments','20','other-attachment'),/not found/);assert.equal(downloads,1);
});

test('realistic Gmail multipart payload folds attribution with history after sanitization, including HTML-only and Outlook',async()=>{
 const {gmailMessage,teresaText,teresaHtml,outlookHtml,michelleText}=await import('./fixtures/inbox-realistic-mail.mjs');
 const {parseDocument,DomUtils}=await import('htmlparser2');
 const {remoteImagePolicy}=await import('../lib/inbox-image-policy.ts');
 mailbox={...mailbox,refreshToken:'realistic-multipart'};
 messages=[gmailMessage('30',teresaText,teresaHtml),gmailMessage('31','',teresaHtml),gmailMessage('32','',outlookHtml),gmailMessage('33',michelleText,'<p>Would you be able to add that in to the remainder of the work?</p>')];
 const before=calls.get;
 const c=await gmail.fetchConversation('realistic-multipart');
 assert.equal(rules.substantiveSnippet(c.messages[0].body,c.subject),'Could you estimate the basement finish?');
 assert.equal(rules.substantiveSnippet(c.messages[1].body,c.subject),'Could you estimate the basement finish?');
 assert.equal(rules.substantiveSnippet(c.messages[3].body,c.subject),'We would like popcorn removal and hallway painting. Would you be able to add that in to the remainder of the work?');
 for(const id of ['30','31','32']){
  const html=await gmail.fetchMessageHtml('realistic-multipart',id);
  const doc=parseDocument(html);const quotes=DomUtils.findAll(e=>e.name==='blockquote',doc.children);
  const quoteText=quotes.map(q=>DomUtils.textContent(q)).join(' ');
  assert.match(quoteText,id==='32'?/From:.*Sent:.*OLD REQUEST/s:/On Wednesday,.*wrote:.*Can you send the listing/s);
  for(const q of quotes)DomUtils.removeElement(q);
  assert.doesNotMatch(DomUtils.textContent(doc),/wrote:|OLD REQUEST|From:/);
 }
 assert.equal(calls.get,before+1,'formatted bodies reuse the one full conversation payload');
 const blocked=remoteImagePolicy('<img src="https://tracker.test/x"><img src="data:image/png;base64,AA"><div style="background:url(https://tracker.test/bg)">text</div>',false);
 assert.doesNotMatch(blocked,/https:\/\/tracker/);assert.match(blocked,/src="data:/);
});

test('new mail and replies reuse mixed MIME, safe Unicode filenames and 76-column base64',async()=>{
 const attachments=[{filename:'floor plan.pdf',mimeType:'application/pdf',content:Buffer.alloc(300,65)},{filename:'café.png',mimeType:'image/png',content:Buffer.from('photo')}];
 await gmail.sendNewEmail({to:'review@example.test',cc:'copy@example.test',subject:'Review',bodyText:'Please review',attachments});
 let raw=Buffer.from(calls.sent.at(-1).requestBody.raw,'base64url').toString();
 assert.match(raw,/multipart\/mixed/);assert.match(raw,/Cc: copy@example.test/);assert.match(raw,/filename="floor plan.pdf"/);assert.match(raw,/filename\*=UTF-8''caf%C3%A9.png/);
 for(const part of raw.split('Content-Transfer-Encoding: base64\r\n\r\n').slice(1))for(const line of part.split('\r\n--')[0].trim().split('\r\n'))assert.ok(line.length<=76);
 await gmail.sendReply({threadId:'attachments',bodyText:'Attached',attachments});
 raw=Buffer.from(calls.sent.at(-1).requestBody.raw,'base64url').toString();assert.match(raw,/multipart\/mixed/);assert.match(raw,/floor plan.pdf/);
 await assert.rejects(()=>gmail.sendNewEmail({to:'bad\r\nBcc: victim@example.test',subject:'No',bodyText:'No'}),/recipient/i);
});

test('inquiry correspondence search lists ids once without fetching message details',async()=>{
 let lists=0;const gets=calls.get;
 globalThis.__inboxFake.api.users.threads.list=async opts=>{lists++;assert.equal(opts.q,'-in:spam -in:trash {from:alex@example.test to:alex@example.test}');return {data:{threads:[{id:'older-thread'}]}};};
 assert.deepEqual(await gmail.findCorrespondence('alex@example.test'),[{id:'older-thread',subject:'Email conversation'}]);assert.equal(lists,1);assert.equal(calls.get,gets);
 await assert.rejects(()=>gmail.findCorrespondence('bad@example.test from:other@example.test'),/Invalid/);assert.equal(lists,1);
});

test('unseen MIME shapes decode entities, preserve comparison labels, and clean text/plain images',async()=>{
 const previous=messages;
 try {
  messages=[msg('501','Notices <notice@example.test>')];
  messages[0].payload.parts=[{mimeType:'text/html',body:{data:Buffer.from('<p>Offer &mdash; it&rsquo;s &#x201C;ready&#x201D;</p><table><tr><th>Existing plan</th><th>Alternative</th><th>Difference</th></tr><tr><td>$720</td><td>$610</td><td>$110</td></tr></table>').toString('base64url')}}];
  const htmlOnly=await gmail.fetchConversation('unseen-html');
  assert.match(htmlOnly.messages[0].body.join('\n'),/Offer — it’s “ready”/);
  assert.match(htmlOnly.messages[0].body.join('\n'),/Existing plan: \$720 · Alternative: \$610 · Difference: \$110/);
  assert.match(await gmail.fetchMessageHtml('unseen-html','501'),/<table/);
  messages=[msg('502','Robin <robin@example.test>')];messages[0].payload.parts=[{mimeType:'text/plain',body:{data:Buffer.from('Please review &ldquo;plan C&rdquo;.\n\n[image: sketch]\n\nConfirm the gate width.').toString('base64url')}}];
  assert.deepEqual((await gmail.fetchConversation('unseen-plain')).messages[0].body,['Please review “plan C”.','Confirm the gate width.']);
  assert.equal(await gmail.fetchMessageHtml('unseen-plain','502'),'');
  messages=[msg('503','Notices <notice@example.test>')];messages[0].payload.parts=[{mimeType:'text/html',body:{data:Buffer.from('<script>void 0</script>').toString('base64url')}}];
  await assert.rejects(()=>gmail.fetchMessageHtml('unseen-empty','503'),/empty/);
  await assert.rejects(()=>gmail.fetchMessageHtml('unseen-empty','missing'),/unavailable/);
  messages=[];await assert.rejects(()=>gmail.fetchThreadHtml('unseen-empty-thread'),/unavailable/);
 } finally {messages=previous;}
});
