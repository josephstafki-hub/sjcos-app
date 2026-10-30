import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {runInNewContext} from "node:vm";
const require=createRequire(import.meta.url);
const ts=require("typescript");

async function submit(result, thrown=false) {
  const states=[];const pending=[];let refreshed=0;
  const exports={};
  const source=ts.transpileModule(readFileSync(new URL("../components/settings/SettingsForm.tsx",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(source,{exports,FormData:class {},require(name){
    if(name==="react/jsx-runtime")return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
    if(name==="react")return {useRef:()=>({current:null}),useState:initial=>[initial,value=>states.push(value)],useTransition:()=>[false,fn=>pending.push(fn())]};
    if(name==="next/navigation")return {useRouter:()=>({refresh:()=>refreshed++})};
    if(name==="@/components/ui")return {Button:()=>null};
    if(name==="@/lib/run-action")return {runAction:async(fn,opts)=>{try {const r=await fn();if(r?.ok===false){opts.onError(r.error);return r;}opts.onSuccess(r);return r;} catch {opts.onError("Network error");return {ok:false};}}};
    throw new Error(name);
  }});
  const form=exports.SettingsForm({action:async()=>{if(thrown)throw new Error("Offline");return result;},children:null});
  form.props.onChange();states.length=0;
  form.props.onSubmit({preventDefault(){},currentTarget:{}});
  await Promise.all(pending);
  return {states,refreshed};
}

test("successful settings saves clear dirty state for void and object actions",async()=>{
  for(const result of [undefined,{ok:true}]) {
    const {states,refreshed}=await submit(result);
    assert.ok(states.includes(false));assert.ok(states.includes("Saved"));assert.equal(refreshed,1);
  }
});
test("failed settings saves retain edits and report the error",async()=>{
  for(const [result,thrown] of [[{ok:false,error:"Refused"},false],[undefined,true]]) {
    const {states,refreshed}=await submit(result,thrown);
    assert.ok(!states.includes(false));assert.ok(!states.includes("Saved"));assert.equal(refreshed,0);
    assert.ok(states.includes(thrown?"Network error":"Refused"));
  }
});
