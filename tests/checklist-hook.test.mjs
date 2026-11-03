import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const settle=()=>new Promise(r=>setTimeout(r,10));
// Hook host executes the real hook and its effects, with controlled browser and action boundaries.
function host(disk,auth={user:'A'}) {
 const slots=[],effects=[];let cursor=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
 const react={useState:init=>{const i=cursor++;slots[i]??={v:typeof init==='function'?init():init};return [slots[i].v,v=>{slots[i].v=typeof v==='function'?v(slots[i].v):v;}];},useRef:init=>{const i=cursor++;return slots[i]??={current:init};},useCallback:(fn,deps)=>{const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={fn,deps};return slots[i].fn;},useEffect:(fn,deps)=>{const i=cursor++;if(!same(slots[i]?.deps,deps)){slots[i]?.clean?.();slots[i]={deps};effects.push(()=>{slots[i].clean=fn();});}}};
 const snapshot={session:{id:'s',revision:0,manual_notes:'',deletion_epoch:0},rows:[]};
 const store={load:async()=>disk.entry,save:async(_id,entry)=>{disk.entry=structuredClone(entry);},remove:async()=>{disk.entry=null;},close(){}};
 const stubs={react,'./useClock':{useBrowserOnline:()=>true},'./signed-in':{signedInUser:()=>null,SIGNED_IN_KEY:'auth',markSignedIn(){}},'@/components/panel/panelBus':{subscribePanelBus:()=>()=>{}},'@/lib/checklist-coverage/manual':{},'@/lib/checklist-coverage/contract':{},'@/lib/checklist-coverage/client-queue':require('../lib/checklist-coverage/client-queue.ts'),'@/lib/checklist-coverage/action-result':require('../lib/checklist-coverage/action-result.ts'),'@/lib/checklist-coverage/offline-store':{openPendingStore:async()=>store,clearAllPending:async()=>{disk.entry=null;}},'@/lib/actions/discovery-checklist':{validateChecklistIdentity:async id=>auth.user===id?{ok:true}:{ok:false,code:'CHECKLIST_USER_CHANGED'},loadChecklist:async()=>structuredClone(snapshot),saveChecklistNotes:async(op,id)=>{if(id!==auth.user)return {ok:false,code:'CHECKLIST_USER_CHANGED'};snapshot.session.revision++;snapshot.session.manual_notes=op.notes;return {ok:true,revision:snapshot.session.revision,session_id:'s'};}}};
 const exports={};const window=new EventTarget();
 const source=ts.transpileModule(readFileSync(new URL('../components/calls/checklist/useChecklistSync.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(source,{exports,require:s=>stubs[s],window,navigator:{onLine:true},indexedDB:{},crypto,Error,setTimeout,clearTimeout,setInterval,clearInterval});
 return {render(){cursor=0;const value=exports.useChecklistSync('s','A');for(const e of effects.splice(0))e();return value;},close(){for(const slot of slots)slot?.clean?.();},logout(){window.dispatchEvent(new Event('sjcos-checklist-logout'));}};
}
test('reopen → edit → acknowledge → reload preserves undecided recovery, then explicit Send now sends',async()=>{
 const original={user_id:'A',created_at:Date.now(),operations:[{kind:'notes',op:{session_id:'s',notes:'recovered private note',expected_revision:0,operation_id:crypto.randomUUID()},base_notes:'',sent:false,queued_at:Date.now()}]};
 const disk={entry:structuredClone(original)};let h=host(disk);h.render();await settle();let sync=h.render();assert.equal(sync.recovered.length,1);
 sync.setNotes('new edit while recovery pending');await settle();sync=h.render();assert.equal(sync.queue.length,0);assert.deepEqual(disk.entry,original);
 h.close();h=host(disk);h.render();await settle();sync=h.render();assert.equal(sync.recovered[0].op.notes,'recovered private note');
 sync.sendRecovered();await settle();sync=h.render();assert.equal(sync.queue.length,0);assert.equal(disk.entry,null);h.close();
});
test('denied localStorage still revalidates auth, hides content and clears pending data on account switch/logout',async()=>{
 const disk={entry:null},auth={user:'A'};const h=host(disk,auth);h.render();await settle();let sync=h.render();assert.ok(sync.snapshot);
 auth.user='B';sync.setNotes('private A note');await settle();sync=h.render();assert.equal(sync.snapshot,null);assert.equal(sync.queue.length,0);assert.equal(sync.recovered,null);assert.equal(disk.entry,null);assert.equal(sync.problem.kind,'user_switch');h.close();
 const loggedOut=host({entry:null});loggedOut.render();await settle();loggedOut.logout();assert.equal(loggedOut.render().snapshot,null);loggedOut.close();
});
