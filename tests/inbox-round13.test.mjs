import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rowActionTitle,automationState} from '../lib/inbox-review.ts';

// Invented mail only; no models, mailbox, database, network or screenshot mail.
test('automated titles preserve the event, reference and amount instead of just its category',()=>{
 for(const [subject,kind,expected] of [
  ['Re: Loan debit initiated · $183.27','Payment','Loan debit initiated · $183.27'],
  ['Fwd: Invoice #846 paid · $925.12','Receipt','Invoice #846 paid · $925.12'],
  ['Re: [tracker] Export fails after reconnect (#81)','Notification','[tracker] Export fails after reconnect (#81)'],
  ['Account 482 statement · September','Statement','Account 482 statement · September'],
  ['Your annual subscription renews December 7','Notification','Your annual subscription renews December 7'],
 ]){
  for(const done of [false,true]){
   const t={subject,fromName:'Service desk',automated:true,automationKind:kind,view:done?'done':'needs_reply',inInbox:!done,
    actionTitle:'Review notification',preview:'Please complete the information request within 7 days'};
   assert.equal(rowActionTitle(t),expected);
   if(done)assert.equal(automationState(t).label,`${kind} · done`);
  }
 }
});
test('done rows use the subject while active human requests retain their model headline',()=>{
 const t={subject:'Re: Roof lantern options',fromName:'Morgan',actionTitle:'Confirm the opening dimensions'};
 assert.equal(rowActionTitle(t),t.actionTitle);assert.equal(rowActionTitle({...t,view:'done'}),'Roof lantern options');
 assert.equal(rowActionTitle({subject:'Invoice &amp; receipt #88',fromName:'Billing',automated:true}),'Invoice & receipt #88');
});

test('rows expose one status even when unread, draft, done and task information overlap',async()=>{
 const {rowStatus}=await import('../lib/inbox-review.ts');
 const base={subject:'Patio roof',fromName:'Devon',unread:true,needsMeReason:'Client replied',todos:[{id:'task',title:'Check roof clearance'}]};
 assert.deepEqual(rowStatus({...base,needsMeReason:'Draft ready · Client replied'}),{label:'Draft',kind:'ai',todo:false});
 assert.deepEqual(rowStatus({...base,view:'done'}),{label:'To-do · Check roof clearance',kind:'work',todo:true});
 assert.deepEqual(rowStatus({...base,automated:true,automationKind:'Receipt',view:'done',inInbox:false}),{label:'Receipt · done',kind:'muted',todo:false});
 assert.equal(rowStatus({...base,todos:[]}).label,'Client replied');
});
