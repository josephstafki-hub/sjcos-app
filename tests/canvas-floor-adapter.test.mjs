// Expectations FIRST: one pinned geometry source, no financial/opaque props,
// preview-only Designer; hide releases the renderer, latest never replaces pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyDoc} from '../lib/plan-doc.ts';
import {applyOps} from '../lib/plan-ops.ts';
import {floorPreviewProps, floorBoundaryId} from '../lib/canvas-floor-preview.ts';
const real = () => applyOps(emptyDoc(),[
 {op:'addRoomRect',p:{x:0,y:0},q:{x:156,y:132},name:'Kitchen'},
 {op:'placeItem',libraryKey:'base-SB36',at:{x:48,y:12}},
]);
const snapshot = () => ({id:'8',design_id:'7',number:5,source_rev:3,doc:real(),name:'Kitchen',rev:4,project_id:'project',project_slug:'kitchen',lead_slug:null});
test('real plan ops geometry survives filtered serialization; all inspector sources are absent',()=>{
 const p=floorPreviewProps(snapshot());
 assert.equal(p.design.doc.walls.length,4);assert.equal(p.design.doc.items.length,1);
 for(const k of ['catalog','costRuleKeys','estimateTargets','comments','files','versions'])assert.deepEqual(p[k],[]);
 assert.equal(p.readOnly,true);assert.equal(p.embeddedPreview,true);assert.equal(p.isOwner,false);
 assert.equal(p.design.id,7);assert.equal(p.design.rev,3);assert.equal(p.design.latestVersion.number,5);
});
// 25 fresh adversarial cases. Each states a concrete forbidden payload/input
// and expected outcome before the implementation is run.
for(const [i,id] of ['0','-1','01','1e2','1.2',' 7','7 ','+7','9007199254740992','9223372036854775808',7,NaN,null,{},'7/../../api','<svg>'].entries())
 test(`adversarial ${i+1}: boundary rejects ${String(id)}`,()=>assert.throws(()=>floorBoundaryId(id),/INVALID_INPUT/));
for(const [i,key] of ['price','priceCents','costItemId','estimate_id','supplierQuote','secret','money','nested','__proto__'].entries())
 test(`adversarial ${i+17}: arbitrary item prop ${key} never crosses preview boundary`,()=>{
  const s=snapshot();Object.defineProperty(s.doc.items[0].props,key,{value:{privateAmount:123456},enumerable:true});
  const p=floorPreviewProps(s);assert.ok(!JSON.stringify(p).includes('privateAmount'));
  assert.equal(p.design.doc.items[0].catalogId,null);
 });
test('assets and source metadata never authorize file requests or reveal related designs',()=>{
 const s=snapshot();s.doc.meta={createdFrom:{designId:98,versionId:99}};
 s.doc=applyOps(s.doc,[{op:'addPhoto',at:{x:10,y:10},fileId:'private-photo'}]);
 const p=floorPreviewProps(s);assert.deepEqual(p.design.doc.meta,{});assert.deepEqual(p.design.doc.photos,[]);assert.deepEqual(p.design.doc.underlays,[]);
});
test('embedded Designer has a dedicated preview return before all editing chrome',()=>{
 const src=readFileSync('components/floor/Designer.tsx','utf8');
 assert.match(src,/readOnly = props\.readOnly \|\| !!props\.embeddedPreview/);
 assert.match(src,/if \(props\.embeddedPreview\) return/);
 assert.match(src,/if \(props\.embeddedPreview\) return;[\s\S]*?const onKey/);
 const preview=src.slice(src.indexOf('if (props.embeddedPreview) return ('),src.indexOf('  return (',src.indexOf('if (props.embeddedPreview) return (')+10));
 assert.doesNotMatch(preview,/<(?:Inspector|TopBar|ActivityEmitter|ToolPalette|StatusBar)/);
 assert.match(preview,/100%/);assert.match(preview,/mode: "plan"/);assert.match(preview,/mode: "3d"/);
});
test('stage releases hidden renderer and pins key to snapshot, never current revision',()=>{
 const src=readFileSync('components/panel/canvas/floor/FloorCanvasStage.tsx','utf8');
 assert.match(src,/if \(!visible\) return null/);assert.match(src,/key=\{snapshotId\}/);
 const pane=readFileSync('components/panel/canvas/floor/FloorCanvasPane.tsx','utf8');
 assert.match(pane,/The floor plan changed/);assert.match(pane,/Load latest/);
 assert.doesNotMatch(src,/savePlan|publish|estimateTargets=/);
 assert.doesNotMatch(src,/<details|Floor plan options/);
 assert.match(pane,/Edit on a tablet or computer/);assert.match(pane,/min-\[640px\]/);
});

import ts from 'typescript';
import vm from 'node:vm';
function hookModule(file,imports){
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require:id=>{if(!(id in imports))throw Error('Unexpected import '+id);return imports[id];},setTimeout,clearTimeout,console,window:{addEventListener(){},removeEventListener(){}},navigator:{onLine:true},Date,Set,Map});return module.exports;
}
const hookReact={useState:init=>[typeof init==='function'?init():init,()=>{}],useRef:value=>({current:value}),useMemo:f=>f(),useCallback:f=>f,useEffect:()=>{}};
test('actual readOnly useDesigner handlers refuse apply/preview/save without any action call',async()=>{
 let writes=0;
 const {useDesigner}=hookModule('components/floor/useDesigner.ts',{
  react:hookReact,'@/lib/plan-doc':await import('../lib/plan-doc.ts'),'@/lib/plan-ops':await import('../lib/plan-ops.ts'),
  '@/lib/actions/plan-designs':{savePlanDesign:async()=>{writes++;throw Error('unexpected save');}},'@/components/ui/Toast':{toastError(){}}
 });
 const doc=real(),bytes=JSON.stringify(doc),d=useDesigner(7,doc,3,true);
 assert.equal(d.apply({op:'addNote',at:{x:0,y:0},text:'Forbidden'}),false);
 d.preview({op:'delete',ids:doc.walls.map(w=>w.id)});d.undo();d.redo();await d.saveNow();
 assert.equal(writes,0);assert.equal(JSON.stringify(d.doc),bytes);
});
