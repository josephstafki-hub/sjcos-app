import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,DomUtils} from 'htmlparser2';
import {foldEmailQuotes} from '../lib/inbox-email-html.ts';
import {remoteImagePolicy,applyRemoteImagePolicy} from '../lib/inbox-image-policy.ts';
import {substantiveSnippet} from '../lib/inbox-rules.ts';

test('inline iOS attribution moves its whole linked line into history, leaving the signature visible',()=>{
 const html='<div>New scope.</div><div>Alex&nbsp;<br><br>On Tuesday, November 3, 2026, Builder &lt;<a href="mailto:builder@example.test">builder@example.test</a>&gt; wrote:<br><blockquote style="border-left:1px solid">OLD SCOPE</blockquote></div>';
 const doc=parseDocument(foldEmailQuotes(html));const quotes=DomUtils.findAll(e=>e.name==='blockquote',doc.children);
 assert.equal(quotes.length,1);assert.match(DomUtils.textContent(quotes[0]),/On Tuesday.*builder@example.test.*wrote:.*OLD SCOPE/s);
 quotes.forEach(DomUtils.removeElement);assert.match(DomUtils.textContent(doc),/Alex/);assert.doesNotMatch(DomUtils.textContent(doc),/wrote:|builder@example/);
});
test('image DOM policy counts actual remote resources and collapses decorative rows while preserving table layout and embedded images',()=>{
 const html='<table style="width:640px;border-spacing:12px"><tr><td style="padding:12px;width:50%">Amount</td><td>$500</td></tr><tr><td><a href="https://social.test"><img src="https://tracker.test/a" alt="social"></a></td></tr></table><picture><source srcset="https://tracker.test/b 1x, https://tracker.test/c 2x"><img src="data:image/png;base64,AAAA"></picture><svg><image href="//tracker.test/d"/></svg><video poster="https://tracker.test/e"></video><div background="https://tracker.test/f" style="padding:8px;background-image:url(https://tracker.test/g)">Keep</div><img src="cid:logo">';
 const result=applyRemoteImagePolicy(html,false);
 assert.equal(result.blocked,7);assert.doesNotMatch(result.html,/tracker\.test|alt="social"|<svg/);
 assert.match(result.html,/padding:12px/);assert.match(result.html,/border-spacing:12px/);assert.match(result.html,/src="data:/);assert.match(result.html,/src="cid:/);
 const doc=parseDocument(result.html);assert.equal(DomUtils.findAll(e=>e.name==='tr',doc.children).length,1);
 assert.equal(applyRemoteImagePolicy('<img src="data:image/jpeg;base64,AAAA"><img src="cid:logo">',false).blocked,0);
 assert.equal(remoteImagePolicy(html,true),html);
});
test('rows reconstruct a full request, reject negated scope and boilerplate questions',()=>{
 assert.equal(substantiveSnippet(['Hello Joe,\n\nCould you provide an estimate for removing\npopcorn in the upper hallway before\nthe rest of the work is done?\n\nThanks,\nAlex'],'Hallway'),'Could you provide an estimate for removing popcorn in the upper hallway before the rest of the work is done?');
 assert.equal(substantiveSnippet(["There is a bathroom we don't need to do anything with.\n\nWe need a bedroom with an egress window."],'Basement details'),'We need a bedroom with an egress window.');
 for(const footer of ['Something wrong with the email?',"If you have questions about this, please reply.","Please don’t reply to this email.",'If you have any questions, please contact us.']) assert.equal(substantiveSnippet([footer],'Payment received'),'Payment received');
});

test('files enforce a combined 20 MB cap, safe filenames and allowed types',async()=>{
 const {validateMailFiles,MAX_MAIL_BYTES}=await import('../lib/inbox-files.ts');
 validateMailFiles([{name:'plan.pdf',type:'application/pdf',size:MAX_MAIL_BYTES}]);
 assert.throws(()=>validateMailFiles([{name:'plan.pdf',type:'application/pdf',size:MAX_MAIL_BYTES},{name:'photo.jpg',type:'image/jpeg',size:1}]),/20 MB/);
 for(const file of [{name:'run.exe',type:'application/octet-stream',size:1},{name:'plan.pdf',type:'text/html',size:1},{name:'bad\r\n.pdf',type:'application/pdf',size:1}])assert.throws(()=>validateMailFiles([file]));
});

test('website continuity shows existing email before composing and contacted after a sent linked thread',async()=>{
 const {attachInquiryContinuity}=await import('../lib/inbox-continuity.ts');
 const form={id:'siteform:alex',channel:'site_form',linkedSlug:'alex',view:'needs_reply'};
 const email={id:'e',channel:'email',subject:'Basement',linkedType:'lead',linkedSlug:'alex'};
 const readers={'siteform:alex':{form:{email:'alex@example.test'}},e:{messages:[{fromEmail:'alex@example.test',body:['Scope']} ]}};
 attachInquiryContinuity([form,email],readers);assert.deepEqual(readers[form.id].form.conversations,[{id:'e',subject:'Basement'}]);assert.equal(readers.e.websiteInquiry,form.id);assert.equal(form.view,'needs_reply');
 readers.e.messages.push({outbound:true,fromEmail:'builder@example.test',to:'alex@example.test'});attachInquiryContinuity([form,email],readers);assert.equal(form.needsMeReason,'Contacted');assert.equal(form.view,'awaiting_them');
 const persisted={id:'siteform:older',channel:'site_form',view:'needs_reply'};const older={form:{email:'old@example.test',contactedAt:'2026-11-01',conversations:[{id:'old-email',subject:'Email conversation'}]}};
 attachInquiryContinuity([persisted],{[persisted.id]:older});assert.equal(older.form.contacted,true);
});

test('sent completion survives reload and mailbox changes; completion-only retry never needs a send callback',async()=>{
 const {saveCompletion,readCompletions,completionKey,retryCompletion}=await import('../lib/inbox-completion.ts');
 const map=new Map();const store={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};const key=completionKey('Builder@example.test');
 const receipt={threadId:'mail',recipient:'alex@example.test',channel:'email',sentAt:1000,through:900};saveCompletion(store,key,receipt);
 assert.deepEqual(readCompletions(store,key),[receipt]);assert.deepEqual(readCompletions(store,completionKey('staff@example.test')),[]);
 let finishes=0;const reloaded=readCompletions(store,key)[0];
 assert.equal((await retryCompletion(store,key,reloaded,async()=>{finishes++;return {ok:false}})).ok,false);assert.equal(readCompletions(store,key).length,1);
 assert.equal((await retryCompletion(store,key,reloaded,async()=>{finishes++;return {ok:true}})).ok,true);assert.equal(readCompletions(store,key).length,0);assert.equal(finishes,2);
});

test('mixed embedded and remote srcsets retain embedded fallbacks and count remote candidates',()=>{
 const result=applyRemoteImagePolicy('<img src="data:image/png;base64,AAAA" srcset="data:image/png;base64,BBBB 1x, https://track.test/image 2x"><source srcset="cid:wide 1x, /remote.png 2x">',false);
 assert.equal(result.blocked,2);assert.match(result.html,/src="data:image/);assert.match(result.html,/BBBB 1x/);assert.match(result.html,/cid:wide/);assert.doesNotMatch(result.html,/track.test|remote.png/);
});

test('default dock layout keeps a 440px reader and falls back to a sheet below the budget',async()=>{
 const {contextLayout}=await import('../lib/inbox-experience.ts');
 assert.equal(contextLayout(964).docked,true);assert.equal(contextLayout(964).compact,true);assert.ok(964-240-280>=440);assert.equal(contextLayout(959).docked,false);
});

test('CSS escaped URL spelling is blocked without discarding padding',()=>{
 const result=applyRemoteImagePolicy(String.raw`<div style="padding:12px;background: u\72l(https://tracker.test/bg)">Keep</div>`,false);
 assert.equal(result.blocked,1);assert.doesNotMatch(result.html,/tracker.test/);assert.match(result.html,/padding:12px/);
});

test('background-only decorative boxes collapse along with blocked icons',()=>{
 const result=applyRemoteImagePolicy('<div style="width:600px;height:300px;background:url(https://track.test/logo)"></div><table><tr><td background="https://track.test/icon" width="100" height="100"></td></tr></table>',false);
 assert.equal(result.blocked,2);assert.equal(result.html,'');
});
