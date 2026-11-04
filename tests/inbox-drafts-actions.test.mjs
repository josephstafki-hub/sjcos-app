import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const stubs={
 '@/lib/db':`export const query=async(sql,p)=>globalThis.__draftActions.query(sql,p);`,
 '@/lib/dal':`export const requireAccess=async area=>{if(area!=='inbox')throw Error('wrong permission');if(globalThis.__draftActions.denied)throw Error('denied');return globalThis.__draftActions.user;};export const requireRole=async role=>{if(globalThis.__draftActions.user.role!==role)throw Error('denied')};`,
 '@/lib/mailbox-email':`export const ensureMailboxEmail=async()=>(globalThis.__draftActions.active?.email??'').toLowerCase();`,
 '@/lib/mailbox':`export const activeMailbox=()=>globalThis.__draftActions.active;
 export const withMailboxFor=async (user,fn)=>{const a=globalThis.__draftActions;a.scopes++;a.active={userId:user.id,email:a.email,refreshToken:a.email?'stub':null};return fn()};`,
 'next/cache':`export const revalidatePath=()=>{};`,
};
registerHooks({resolve(s,c,n){if(c.parentURL?.endsWith('/lib/actions/inbox-drafts.ts')&&s in stubs)return {url:'stub:actions:'+s,shortCircuit:true};return n(s,c)},load(u,c,n){return u.startsWith('stub:actions:')?{format:'module',source:stubs[u.slice(13)],shortCircuit:true}:n(u,c)}});
const {loadDrafts,saveDraft,discardDraft,markDraftSent,dismissSuggestion,setInboxDraftModel}=await import('../lib/actions/inbox-drafts.ts');
const input={threadKey:'thread-1',channel:'email',body:'My reply',toEmail:'client@example.test',cc:[],subject:'Plans',baseVersion:0};
let rows;
beforeEach(()=>{
 rows=new Map();globalThis.__draftActions={user:{id:'joe',role:'owner'},email:'JOE@example.test',calls:[],scopes:0,
  async query(sql,p){
   const a=globalThis.__draftActions;a.calls.push({sql,p});
   if(/app_settings/.test(sql))return {rows:[]};
   if(/thread_key=ANY/.test(sql)) {
    assert.equal(p[0],a.email?.toLowerCase()||`user:${a.user.id}`);assert.match(sql,/source='human' AND user_id=\$3/);assert.match(sql,/\$4 AND source='ai' AND status='ready'/);
    return {rows:[...rows.values()].filter(r=>r.mailbox===p[0]&&p[1].includes(r.threadKey)&&((r.source==='human'&&r.userId===p[2])||(p[3]&&r.source==='ai'&&r.status==='ready')))};
   }
   if(/WHERE id=\$1 AND mailbox=\$2 AND source='ai'/.test(sql)) {for(const row of rows.values())if(row.id===p[0]&&row.mailbox===p[1]&&row.source==='ai')row.status=/status='sent'/.test(sql)?'sent':'discarded';return {rows:[]};}
   const key=p.slice(0,4).join(':');const old=rows.get(key);
   if(/SELECT/.test(sql)&&!/^\s*(INSERT|UPDATE)/.test(sql))return {rows:old?[{...old}]:[]};
   if(/^INSERT/.test(sql)) {
    assert.match(sql,/ON CONFLICT .* WHERE source='human' DO NOTHING/);
    if(old)return {rows:[]};
    const row={id:key,mailbox:p[0],userId:p[1],threadKey:p[2],channel:p[3],source:'human',body:p.length>=12?p[7]:'',toEmail:p.length>=12?p[4]:'',cc:p.length>=12?p[5]:[],subject:p.length>=12?p[6]:'',model:p.length>=12?p[8]:null,basedOn:p.length>=12?p[9]:'',acceptedSuggestionId:p.length>=12?p[10]:null,humanEdited:p.length>=12?p[11]:false,sources:p.length>12?JSON.parse(p[12]):[],version:1,status:p.length>=12?'ready':p[4]};rows.set(key,row);return {rows:[{...row}]};
   }
   if(/^UPDATE/.test(sql)) {
    assert.match(sql,/AND source='human'.*AND version=\$/s);
    const saving=/SET to_email/.test(sql);const base=saving?p[8]:p[5];if(!old||old.version!==base)return {rows:[]};
    Object.assign(old,saving?{body:p[7],toEmail:p[4],cc:p[5],subject:p[6],model:p[9],basedOn:p[10],acceptedSuggestionId:p[11],humanEdited:p[12],sources:JSON.parse(p[13]??'[]'),status:'ready'}:{status:p[4],body:''});old.version++;return {rows:[{...old}]};
   }
   throw Error('Unexpected SQL '+sql);
  }
 };
});
test('initial save and concurrent stale writer cannot overwrite text',async()=>{
 const [a,b]=await Promise.all([saveDraft(input),saveDraft({...input,body:'Other device'})]);assert.equal(a.conflict,false);assert.equal(b.conflict,true);assert.equal(b.current.body,'My reply');
 const saved=await saveDraft({...input,baseVersion:1,body:'Revised'});assert.equal(saved.current.version,2);
 const stale=await saveDraft({...input,baseVersion:1});assert.equal(stale.conflict,true);assert.equal(stale.current.body,'Revised');
});
test('discard/sent keep versioned tombstones, stale offline saves and late sends conflict',async()=>{
 await saveDraft(input);await discardDraft({...input,baseVersion:1});assert.equal((await saveDraft(input)).conflict,true);
 let result=await saveDraft({...input,baseVersion:2,body:'New draft'});assert.equal(result.current.version,3);
 result=await markDraftSent({...input,baseVersion:2});assert.equal(result.conflict,true);assert.equal(result.current.body,'New draft');
 result=await markDraftSent({...input,baseVersion:3});assert.equal(result.current.status,'sent');assert.equal(result.current.version,4);
 assert.equal((await saveDraft({...input,baseVersion:3})).conflict,true);
});
test('finishing an unsynced draft prevents a late initial save',async()=>{
 const done=await markDraftSent(input);assert.equal(done.conflict,false);assert.equal((await saveDraft(input)).conflict,true);
});
test('one batch query; only own human drafts and owner-mailbox suggestions',async()=>{
 await saveDraft(input);rows.set('staff',{...input,mailbox:'joe@example.test',userId:'staff',source:'human',threadKey:'thread-1'});
 rows.set('ai',{...input,id:'00000000-0000-4000-8000-000000000001',mailbox:'joe@example.test',source:'ai',status:'ready'});
 let count=__draftActions.calls.length;let loaded=await loadDrafts(['thread-1','thread-2']);assert.equal(__draftActions.calls.length-count,1);assert.equal(loaded.length,2);
 __draftActions.user={id:'staff',role:'staff'};loaded=await loadDrafts(['thread-1']);assert.equal(loaded.length,1);assert.equal(loaded[0].userId,'staff');
 await assert.rejects(()=>dismissSuggestion('00000000-0000-4000-8000-000000000001'),/Only the owner/);
 __draftActions.email='other@example.test';assert.deepEqual(await loadDrafts(['thread-1']),[]);
});
test('all actions enforce access, never use owner fallback for disconnected staff, and validate model',async()=>{
 __draftActions.denied=true;for(const action of [()=>loadDrafts(['thread-1']),()=>saveDraft(input),()=>discardDraft(input),()=>markDraftSent(input),()=>dismissSuggestion('00000000-0000-4000-8000-000000000001')])await assert.rejects(action,/denied/);
 assert.equal(__draftActions.calls.length,0);__draftActions.denied=false;__draftActions.user={id:'staff',role:'staff'};__draftActions.email=null;
 await assert.rejects(()=>saveDraft(input),/Connect your mailbox/);await saveDraft({...input,channel:'sms',threadKey:'sms:1'});assert.equal(__draftActions.calls.at(-1).p[0],'user:staff');
 await assert.rejects(()=>setInboxDraftModel('claude'),/denied/);__draftActions.user.role='owner';await assert.rejects(()=>setInboxDraftModel('qwen'),/Choose Claude or Hermes/);
 await setInboxDraftModel('hermes');assert.deepEqual(__draftActions.calls.at(-1).p,['hermes']);
});
test('bad inputs fail without a database call',async()=>{
 for(const bad of [{baseVersion:-1},{channel:'unknown'},{threadKey:''},{cc:'unsafe'},{body:1}])await assert.rejects(()=>saveDraft({...input,...bad}),/Invalid/);
 await assert.rejects(()=>loadDrafts(Array(201).fill('x')),/Invalid/);assert.equal(__draftActions.calls.length,0);
});

test('successful explicit send retires only the specified owner suggestion',async()=>{
 const suggestionId='00000000-0000-4000-8000-000000000001';
 rows.set('ai',{id:suggestionId,mailbox:'joe@example.test',threadKey:'thread-1',source:'ai',status:'ready'});
 rows.set('new-ai',{id:'00000000-0000-4000-8000-000000000002',mailbox:'joe@example.test',threadKey:'thread-1',source:'ai',status:'ready'});
 await saveDraft(input);const sent=await markDraftSent({...input,baseVersion:1,suggestionId});assert.equal(sent.conflict,false);
 assert.equal(rows.get('ai').status,'sent');assert.equal(rows.get('new-ai').status,'ready');
 assert.match(__draftActions.calls.at(-1).sql,/thread_key=\$3/);
});

test('unseen reviewed draft persists authorship and exact accepted suggestion with scoped SQL and no send',async()=>{
 const provenance={model:'claude',basedOn:'Terrace request plus railing specification',acceptedSuggestionId:'12345678-1234-4123-8123-123456789012',humanEdited:true};
 const result=await saveDraft({...input,body:'I will price the railing options',provenance});
 assert.equal(result.current.model,'claude');assert.equal(result.current.basedOn,provenance.basedOn);assert.equal(result.current.acceptedSuggestionId,provenance.acceptedSuggestionId);
 assert.match(__draftActions.calls.at(-1).sql,/mailbox=\$1 AND thread_key=\$3 AND channel=\$4 AND source='ai'/);
 const updated=await saveDraft({...input,baseVersion:1,provenance:{...provenance,model:'hermes'}});assert.equal(updated.current.model,'hermes');
 for(const bad of [{...provenance,model:'unknown'},{...provenance,acceptedSuggestionId:'invalid'},{...provenance,humanEdited:'yes'}])await assert.rejects(()=>saveDraft({...input,provenance:bad}),/Invalid draft provenance/);
});

 test('exact source references persist through initial save, edit and reload',async()=>{
 const sources=[{kind:'message',messageId:'gate-82',threadId:input.threadKey,label:'Inbound message'},{kind:'lead',slug:'garden-gate',label:'Garden gate'}];
 const provenance={model:'claude',basedOn:'Gate request',acceptedSuggestionId:null,humanEdited:false,sources};
 const first=await saveDraft({...input,provenance});assert.deepEqual(first.current.sources,sources);
 assert.match(__draftActions.calls.at(-1).sql,/sources/);
 await saveDraft({...input,baseVersion:1,body:'Updated gate answer',provenance:{...provenance,humanEdited:true}});
 assert.deepEqual((await loadDrafts([input.threadKey]))[0].sources,sources);
 await assert.rejects(()=>saveDraft({...input,provenance:{...provenance,sources:[{...sources[0],threadId:'foreign-thread'}]}}),/Invalid draft sources/);
 });
