import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeEntities, cleanEmailText, htmlToEmailText, loadEmailHtml, MAX_HTML_RETRIES} from '../lib/inbox-email-content.ts';
import {readableEmailHtml} from '../lib/inbox-email-html.ts';
import {askExcerpt, rowActionTitle} from '../lib/inbox-review.ts';
import {contextStripText, humanLeadSource, attentionGroup, orderedAttentionThreads} from '../lib/inbox-experience.ts';

// Entirely invented mail. No credentials, providers, network, or database imports.
const comparison='<p>Harbor &mdash; it&rsquo;s &ldquo;simple&rdquo; &#8212; &#x1F6E0;</p><table><thead><tr><th>Existing plan</th><th>New plan</th><th>Difference</th></tr></thead><tbody><tr><td>$720</td><td>$610</td><td>$110</td></tr><tr><td>12 months</td><td>10 months</td><td>2 months</td></tr></tbody></table>';
test('one entity decoder handles named, decimal and hex without stripping literal text',()=>{
 assert.equal(decodeEntities('A &mdash; B &rsquo; &ldquo;C&rdquo; &#169; &#x1F6E0; &eacute; <literal>'),'A — B ’ “C” © 🛠 é <literal>');
 assert.equal(cleanEmailText('Plan &amp; scope\n\n[image: diagram]\n\n\nPlease review. [image: image]'),'Plan & scope\n\nPlease review.');
});
test('HTML fallback preserves labeled comparison columns and decoded punctuation',()=>{
 const text=htmlToEmailText(comparison);
 assert.match(text,/Harbor — it’s “simple” — 🛠/);
 assert.match(text,/Existing plan: \$720.*New plan: \$610.*Difference: \$110/);
 assert.match(text,/Existing plan: 12 months.*New plan: 10 months.*Difference: 2 months/);
 assert.doesNotMatch(text,/planNew|720610|&(?:mdash|rsquo);/);
 const readable=readableEmailHtml(comparison);assert.match(readable,/<th scope="col"[^>]*>Existing plan/);assert.match(readable,/<td[^>]*>\$610/);
});
test('HTML results distinguish no part, failed fetch and empty formatted content; retry is manual and bounded',async()=>{
 assert.deepEqual(await loadEmailHtml(async()=>''),{status:'text-only',html:''});
 assert.deepEqual(await loadEmailHtml(async()=>'<p>Details</p>'),{status:'formatted',html:'<p>Details</p>'});
 assert.equal((await loadEmailHtml(async()=>'<div> </div>')).status,'failed');
 assert.equal((await loadEmailHtml(async()=>{throw Error('offline')})).status,'failed');
 assert.equal(MAX_HTML_RETRIES,2);
});
test('text paths remove image tokens and preserve compact source links without blank holes',()=>{
 assert.equal(askExcerpt(['Hello Builder,\n\nSee the survey:\n\nhttps://maps.example.test/parcels/42\n\n\nCould you quote a retaining wall?\n\nThanks,\nRobin']),'Could you quote a retaining wall?\n\nlink · maps.example.test');
 const title=rowActionTitle({fromName:'Robin',subject:'Re: Retaining wall',preview:'Robin: …And provide a quote for the north boundary.'});
 assert.equal(title,'Asks: Provide a quote for the north boundary.');
 assert.equal(rowActionTitle({fromName:'Robin',subject:'Retaining wall',preview:'…and the boundary'}),'Retaining wall');
 assert.equal(askExcerpt(['Could you review &ldquo;option B&rdquo;? [image: map]']),'Could you review “option B”?');
});
test('lead strips expose human provenance while technical identifiers stay out',()=>{
 const source='Website lead notification / Gmail thread abcde1234567890';
 assert.equal(humanLeadSource(source),'Website form');
 assert.equal(humanLeadSource('Referral / CRM id 8d0810f2-1800-4dad-a186-879e6cb021b2'),'Referral');
 assert.equal(humanLeadSource('abcde1234567890'),'');
 const strip=contextStripText({fromName:'Robin',contactRole:'lead'},{job:{name:'Robin',kind:'lead',stage:'intake',scope:'Retaining wall',source,createdAt:'2026-10-24T14:00:00Z'}});
 assert.equal(strip,'Lead · Retaining wall · Website form Oct 24 · New inquiry');
});
test('attention groups stay contiguous, with newer dates inside each group',()=>{
 const t=(id,patch={})=>({id,channel:'email',fromName:'Person',subject:'Plans',view:'needs_reply',inboundLast:true,receivedAt:1,...patch});
 const threads=[t('newest',{receivedAt:20}),t('draft-old'),t('alert',{automated:true,attentionRequired:true,inInbox:true}),t('draft-new',{receivedAt:10}),t('waiting',{view:'awaiting_them',inboundLast:false})];
 const drafts=new Set(['draft-old','draft-new']);
 assert.equal(attentionGroup(threads[1],drafts),'Draft ready');
 assert.equal(attentionGroup(threads[2],drafts),'Needs attention');
 assert.deepEqual(orderedAttentionThreads(threads,drafts).map(t=>t.id),['draft-new','draft-old','alert','newest','waiting']);
});
