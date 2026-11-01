import {test} from 'node:test';
import assert from 'node:assert/strict';
import {askExcerpt, reflowPlainText, draftRecipientName} from '../lib/inbox-review.ts';

// Unseen invented mail only. No providers, models, or database modules.
test('hard-wrapped prose reflows without merging paragraphs, lists, quotes or signatures',()=>{
 const mail='Hello Avery,\n\nWe would like to replace the railing along the rear terrace\nand keep the existing posts if they are sound.\n\nPlease include these alternatives:\n- Painted steel\n- Unfinished cedar\n\n> The previous contractor recommended waiting\n> until spring.\n\nThanks,\nMorgan Ellis\nSite coordinator\n(555) 010-2233';
 const result=reflowPlainText(mail);
 assert.match(result,/rear terrace and keep/);
 assert.match(result,/sound\.\n\nPlease/);
 assert.match(result,/- Painted steel\n- Unfinished cedar/);
 assert.match(result,/> The previous contractor recommended waiting\n> until spring\./);
 assert.match(result,/Thanks,\nMorgan Ellis\nSite coordinator\n\(555\)/);
 assert.equal(reflowPlainText('Measurements\nWidth: 36 inches\nHeight: 80 inches\n\n-- \nAvery\navery@example.test'),'Measurements\nWidth: 36 inches\nHeight: 80 inches\n\n-- \nAvery\navery@example.test');
});
test('request excerpt ends at a sentence boundary even when a single request exceeds the budget',()=>{
 const request=`Could you review ${'the proposed storage arrangement '.repeat(28)}before we choose the hardware?`;
 const excerpt=askExcerpt([`Hello Builder,\n\n${request}\n\nThanks,\nMorgan`],'Storage');
 assert.equal(excerpt,request);
 assert.match(excerpt,/hardware\?$/);
});
test('recipient name is truthful after editing To and never repeats a stale reply-target name',()=>{
 const target={toName:'Avery Chen',toEmail:'avery@example.test'};
 assert.equal(draftRecipientName('avery@example.test',target),'Avery Chen');
 assert.equal(draftRecipientName('dispatch@example.test',target),'dispatch@example.test');
 assert.equal(draftRecipientName('',target),'Choose recipient');
});

test('unseen sent-only mail stays out of Other, including automated flags and explicit filing',async()=>{
 const {matchesInboxTab,tabCounts}=await import('../lib/inbox-experience.ts');
 const sent={id:'sent-archive',fromName:'Owner',subject:'Tool reservation',channel:'email',inboundLast:false,view:'done',automated:true,filedOther:true};
 assert.equal(matchesInboxTab(sent,'other'),false);
 assert.equal(tabCounts([sent]).other,0);
 assert.equal(matchesInboxTab({...sent,inboundLast:true},'other'),true);
});

test('task presets show the actual Central date and time across DST for unfamiliar work',async()=>{
 const {reminderPresetLabel,reminderCommitLabel}=await import('../lib/inbox-experience.ts');
 const now=new Date('2026-10-31T18:00:00Z');
 assert.equal(reminderPresetLabel('tomorrow',now),'Tomorrow · Sun Nov 1 · 8:00 AM');
 assert.equal(reminderPresetLabel('today',now),'Later today · Sat Oct 31 · 3:00 PM');
 assert.equal(reminderCommitLabel('tomorrow',now),'Remind me Tomorrow 8 AM');
 assert.equal(reminderPresetLabel('pick',now,'2026-11-04'),'Wed Nov 4 · 8:00 AM');
});
