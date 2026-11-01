import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerInboxDraft,flushInboxDrafts,guardInboxNavigation} from '../lib/inbox-navigation.ts';

test('unseen pending mail is saved before navigation, with every open composer included',async()=>{
 const order=[];let release;const saved=new Promise(resolve=>release=resolve);
 const one=registerInboxDraft(async()=>{order.push('saving gate reply');await saved;order.push('saved gate reply');return true});
 const two=registerInboxDraft(async()=>{order.push('saved forward');return true});
 try{
  const navigation=guardInboxNavigation(()=>order.push('navigated'),()=>order.push('blocked'));
  await Promise.resolve();assert.equal(order.includes('navigated'),false);release();await navigation;
  assert.ok(order.indexOf('saved gate reply')<order.indexOf('navigated'));assert.ok(order.includes('saved forward'));
 }finally{one();two();}
});
test('conflict, offline save and an in-flight send block leaving instead of hiding the outcome',async()=>{
 let navigated=0,blocked=0;
 for(const flush of [async()=>false,async()=>{throw Error('offline')}]){
  const remove=registerInboxDraft(flush);
  try{await guardInboxNavigation(()=>navigated++,()=>blocked++);assert.equal(await flushInboxDrafts(),false);}finally{remove();}
 }
 assert.equal(navigated,0);assert.equal(blocked,2);assert.equal(await flushInboxDrafts(),true);
});

test('selected device files warn with the total count and can keep the draft open',async()=>{
 const {registerInboxFiles,confirmInboxFileLoss}=await import('../lib/inbox-navigation.ts');
 let count=2,seen='';const remove=registerInboxFiles(()=>count);
 try{
  assert.equal(confirmInboxFileLoss(message=>(seen=message,false)),false);assert.equal(seen,'2 files will be lost. Leave this draft?');
  assert.equal(confirmInboxFileLoss(()=>true),true);count=0;assert.equal(confirmInboxFileLoss(()=>{throw Error('Should not ask')}),true);
 }finally{remove();}
});
