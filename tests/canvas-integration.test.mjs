import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
const root=new URL('../',import.meta.url);
registerHooks({resolve(s,c,n){if(s.startsWith('@/')||s.startsWith('.')){const u=s.startsWith('@/')?new URL(s.slice(2),root):new URL(s,c.parentURL);for(const ext of ['','.ts','.tsx'])if(existsSync(new URL(u.href+ext))&&statSync(new URL(u.href+ext)).isFile())return {url:u.href+ext,shortCircuit:true};}return n(s,c);},load(u,c,n){if(/\.(ts|tsx)$/.test(u))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return n(u,c);}});
const {mobileCanvasFallback,appendCanvasLines}=await import('../lib/mobile-rpc/canvas-fallback.ts');
const {groupCanvasEvents,canvasTranscript}=await import('../components/panel/canvas/state.ts');
const {drainCanvasPages}=await import('../components/panel/canvas/run-events.ts');
const availability={revision:'a',master:true,diagrams:true,pages:false,floor:false,exports:false,staff:true,source:true};
const event=(id='1',n=1,run='r',canvas='c')=>({id,thread_id:'t',run_id:run,actor_user_id:'u',at:`2026-11-05T12:00:0${id.length}Z`,group_id:run?`run:${run}:canvas:${canvas}`:`event:${id}`,kind:'created',canvas_id:canvas,version:{version:n,title:'Permit steps',summary:'private summary',change_note:'',actor:{id:'u',name:'Joe'},run_id:run,created_at:'2026-11-05T12:00:00Z',restored_from_version:null,design:null}});
const page=(events,extra={})=>({events,cursor:'forward',next_before:null,has_more:false,availability,...extra});
test('native fallback exact plain line',()=>assert.equal(mobileCanvasFallback(page([event()]))[0].line,'Canvas: Permit steps · Version 1 — open it in the web app.'));
test('Safari action has only authenticated wrapper URL',()=>assert.deepEqual(mobileCanvasFallback(page([event()]))[0].action,{label:'Open in Safari',href:'/panel/canvas/c?v=1'}));
test('native dedupes replayed event',()=>assert.equal(mobileCanvasFallback(page([event(),event()])).length,1));
test('native highest version per run',()=>assert.equal(mobileCanvasFallback(page([event(),event('2',2)]))[0].version,2));
test('same canvas in two runs remains separate',()=>assert.equal(mobileCanvasFallback(page([event(),event('2',2,'other')])).length,2));
test('human restoration has own fallback',()=>assert.equal(mobileCanvasFallback(page([event(),{...event('2',2,null),kind:'restored'}])).length,2));
for(const kind of ['unavailable','deleted','rejected'])test(`${kind} exposes no stale native title`,()=>assert.deepEqual(mobileCanvasFallback(page([{...event(),kind}])),[]));
test('master off suppresses native titles',()=>assert.deepEqual(mobileCanvasFallback(page([event()],{availability:{...availability,master:false}})),[]));
test('missing optional page leaves reply alone',()=>assert.equal(appendCanvasLines('Reply',mobileCanvasFallback()),'Reply'));
test('append is idempotent and does not mutate transcript',()=>{const original='Reply',cards=mobileCanvasFallback(page([event()]));const once=appendCanvasLines(original,cards);assert.equal(appendCanvasLines(once,cards),once);assert.equal(original,'Reply');});
test('no reply still gets fallback',()=>assert.match(appendCanvasLines('',mobileCanvasFallback(page([event()]))),/^Canvas:/));
test('delete redacts earlier native groups',()=>assert.equal(mobileCanvasFallback(page([event(),{...event('2'),kind:'deleted'}])).length,0));
test('no source summary or actor enters fallback',()=>assert.doesNotMatch(JSON.stringify(mobileCanvasFallback(page([{...event(),source:'secret'}]))),/secret|private summary|Joe|token/));
test('crashed no-reply run remains standalone',()=>assert.equal(canvasTranscript([],groupCanvasEvents([event()]))[0].kind,'canvas'));
test('live final error replay produces one card',()=>assert.equal(groupCanvasEvents([event(),event(),event()]).length,1));
test('terminal drain reads beyond twenty events and byte-limited pages',async()=>{const events=Array.from({length:47},(_,i)=>event(String(i+1),i+1));const pages=[page(events.slice(0,20),{cursor:'a',has_more:true}),page(events.slice(20,24),{cursor:'b',has_more:true}),page(events.slice(24,44),{cursor:'c',has_more:true}),page(events.slice(44),{cursor:'d'})],seen=[],received=[];await drainCanvasPages(pages.shift(),async after=>{seen.push(after);return pages.shift();},p=>received.push(...p.events),()=>true);assert.deepEqual(seen,['a','b','c']);assert.equal(received.length,47);assert.equal(groupCanvasEvents(received)[0].version.version,47);});
test('newest page backward has_more still drains forward once',async()=>{const seen=[];await drainCanvasPages(page([event()],{has_more:true}),async after=>{seen.push(after);return page([]);},()=>{},()=>true);assert.deepEqual(seen,['forward']);});
test('thread switch cancels terminal page application',async()=>{let alive=true;const seen=[];await drainCanvasPages(page([event()]),async()=>{alive=false;return page([event('2')]);},p=>seen.push(p),()=>alive);assert.equal(seen.length,1);});
test('availability-only response is delivered',async()=>{const seen=[];await drainCanvasPages(page([]),async()=>page([],{availability:{...availability,master:false}}),p=>seen.push(p.availability.master),()=>true);assert.deepEqual(seen,[true,false]);});
test('non-advancing has_more refuses infinite drain',async()=>{await assert.rejects(drainCanvasPages(page([]),async()=>page([],{has_more:true}),()=>{},()=>true),/cursor/i);});

// Execute the real server adapters with only their existing auth/run/command seams
// replaced. No database or model process is started by this file.
const fixture={poll:{ok:true,status:'running'},conversation:{ok:true,conversation:{id:'t',messages:[]}},run:{conversationId:'t'},calls:[],page:page([])};
globalThis.__canvasIntegration=fixture;
const mocks={
 '@/lib/actions/dev-agents':`export async function pollAgentRun(id){globalThis.__canvasIntegration.calls.push(['poll',id]);return globalThis.__canvasIntegration.poll;}`,
 '@/lib/actions/ai-chat':`export async function loadConversationAction(id){return globalThis.__canvasIntegration.conversation;}`,
 '@/lib/dev-agents':`export async function getDevAgentRun(id){return globalThis.__canvasIntegration.run;}`,
 '@/lib/ask-canvases':`export async function canvasEvents(id,input){const f=globalThis.__canvasIntegration;f.calls.push(['events',id,input]);if(f.error)throw f.error;return f.page;}`,
 '@/lib/thread-access':`export async function askBoundary(fn){try{return await fn();}catch{return {ok:false,code:'THREAD_UNAVAILABLE'};}}`,
};
registerHooks({resolve(s,c,n){if(s in mocks)return {url:'canvas-test:'+encodeURIComponent(s),shortCircuit:true};return n(s,c);},load(u,c,n){if(u.startsWith('canvas-test:'))return {format:'module',shortCircuit:true,source:mocks[decodeURIComponent(u.slice(12))]};return n(u,c);}});
const actions=await import('../components/panel/canvas/run-actions.ts');
function reset(){process.env.SJC_CANVAS_ENABLED='1';fixture.calls=[];fixture.poll={ok:true,status:'running'};fixture.run={conversationId:'t'};fixture.error=null;fixture.page=page([event()]);}
for(const status of ['pending','running','done','error'])test(`actual ${status} adapter carries canonical page`,async()=>{reset();fixture.poll=status==='error'?{ok:false,error:'stopped'}:{ok:true,status};const result=await actions.pollAgentRunWithCanvas('r');assert.equal(result.canvas_changes,fixture.page);assert.deepEqual(fixture.calls.at(-1),['events','t',{limit:20}]);});
test('actual adapter passes opaque forward cursor without decoding',async()=>{reset();await actions.pollAgentRunWithCanvas('r','signed.cursor');assert.equal(fixture.calls.at(-1)[2].after,'signed.cursor');});
test('off preserves poll envelope and never reads canvas command',async()=>{reset();process.env.SJC_CANVAS_ENABLED='0';const result=await actions.pollAgentRunWithCanvas('r');assert.equal(result,fixture.poll);assert.deepEqual(fixture.calls,[['poll','r']]);});
test('off preserves conversation envelope',async()=>{reset();process.env.SJC_CANVAS_ENABLED='0';assert.equal(await actions.loadConversationWithCanvas('t'),fixture.conversation);assert.deepEqual(fixture.calls,[]);});
test('reload with no assistant still carries committed canvas',async()=>{reset();const result=await actions.loadConversationWithCanvas('t');assert.deepEqual(result.conversation.messages,[]);assert.equal(result.canvas_changes.events.length,1);});
test('auth failure never reads canvas command',async()=>{reset();fixture.poll={ok:false,code:'SIGN_IN_AGAIN'};assert.equal(await actions.pollAgentRunWithCanvas('r'),fixture.poll);assert.equal(fixture.calls.length,1);});
test('canonical read failure fails closed without private metadata',async()=>{reset();fixture.error=Error('private SQL');const result=await actions.pollAgentRunWithCanvas('r');assert.deepEqual(result,{ok:false,code:'THREAD_UNAVAILABLE'});});
test('empty metadata-only poll keeps effective availability',async()=>{reset();fixture.page=page([],{availability:{...availability,source:false}});const result=await actions.pollAgentRunWithCanvas('r');assert.equal(result.canvas_changes.availability.source,false);});
