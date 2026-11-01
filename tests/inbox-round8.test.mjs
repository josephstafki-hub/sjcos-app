import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchingSuggestion, draftRow, prepareDraftSend, finishDraftSend, draftStatusLabel} from '../lib/inbox-draft-ui.ts';
import {orderedInboxThreads,applyInboxPreferences,matchesInboxTab} from '../lib/inbox-experience.ts';
const text={body:'My reply',toEmail:'client@example.test',cc:[],subject:'Plans'};
const ai={...text,id:'suggestion',threadKey:'t',channel:'email',source:'ai',sourceMessageId:'m2',status:'ready',summary:'Confirm the visit',model:'claude'};
test('suggestions match latest inbound id, channel and owner only',()=>{
 const reader={channel:'email',messages:[{id:'m1'},{id:'m2'},{id:'out',outbound:true}]};
 assert.equal(matchingSuggestion([ai], 't',reader,true),ai);
 assert.equal(matchingSuggestion([ai], 't',reader,false),null);
 assert.equal(matchingSuggestion([{...ai,sourceMessageId:'m1'}], 't',reader,true),null);
 assert.equal(matchingSuggestion([ai], 't',{...reader,messages:[]},true),null);
 assert.equal(matchingSuggestion([{...ai,channel:'sms'}], 't',reader,true),null);
});
test('draft-ready row uses summary and original reason, ranks before other human replies',()=>{
 const thread={id:'t',view:'needs_reply',needsMeReason:'Client replied',preview:'Plans?',receivedAt:Date.now()-86400000};
 const row=draftRow(thread,ai);
 assert.equal(row.needsMeReason,'Draft ready · Client replied');assert.equal(row.actionTitle,ai.summary,'AI headline becomes the action line');assert.equal(row.preview,'Plans?','the sender\'s own words stay as the preview');
 const today={id:'new',view:'needs_reply',receivedAt:Date.now()};
 assert.equal(orderedInboxThreads([today,row],new Date(),new Set(['t']))[0].id,'t');
 assert.equal(draftRow({...thread,filedOther:true},ai).preview,'Plans?');
});
test('all status labels are honest',()=>{
 assert.deepEqual(['saved','saving','local only','conflict'].map(draftStatusLabel),['Saved','Saving…','Saved on this device only','This draft changed on another device']);
});
test('send flush refuses conflicts, unsaved text and a changed snapshot',async()=>{
 const base={draft:text,status:'saved',version:4,conflict:null};
 assert.equal((await prepareDraftSend(text,async()=>base)).version,4);
 for(const state of [{...base,status:'conflict',conflict:{current:null}},{...base,status:'local only'},{...base,draft:{...text,body:'Other device'}}])
  await assert.rejects(()=>prepareDraftSend(text,async()=>state),/draft|saving/i);
});
test('cleanup failure after success never retries the send and keeps the sent version',async()=>{
 let sends=0,marked=[],refreshes=0;
 const send=async()=>{sends++;return {ok:true}};
 const result=await send();assert.equal(result.ok,true);
 const warning=await finishDraftSend({threadKey:'t',channel:'email',baseVersion:4,suggestionId:'old'},async input=>{marked.push(input);throw Error('offline')},async()=>{refreshes++});
 assert.match(warning,/Sent/);assert.equal(sends,1);assert.equal(marked[0].baseVersion,4);assert.equal(marked[0].suggestionId,'old');assert.equal(refreshes,1);
 const conflict=await finishDraftSend({threadKey:'t',channel:'sms',baseVersion:4},async()=>({conflict:true,current:{version:5}}),async()=>{});
 assert.match(conflict,/another device/);
});

test('blocked future mail files to Other even for a known sender, undo restores the prior decision',()=>{
 const future={id:'future',fromEmail:'CLIENT@example.test',contactRole:'client',newSender:false,view:'needs_reply'};
 const blocked=applyInboxPreferences(future,{'sender:client@example.test':'blocked'});
 assert.equal(blocked.filedOther,true);assert.equal(matchesInboxTab(blocked,'needs'),false);assert.equal(matchesInboxTab(blocked,'other'),true);
 assert.equal(applyInboxPreferences(blocked,{'sender:client@example.test':'linked'}).filedOther,false);
});
