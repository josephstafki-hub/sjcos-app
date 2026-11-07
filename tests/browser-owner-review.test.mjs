import test from 'node:test';import assert from 'node:assert/strict';
import {browserRenderHarness,browserLandscapeRows} from './fixtures/ask-pane-host.mjs';
const render=await browserRenderHarness();const {BrowserOwnerView}=await import('../components/panel/BrowserOwnerLayer.tsx');
const {browserCopy}=await import('../components/panel/browser/model.ts');const {BrowserView}=await import('../components/panel/BrowserView.tsx');
const base={state:'working',origin:'city.example',phone:false,ownerName:'Joe',personName:'Abigail',width:360,ownerView:true,privatePage:true,privateConsented:false};
const view=(p={})=>render(BrowserOwnerView,{model:{...base,...p},onAction(){}});
test('C21 Watch never renders private pixels before explicit Show the page',()=>{const html=view({frameUrl:'data:image/jpeg;base64,secret'});assert.match(html,/Abigail took over. The agent can't see this page./);assert.match(html,/Show the page/);assert.doesNotMatch(html,/<img|Operator|role="tab"/);});
test('C22 private joined Watch labels human viewers without granting control',()=>{const html=view({privateConsented:true,privateViewStatus:'authorized',frameUrl:'data:image/jpeg;base64,/9j/'});assert.match(html,/Private — only you and Abigail see this page./);assert.match(html,/<img/);assert.doesNotMatch(html,/You're in control/);});
test('C23 owner view at 360/820/1180/1280 has one Back header and no staff chat',()=>{for(const width of [360,820,1180,1280]){const html=view({width});assert.equal((html.match(/data-owner-header/g)||[]).length,1);assert.doesNotMatch(html,/Operator|Message…|role="tablist"/);}});
test('C24 owner pause confirm names people and success follows ACK model only',()=>{assert.match(view({dialog:'pause_owner'}),/Pause Abigail's agent\? Abigail will need to tap Continue./);assert.doesNotMatch(view({dialog:'pause_owner'}),/Agent paused. Abigail can tap Continue./);assert.match(view({ownerPaused:true}),/Agent paused. Abigail can tap Continue./);});
test('C25 passive Watch exit offers Back; no approval or send action in Phase 1',()=>{assert.match(view(),/‹ Back/);for(const state of ['final_blocked','write_blocked'])assert.doesNotMatch(view({state}),/Submit once|Pay .* once|Send once|Take over from/);});
test('C26 all runtime named staff/owner copies avoid gendered third-person pronouns',()=>{for(const personName of ['Abigail','Mark','Sam'])for(const ownerName of ['Joe','Alex','Taylor'])for(const p of [{},{privateConsented:true,privateViewStatus:'authorized'},{privateConsented:true,privateViewStatus:'pending_audit'},{privateConsented:true,privateViewStatus:'required'},{dialog:'pause_owner'},{ownerPaused:true},...Object.keys(browserCopy).map(state=>({state}))])for(const html of [view({...p,personName,ownerName}),render(BrowserView,{model:{...base,...p,ownerView:false,personName,ownerName},slot:'all',onAction(){}})])assert.doesNotMatch(html.replace(/<[^>]+>/g,' '),/\b(?:he|she|his|her|him|hers|himself|herself|he's|she's|he’s|she’s)\b/i);});
test('C27 all owner landscape rows have no strip and the same safe-area budget',()=>{for(const row of browserLandscapeRows.filter(x=>x.name.startsWith('owner'))){assert.equal(row.strip,0);assert.equal(row.stage,204);assert.match(view({landscape:true,width:800}),/128px/);}});
test('C2 runtime configured owner control uses name without guessed pronouns',()=>{for(const ownerName of ['Alex','Taylor']){const html=render(BrowserView,{model:{...base,ownerView:false,privatePage:false,state:'other_device',controller:'owner',ownerName},slot:'all',onAction(){}});assert.match(html,new RegExp(ownerName+' is in control\\.'));assert.doesNotMatch(html,/your other device/);}});

test('R1 private Watch audit wait renders honest placeholder and zero stale pixels',()=>{
 const html=view({privateConsented:true,privateViewStatus:'pending_audit',frameUrl:'data:image/jpeg;base64,old'});assert.match(html,/Waiting to show the private page/);assert.doesNotMatch(html,/<img|Private — only you|>Show the page</);
});
test('R1 invalidated Watch consent renders Show the page even with old local consent/image',()=>{
 for(const width of [360,800,1280]){const html=view({width,privateConsented:true,privateViewStatus:'required',frameUrl:'data:image/jpeg;base64,old'});assert.match(html,/Abigail took over. The agent can't see this page./);assert.match(html,/>Show the page</);assert.doesNotMatch(html,/<img|Private — only you/);}
});

test('R1 private Watch with no server audit signal remains hidden despite local consent',()=>{
 for(const privateViewStatus of [undefined,null,'unavailable']){const html=view({privateConsented:true,privateViewStatus,frameUrl:'data:image/jpeg;base64,old'});assert.doesNotMatch(html,/<img|Private — only you/);assert.match(html,/>Show the page</);}
});

test('R2 4/6/9 Watch has one state line with trusted site and job, no duplicate pane',()=>{for(const width of [360,800,820,1180,1280]){const html=view({width,privatePage:false,projectLabel:'Larson bath'}),text=html.replace(/<[^>]+>/g,' ');assert.equal(text.split('Agent is working').length-1,1);assert.match(html,/city.example/);assert.match(html,/Larson bath/);assert.doesNotMatch(html,/Watch the page. The agent stays/);}});
test('R2 7 owner pause branch names staff, staff branch names owner',()=>{assert.match(view({state:'owner_paused',privatePage:false}),/Agent paused. Abigail can tap Continue./);assert.match(render(BrowserView,{model:{...base,ownerView:false,privatePage:false,state:'owner_paused',ownerName:'Taylor'},slot:'all',onAction(){}}),/Taylor paused the agent./);});
test('R2 5/8/10 owner does not watch self, paused/private Watch offers no Pause agent or disabled Type it',()=>{for(const width of [360,800,1280]){const html=view({width,state:'paused_private',watchingOwner:true,availableControls:['pause'],answers:[{id:'a',label:'Address',value:'123 Main'}]});assert.doesNotMatch(html,/Joe is watching|>Pause agent<|>Type it</);assert.match(html,/Abigail's answers/);}});

test('R3 1 Watch portrait meta cannot consume image or private-wait height',()=>{
 for(const width of [360,820])for(const state of ['working','other_device']){
  const html=view({width,state,privateConsented:true,privateViewStatus:'authorized',frameUrl:'frame'});assert.match(html,/aspect-\[16\/10\] w-full max-h-full shrink-0/);
  const roots=[...html.matchAll(/<div[^>]*class="([^"]*)"[^>]*data-browser-state/g)].map(x=>x[1]);assert.ok(roots.length>=3);assert.doesNotMatch(roots[0],/\bh-full\b/);assert.match(roots[1],/\bh-full\b/);
  assert.match(view({width,state,privateViewStatus:'pending_audit'}),/Waiting to show the private page…/);
 }
 for(const slot of ['all','content','actions','title','meta']){const html=render(BrowserView,{model:base,slot,onAction(){}});assert.equal(/^<div[^>]*class="[^"]*\bh-full\b/.test(html),['all','content','actions'].includes(slot));}
});
test('R3 2 owner dialogs have only their own decisions at portrait split and landscape sizes',()=>{
 for(const width of [360,820,1280])for(const landscape of [false,true])for(const dialog of ['replace','fresh','pause_owner']){
  const html=view({width,landscape,dialog,privatePage:false,availableControls:['take_over','pause','fresh_browser'],frameUrl:'frame'});
  const label=dialog==='replace'?'Take over':dialog==='fresh'?'Open a fresh browser':'Pause agent';assert.equal((html.match(new RegExp('>'+label+'</button>','g'))??[]).length,1);assert.doesNotMatch(html,/>Zoom<|>Pause live view</);
 }
});
test('R3 10 owner header separates Back from the independently wrapping title',()=>{
 for(const width of [360,820,1280]){const html=view({width,projectLabel:'Maple Ave kitchen'});assert.match(html,/<header[^>]*gap-2/);assert.match(html,/<\/button><span[^>]*min-w-0[^>]*>Abigail's browser — Maple Ave kitchen<\/span>/);assert.doesNotMatch(html,/<span[^>]*> · Abigail/);}
});

test('R4 owner landscape dialog uses the full stage without an empty action column',()=>{
 for(const dialog of ['replace','fresh','pause_owner']){
  const html=view({landscape:true,width:800,dialog,privatePage:false});assert.doesNotMatch(html,/grid-template-columns:minmax\(0,1fr\) 128px|col-start-2 row-start-3/);assert.match(html,/grid-template-columns:minmax\(0,1fr\)/);
 }
 assert.match(view({landscape:true,width:800,privatePage:false}),/grid-template-columns:minmax\(0,1fr\) 128px/);
});
