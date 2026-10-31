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
