// The inbox's Gmail load: never shows the demo mailbox when Gmail fails, and
// re-uses one load for a short while instead of re-fetching the whole mailbox
// on every page refresh (which ran Joe's account into Google's rate limit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

globalThis.__gmail = { pageCalls: 0, fail: null, threads: [], mailbox: "joe@example.test" };
const stubs = {
  "./ai": "export const ai = {};",
  "./db": `export const query = async (sql) => ({ rows: globalThis.__queryRows?.(sql) ?? [] });`,
  "./dal": 'export const getCurrentUser = async () => ({ id: "u", role: "owner", name: "Joe" });',
  "./mailbox":
    'export const activeMailbox = () => ({ refreshToken: globalThis.__gmail.disconnected ? null : "r", email: globalThis.__gmail.mailbox, linked: false }); export const mailboxFor = async () => ({ refreshToken: globalThis.__gmail.disconnected ? null : "r", email: globalThis.__gmail.mailbox, linked: false }); export const runWithMailbox = (mb, fn) => fn();',
  "./dev-agents": "export const askHermes = async () => ({});",
  "./gmail": `
    export const gmailOAuthAppConfigured = () => true;
    export const fetchConversation = async () => ({});
    export const fetchThreads = async () => [];
    export const fetchLabels = async () => [];
    export const fetchLabelCounts = async () => [];
    export const fetchThreadPage = async () => {
      globalThis.__gmail.pageCalls++;
      if (globalThis.__gmail.fail) throw new Error(globalThis.__gmail.fail);
      return { threads: globalThis.__gmail.threads, nextPageToken: null };
    };`,
};
registerHooks({
  resolve(s, c, n) {
    if (s in stubs && c.parentURL?.endsWith("/lib/inbox.ts")) return { url: `stub:${s}`, shortCircuit: true };
    if (s === "./inbox-rules") return n("../lib/inbox-rules.ts", c);
    return n(s, c);
  },
  load(u, c, n) {
    if (u.startsWith("stub:")) return { format: "module", source: stubs[u.slice(5)], shortCircuit: true };
    return n(u, c);
  },
});
const { getInboxData, invalidateInboxCache, loadSystemView, loadLabelInbox } = await import("../lib/inbox.ts");

test("a Gmail failure shows an empty mailbox and says why — never the demo conversations", async () => {
  invalidateInboxCache();
  globalThis.__gmail.fail = "Gmail rate limit hit (threads.get) after 3 attempts: Quota exceeded";
  const data = await getInboxData();
  assert.equal(data.threads.length, 0, "no made-up threads");
  assert.match(data.loadError ?? "", /too many requests/i);
  assert.equal(data.mailbox.connected, true);
  assert.ok(Array.isArray(data.channels) && data.channels.length > 0, "the channel rail (texts, portal, forms) still renders");
});

test("one Gmail load serves page refreshes for a short while; a failure or an inbox action re-fetches", async () => {
  invalidateInboxCache();
  globalThis.__gmail.fail = "Gmail didn't answer";
  globalThis.__gmail.pageCalls = 0;
  await getInboxData();
  globalThis.__gmail.fail = null;
  const ok = await getInboxData();
  assert.equal(globalThis.__gmail.pageCalls, 2, "a failed load is not kept");
  assert.equal(ok.loadError, undefined);
  await getInboxData();
  await getInboxData();
  assert.equal(globalThis.__gmail.pageCalls, 2, "refreshes re-use the load");
  invalidateInboxCache();
  await getInboxData();
  assert.equal(globalThis.__gmail.pageCalls, 3, "an inbox action clears it");
});

const email = { id:'real',fromName:'Client',fromEmail:'client@example.test',toLine:'joe@example.test',subject:'Plans',snippet:'Please check',date:1000,unread:false,starred:false,important:false,inInbox:true,snoozed:false,outbound:false,category:'primary',labelIds:['INBOX'],bodyParas:['Hello'] };
test('last good snapshot survives an outage, unknown counts are null and non-email keeps loading', async () => {
  globalThis.__gmail.fail = null; globalThis.__gmail.threads = [email]; invalidateInboxCache();
  const good = await getInboxData(); assert.equal(good.threads[0].id,'real');
  globalThis.__gmail.fail = 'quota exceeded'; invalidateInboxCache();
  globalThis.__queryRows = sql => /FROM sms_threads/.test(sql) ? [{id:'5',phone:'+16125551234',contact_name:'Tom',unread:false,last_message_at:'2026-10-30',last_body:'Hi',last_dir:'in'}] : [];
  const stale = await getInboxData();
  assert.ok(stale.threads.some(t=>t.id==='real')); assert.ok(stale.threads.some(t=>t.id==='sms:5'));
  assert.ok(stale.lastSyncedAt); assert.equal(stale.emailPaused,true);
  assert.equal(stale.channels.find(c=>c.key==='email').count,null);
  assert.equal(stale.channels.find(c=>c.key==='sms').count,1);
  assert.equal(stale.smartViews[0].count,null);
  globalThis.__gmail.mailbox = 'someone-else@example.test';
  assert.ok(!(await getInboxData()).threads.some(t=>t.id==='real'),'no cross-mailbox fallback');
  globalThis.__gmail.mailbox = 'joe@example.test'; globalThis.__queryRows = null;
  globalThis.__gmail.fail = null; globalThis.__gmail.threads = [];
});

test('system and label caches include mailbox, view and page; actions invalidate them', async () => {
  invalidateInboxCache(); globalThis.__gmail.pageCalls = 0;
  await Promise.all([loadSystemView('sent'),loadSystemView('sent')]);
  assert.equal(globalThis.__gmail.pageCalls,1);
  await loadSystemView('starred'); await loadSystemView('sent','page-2');
  await loadLabelInbox('label-1'); await loadLabelInbox('label-1'); await loadLabelInbox('label-2');
  assert.equal(globalThis.__gmail.pageCalls,5);
  globalThis.__gmail.mailbox = 'other@example.test'; await loadSystemView('sent'); assert.equal(globalThis.__gmail.pageCalls,6);
  globalThis.__gmail.mailbox = 'joe@example.test'; invalidateInboxCache(); await loadSystemView('sent'); assert.equal(globalThis.__gmail.pageCalls,7);
});

test('rows explain needs-me, outbound unread and staff never need Joe, email reader maps every message', async () => {
  globalThis.__gmail.threads = [email, {...email,id:'staff',fromEmail:'staff@example.test'}, {...email,id:'out',fromEmail:'joe@example.test',toLine:'client@example.test',outbound:true,unread:true}];
  globalThis.__queryRows = sql => /FROM users/.test(sql) ? [{email:'staff@example.test'}] : [];
  invalidateInboxCache(); const data = await getInboxData();
  assert.equal(data.smartViews.find(v=>v.key==='needs_reply').label,'Needs me');
  assert.ok(data.threads.find(t=>t.id==='real').needsMeReason);
  assert.notEqual(data.threads.find(t=>t.id==='staff').view,'needs_reply');
  assert.notEqual(data.threads.find(t=>t.id==='out').view,'needs_reply');
  globalThis.__queryRows = null;
});

test('non-email channels also render without a connected mailbox',async()=>{
  globalThis.__gmail.threads=[]; globalThis.__gmail.fail=null; globalThis.__gmail.disconnected=true;
  globalThis.__queryRows=sql=>/FROM sms_threads/.test(sql)?[{id:'8',phone:'+16125551234',last_dir:'out',unread:true,last_body:'Hello'}]:[];
  const data=await getInboxData();
  assert.equal(data.mailbox.connected,false); assert.ok(data.threads.some(t=>t.id==='sms:8'));
  assert.notEqual(data.threads.find(t=>t.id==='sms:8').view,'needs_reply');
  globalThis.__gmail.disconnected=false;globalThis.__queryRows=null;
});

test('label outage reuses its own last-good page and identifies it as paused',async()=>{
  globalThis.__gmail.fail=null;globalThis.__gmail.threads=[email];invalidateInboxCache();
  const good=await loadLabelInbox('label-cached');assert.equal(good.threads[0].id,'real');
  globalThis.__gmail.fail='quota';invalidateInboxCache();
  const stale=await loadLabelInbox('label-cached');assert.equal(stale.threads[0].id,'real');assert.equal(stale.emailPaused,true);
  await assert.rejects(()=>loadLabelInbox('label-never-loaded'),/quota/);
  globalThis.__gmail.fail=null;
});

test('reader preserves every email message and orders SMS ties by numeric message id',async()=>{
  const entries=[{id:'m1',fromName:'Tom',fromEmail:'tom@example.test',to:['joe@example.test'],cc:['ana@example.test'],date:1000,body:['Hello'],snippet:'Hello',outbound:false,replyTo:'tom@example.test',messageId:'<m1@test>',references:'',attachments:[{id:'a',name:'plans.pdf',size:1024,type:'application/pdf'}]},{id:'m2',fromName:'Joe',fromEmail:'joe@example.test',to:['tom@example.test'],cc:[],date:2000,body:['Thanks'],snippet:'Thanks',outbound:true,replyTo:'',messageId:'<m2@test>',references:'<m1@test>',attachments:[]}];
  globalThis.__gmail.fail=null;globalThis.__gmail.threads=[{...email,messages:entries,ownAddresses:['joe@example.test']}];
  let smsSql='';
  globalThis.__queryRows=sql=>{
    if(/FROM sms_threads/.test(sql))return [{id:'9',phone:'+16125551234',last_dir:'in',last_body:'Hi'}];
    if(/FROM sms_messages WHERE/.test(sql)){smsSql=sql;return [];}
    return [];
  };
  invalidateInboxCache();const data=await getInboxData();
  assert.deepEqual(data.readers.real.messages.map(m=>m.id),['m1','m2']);
  assert.equal(data.readers.real.messages[0].attachments[0].name,'plans.pdf');
  assert.equal(data.readers.real.replyTarget.toEmail,'tom@example.test');
  assert.match(smsSql,/ORDER BY created_at, sms_messages.id/);
  globalThis.__queryRows=null;
});

test('channel Done survives reload, a newer inbound reopens it, and manual links enrich channels',async()=>{
 globalThis.__gmail.fail=null;globalThis.__gmail.threads=[];let at='2026-10-30T12:00:00Z';
 globalThis.__queryRows=sql=> /FROM sms_threads/.test(sql)?[{id:'5',phone:'+16125551234',contact_name:'Tom',unread:false,last_message_at:at,last_body:'Hi',last_dir:'in'}]
  : /SELECT inbox_key/.test(sql)?[{inbox_key:'sms:5',last_message_at:'2026-10-30T12:00:00Z'}]
  : /FROM thread_links tl/.test(sql)?[{thread_id:'sms:5',link_type:'project',link_slug:'kitchen',label:'Kitchen',stage:'Construction'}]:[];
 invalidateInboxCache();let t=(await getInboxData()).threads.find(t=>t.id==='sms:5');assert.equal(t.view,'done');assert.equal(t.needsMeReason,undefined);assert.equal(t.projectSlug,'kitchen');assert.equal(t.projectLabel,'Kitchen');
 at='2026-10-31T12:00:00Z';invalidateInboxCache();t=(await getInboxData()).threads.find(t=>t.id==='sms:5');assert.equal(t.view,'needs_reply');assert.ok(t.needsMeReason);
 globalThis.__queryRows=null;
});
test('email, text and project portal share a person key and preserve job stages',async()=>{
 globalThis.__gmail.threads=[{...email,fromEmail:'tom@example.test'}];
 globalThis.__queryRows=sql=>/AS kind/.test(sql)?[{email:'tom@example.test',name:'Tom',slug:'tom',kind:'client',stage:'Rough estimate'}]
 :/AS project_slug/.test(sql)?[{email:'tom@example.test',project_slug:'kitchen',project_label:'Kitchen',stage:'Construction'}]
 :/FROM sms_threads/.test(sql)?[{id:'5',phone:'+16125551234',contact_name:'Tom',link_type:'project',link_slug:'kitchen',unread:false,last_message_at:'2026-10-30',last_body:'Hi',last_dir:'in'}]
 :/GROUP BY m.channel_key/.test(sql)?[{channel_key:'portal:kitchen',proj_name:'Kitchen',lead_slug:'tom',client_name:'Tom',last_author:'user',last_is_staff:false,last_body:'Hello',last_at:'2026-10-30'}]:[];
 invalidateInboxCache();const data=await getInboxData();for(const id of ['real','sms:5','portal:kitchen']){const t=data.threads.find(t=>t.id===id);assert.equal(t.contactKey,'lead:tom',id);assert.equal(t.contactStage,'Construction',id);}
 globalThis.__queryRows=null;globalThis.__gmail.threads=[];
});

test('round 2 screens real-mail cases, keeps new senders visible and loads to-dos in one batch', async () => {
  globalThis.__gmail.fail=null;
  globalThis.__gmail.threads=[
    {...email,id:'known',fromEmail:'michelle@example.test'},
    {...email,id:'bank',fromEmail:'eStatements@villagebankonline.com',bodyParas:['Please do not reply to this email.']},
    {...email,id:'mca',fromEmail:'frank.v@easternfinancialpartners.test',subject:'Pre-Approved – MCA Consolidation',category:'updates',labelIds:['INBOX','CATEGORY_UPDATES']},
    {...email,id:'pitch',fromEmail:'mary@example.test',subject:'Partnership Opportunity'},
    {...email,id:'header',messages:[{...email,id:'m-header',automated:true,fromEmail:'sender@example.test',to:['Joe'],cc:[],body:['Newsletter']} ]},
  ];
  let taskReads=0;
  globalThis.__queryRows=sql=> {
    if (/FROM leads WHERE email/.test(sql)) return [{email:'michelle@example.test',name:'Michelle Alcantara',slug:'michelle',kind:'client',stage:'rough estimate'}];
    if (/SELECT DISTINCT w.id::text/.test(sql)) {taskReads++;return [{id:'w1',thread_id:'known',title:'Send revised estimate',due_at:'2026-11-06',assignees:'Joe'}];}
    return [];
  };
  invalidateInboxCache();
  const data=await getInboxData();
  assert.equal(data.threads.find(t=>t.id==='known').needsMeReason,'Lead replied');
  assert.equal(data.threads.find(t=>t.id==='known').hasOpenTodo,true);
  assert.equal(data.threads.find(t=>t.id==='known').todos[0].id,'w1');
  assert.equal(taskReads,1,'one task read for the loaded window');
  for(const id of ['bank','mca','header']) {
    assert.equal(data.threads.find(t=>t.id===id).automated,true,id);
    assert.equal(data.threads.find(t=>t.id===id).needsMeReason,undefined,id);
    assert.equal(data.readers[id].automated,true,id);
  }
  const pitch=data.threads.find(t=>t.id==='pitch');
  assert.equal(pitch.newSender,true);assert.equal(pitch.needsMeReason,'New sender');assert.equal(pitch.inInbox,true);
  assert.equal(data.smartViews.find(v=>v.key==='needs_reply').count,1);
  globalThis.__queryRows=null;globalThis.__gmail.threads=[];
});

test('a known client Gmail tags Updates (or a CRM List-Unsubscribe) stays in Needs me and can be answered', async () => {
  globalThis.__gmail.fail=null;
  globalThis.__gmail.threads=[
    {...email,id:'client-upd',fromEmail:'michelle@example.test',category:'updates',labelIds:['INBOX','UNREAD','CATEGORY_UPDATES']},
    {...email,id:'stranger-upd',fromEmail:'promo@shop.test',category:'updates',labelIds:['INBOX','CATEGORY_UPDATES']},
  ];
  globalThis.__queryRows=sql=>/FROM leads WHERE email/.test(sql)?[{email:'michelle@example.test',name:'Michelle Alcantara',slug:'michelle',kind:'client',stage:'rough estimate'}]:[];
  invalidateInboxCache();
  const data=await getInboxData();
  const client=data.threads.find(t=>t.id==='client-upd');
  assert.equal(client.automated,false);
  assert.equal(client.view,'needs_reply');
  assert.equal(client.needsMeReason,'Lead replied');
  assert.equal(data.readers['client-upd'].automated,false);
  assert.equal(data.threads.find(t=>t.id==='stranger-upd').automated,true);
  globalThis.__queryRows=null;globalThis.__gmail.threads=[];
});


test('round 3 preserves action-required automation, excludes done/self/outbound screening, and restores persisted decisions',async()=>{
 globalThis.__gmail.fail=null;
 const raw=(id,patch={})=>({...email,id,...patch});
 globalThis.__gmail.threads=[raw('square',{fromEmail:'noreply@squareup.com',subject:'Action required to avoid a hold on Square transfers',category:'updates'}),raw('receipt',{fromEmail:'receipts@menards.com',subject:'Your receipt',category:'updates'}),raw('done',{inInbox:false}),raw('self',{fromEmail:'alias@example.test'}),raw('out-alias',{fromEmail:'alias@example.test',outbound:true,toLine:'other@example.test'}),raw('decided'),raw('pending')];
 globalThis.__queryRows=sql=>/FROM inbox_preferences/.test(sql)?[{subject_key:'sender:client@example.test',decision:'other'},{subject_key:'thread:receipt',decision:'attention'}]:[];
 invalidateInboxCache();let data=await getInboxData();
 const square=data.threads.find(t=>t.id==='square');assert.equal(square.view,'needs_reply');assert.match(square.needsMeReason,/Needs attention · Action required/);
 assert.equal(data.threads.find(t=>t.id==='receipt').view,'needs_reply');
 assert.equal(data.threads.find(t=>t.id==='done').newSender,false);assert.equal(data.threads.find(t=>t.id==='self').newSender,false);assert.equal(data.threads.find(t=>t.id==='out-alias').newSender,false);
 assert.equal(data.threads.find(t=>t.id==='decided').filedOther,true);assert.equal(data.threads.find(t=>t.id==='pending').newSender,false);
 globalThis.__queryRows=sql=>/FROM inbox_preferences/.test(sql)?[{subject_key:'thread:square',decision:'other'}]:[];
 data=await getInboxData();assert.notEqual(data.threads.find(t=>t.id==='square').view,'needs_reply');
 assert.equal(data.threads.find(t=>t.id==='pending').newSender,true);
 globalThis.__queryRows=null;globalThis.__gmail.threads=[];
});

test('an alias learned on one loaded page is excluded from screening on later pages, scoped to mailbox',async()=>{
 globalThis.__gmail.threads=[{...email,id:'sent-alias',fromEmail:'second-alias@example.test',outbound:true,toLine:'client@example.test'}];
 invalidateInboxCache();await getInboxData();
 globalThis.__gmail.threads=[{...email,id:'self-alias',fromEmail:'second-alias@example.test'}];invalidateInboxCache();
 assert.equal((await getInboxData()).threads[0].newSender,false);
 globalThis.__gmail.mailbox='separate@example.test';invalidateInboxCache();assert.equal((await getInboxData()).threads[0].newSender,true);
 globalThis.__gmail.mailbox='joe@example.test';globalThis.__gmail.threads=[];
});
