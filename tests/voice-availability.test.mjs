import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
// Minimal effect/state scheduler: exercise the real hooks, shared module caches,
// effect dependencies, unmount cleanup and late network completions without a DOM.
function harness(file, name) {
 let current, calls = 0, pending = [];
 const react = {
  useState(initial) { const c=current; const i=c.cursor++; if (!(i in c.states)) c.states[i]=initial; return [c.states[i], v=>{c.states[i]=v;}]; },
  useEffect(effect,deps) { const c=current; const i=c.cursor++; const old=c.effects[i]; if (!old || deps.some((v,j)=>v!==old.deps[j])) {old?.cleanup?.(); c.effects[i]={deps,cleanup:effect()};} },
 };
 const exports={};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:s=>{assert.equal(s,'react');return react;},fetch:()=>{calls++;return new Promise((resolve,reject)=>pending.push({resolve,reject}));}});
 return {
  mount(){return {cursor:0,states:[],effects:[]};},
  render(c,options){current=c;c.cursor=0;return exports[name](options);},
  unmount(c){c.effects.forEach(e=>e.cleanup?.());},
  get calls(){return calls;},
  async reply(available,fail=false){const batch=pending;pending=[];for(const p of batch) fail?p.reject(Error('offline')):p.resolve({ok:true,json:async()=>({available,code:available?undefined:'ASK_PAUSED'})});for(let i=0;i<8;i++)await Promise.resolve();},
 };
}
for(const [file,name] of [['lib/use-voice-available.ts','useVoiceAvailable'],['lib/use-tts-available.ts','useTtsAvailable']]) {
 test(`${name}: legacy callers share one cached result across mounts`,async()=>{const h=harness(file,name),a=h.mount(),b=h.mount();assert.equal(h.render(a),null);h.render(b);assert.equal(h.calls,1);await h.reply(false);assert.equal(h.render(a),false);h.unmount(a);assert.equal(h.render(h.mount()),null);assert.equal(h.calls,1);});
 test(`${name}: disabled mounts and generation changes make no request`,async()=>{const h=harness(file,name),a=h.mount();assert.equal(h.render(a,{enabled:false,generation:0}),false);h.render(a,{enabled:false,generation:1});assert.equal(h.calls,0);h.render(a,{enabled:true,generation:1});assert.equal(h.calls,1);await h.reply(true);assert.equal(h.render(a,{enabled:true,generation:1}),true);assert.equal(h.render(a,{enabled:false,generation:1}),false);assert.equal(h.calls,1);});
 for(const failed of [false,true]) test(`${name}: ${failed?'network failure':'paused 200'} recovers once per generation for mounted consumers`,async()=>{const h=harness(file,name),a=h.mount(),b=h.mount();const opt={enabled:true,generation:0};h.render(a,opt);h.render(b,opt);await h.reply(false,failed);assert.equal(h.render(a,opt),false);const next={enabled:true,generation:1};assert.equal(h.render(a,next),null);h.render(b,next);assert.equal(h.calls,2);await h.reply(true);assert.equal(h.render(a,next),true);assert.equal(h.render(b,next),true);h.render(h.mount(),next);assert.equal(h.calls,2);});
 test(`${name}: stale response cannot replace the recovered generation`,async()=>{const h=harness(file,name),a=h.mount();h.render(a,{enabled:true,generation:0});h.render(a,{enabled:false,generation:1});await h.reply(true);assert.equal(h.render(a,{enabled:false,generation:1}),false);h.render(a,{enabled:true,generation:1});assert.equal(h.calls,2);await h.reply(false);assert.equal(h.render(a,{enabled:true,generation:1}),false);});
}

test('dictation forwards the optional availability to the shared STT hook',()=>{
 const availability={enabled:false,generation:3};let forwarded;
 const exports={};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/use-dictation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:s=>s==='react'?{useEffect(){},useRef:v=>({current:v}),useState:v=>[v,()=>{}]}:{useVoiceAvailable:v=>{forwarded=v;return false;}}});
 assert.equal(exports.useDictation({onText(){},availability}).supported,false);assert.equal(forwarded,availability);
});
test('voice rounds forward availability to STT, TTS and internal dictation',()=>{
 const availability={enabled:false,generation:3},forwarded=[];
 const exports={};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/use-voice-round.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:s=>s==='react'?{useEffect(){},useRef:v=>({current:v}),useState:v=>[v,()=>{}]}:s.endsWith('use-dictation')?{useDictation:v=>{forwarded.push(v.availability);return {state:'idle'};}}:s.endsWith('use-voice-available')?{useVoiceAvailable:v=>{forwarded.push(v);return false;}}:{useTtsAvailable:v=>{forwarded.push(v);return false;}}});
 assert.equal(exports.useVoiceRound({send(){},availability}).supported,false);assert.equal(forwarded.length,3);for(const value of forwarded)assert.equal(value,availability);
});
