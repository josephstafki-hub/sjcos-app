// Expectations: execute real floor pane slots/handlers without a browser.
// One supplied picker, design title, stable version/read-only metadata, title
// menu with canonical link/copy/delete, missing can_edit means Open, stacked
// landscape actions, authorized deletion links, and isolated raised scale bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
let state,patches,deleted,copied,selected;
const C='canvas';
function load(file,imports){const module={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,require:k=>{assert.ok(k in imports,k);return imports[k];},navigator:{clipboard:{writeText:async v=>{copied=v;}}},window:{location:{origin:'https://sjc.test'}},URL});return module.exports;}
const hooks={useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect(){},useSyncExternalStore:(_,get)=>get()};
const pane=load('components/panel/canvas/floor/FloorCanvasPane.tsx',{
 react:hooks,'react/jsx-runtime':jsx,'../../CanvasVersions':{CanvasVersions:'history'},'../CanvasOverlay':{CanvasOverlay:'overlay'},'./FloorCanvasStage':{FloorCanvasStage:'stage'},'../state':{canvasFetch(){}},
 '../store':{canvasState:()=>state,canvasServerState:()=>state,subscribeCanvas(){},patchCanvas:(id,p)=>{patches.push(p);state.views[id]={...state.views[id],...p};},selectCanvasVersion:(id,n)=>{selected=n;},askCanvasChange(){},updateCanvas(){},publishCanvases(){}}
}).FloorCanvasPane;
function fixture(overrides={}){patches=[];deleted=0;copied='';selected=null;state={views:{[C]:{}},items:[]};return {context:{signal:{aborted:false},landscape:false},slot:'title',picker:jsx.jsx('button',{children:'Actual design name ▾',
'aria-label':'Canvases in this chat'}),onDelete:()=>deleted++,data:{canvas:{id:C,latest_version:2},selected:{version:1,title:'Different canvas title',summary:'Summary',design:{number:7}},capabilities:{preview:true},floor:{props:{design:{name:'Actual design name'}},designId:'42',href:'/floor/42',number:7,changed:false}},...overrides};}
function nodes(el){if(!el||typeof el!=='object')return [];return [el,...[el.props?.children].flat(Infinity).flatMap(nodes)];}
function text(el){if(typeof el==='string'||typeof el==='number')return String(el);if(!el||typeof el!=='object')return '';return [el?.props?.children].flat(Infinity).map(text).join('');}
function find(el,label){const result=nodes(el).find(n=>n.type==='button'&&text(n)===label);assert.ok(result,label);return result;}
test('title uses design name and supplied picker once, never canvas title',()=>{const p=fixture(),el=pane(p),s=text(el);assert.match(s,/Actual design name/);assert.ok(!s.includes('Different canvas title'));assert.equal(nodes(el).filter(n=>n.props?.['aria-label']==='Canvases in this chat').length,1);find(el,'⋯').props.onClick();assert.equal(patches.at(-1).sheet,'menu');});
test('missing edit capability renders Open',()=>{assert.match(text(pane(fixture())),/Open floor plan ↗/);});
test('edit capability renders visible tablet/desktop Edit',()=>{const p=fixture();p.data.floor.can_edit=true;const el=pane(p),a=nodes(el).find(n=>n.type==='a');assert.equal(text(a),'Edit floor plan ↗');assert.match(a.props.className,/min-\[820px\]/);});
test('meta preserves entire design number and Read only independent of long name',()=>{assert.match(text(pane({...fixture(),slot:'meta'})),/^Floor plan · v7 · Read only/);});
test('changed notice lives in existing meta row',()=>{const p=fixture();p.data.floor.changed=true;assert.match(text(pane({...p,slot:'meta'})),/The floor plan changed\..*Load latest/);});
test('landscape actions stack Versions row and Ask, no About',()=>{const p=fixture({slot:'actions',context:{landscape:true}}),el=pane(p);assert.match(el.props.className,/flex-col/);assert.match(text(el),/‹Versions›Ask for a change/);assert.doesNotMatch(text(el),/About/);find(el,'›').props.onClick();assert.equal(selected,2);});
test('menu order, canonical Copy link and shared delete callback execute',async()=>{const p=fixture({slot:'content'});state.views[C].sheet='menu';const el=pane(p),overlay=nodes(el).find(n=>n.type==='overlay');const s=text(overlay);assert.ok(s.indexOf('Open floor plan')<s.indexOf('About this floor plan'));assert.ok(s.indexOf('About this floor plan')<s.indexOf('Use this version'));assert.ok(s.indexOf('Use this version')<s.indexOf('Copy link'));assert.ok(s.indexOf('Copy link')<s.indexOf('Delete canvas…'));find(el,'Copy link').props.onClick();await Promise.resolve();assert.equal(copied,'https://sjc.test/floor/42');find(el,'Delete canvas…').props.onClick();assert.equal(deleted,1);});
test('floor pane has no duplicate canvas picker overlay',()=>{assert.doesNotMatch(readFileSync('components/panel/canvas/floor/FloorCanvasPane.tsx','utf8'),/sheet==='picker'|chooseCanvas/);});
test('deletion notice renders each authorized Open canvas link and generic none',()=>{const notice=load('components/floor/PlanDeletionNotice.tsx',{'react/jsx-runtime':jsx}).PlanDeletionNotice;let el=notice({notice:{message:'Blocked',links:[{title:'Kitchen',href:'/one'},{title:'Bath',href:'/two'}]},onClose(){}});assert.deepEqual(nodes(el).filter(n=>n.type==='a').map(n=>[text(n),n.props.href]),[['Open canvas','/one'],['Open canvas','/two']]);el=notice({notice:{message:'Generic',links:[]},onClose(){}});assert.equal(nodes(el).filter(n=>n.type==='a').length,0);});
test('inline read-only scale is raised 56px; full designer retains bottom-2',()=>{const source=readFileSync('components/floor/Canvas2D.tsx','utf8');assert.match(source,/raised=\{embeddedPreview && ctx.readOnly\}/);assert.match(source,/raised \? "bottom-16 max-w-\[calc\(100%_-_1rem\)\]" : "bottom-2"/);const designer=readFileSync('components/floor/Designer.tsx','utf8');assert.match(designer,/Canvas2D ref=\{canvas\} ctx=\{ctx\} embeddedPreview/);assert.match(designer,/aria-pressed:bg-ink aria-pressed:text-paper/);});
for(const entry of ['TopBar','DesignsStrip','VersionsPanel'])test(`${entry} deletion refusal stays on the design and retains authorized links`,async()=>{
 let promise=Promise.resolve(),notice=null,navigations=0,calls=0;
 const block={message:'Used by own canvas',links:[{title:'Kitchen',href:'/panel/canvas/own'}]};
 const react={useState:v=>[v===null&&entry==='TopBar'&&calls++===1?'design':v,x=>{if(x?.links)notice=x;}],useTransition:()=>[false,fn=>{promise=fn();}]};
 const icons=new Proxy({}, {get:(_,key)=>String(key)});
 const imports={react,'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>({push:()=>navigations++,refresh:()=>navigations++})},'next/link':{default:'a'},'lucide-react':icons,'@/components/ui':{Button:'button',Segmented:'segmented',Card:'card',Chip:'chip',EmptyState:'empty'},'@/lib/run-action':{runAction:async fn=>fn()},'@/lib/actions/plan-designs':{deletePlanDesign:async()=>({ok:false,error:block.message,block}),deletePlanVersion:async()=>({ok:false,error:block.message,block})},'@/lib/plan-library':{ROOM_TEMPLATES:[]},'@/components/projects/ActionMenu':{ActionMenu:'menu'},'./PlanDeletionNotice':{PlanDeletionNotice:'notice'},'../PlanDeletionNotice':{PlanDeletionNotice:'notice'},'./inspector/ChecksPanel':{useChecks:()=>[]},'./view-state':{ALL_LAYERS:[]},'@/lib/actions/plan-files':{},'./fields':{SectionHeader:'section'},'./SheetBuilder':{SheetBuilder:'sheet'}};
 // These are deterministic confirmation and hook seams, no browser/navigation.
 const file=entry==='VersionsPanel'?`components/floor/inspector/${entry}.tsx`:`components/floor/${entry}.tsx`;
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,require:k=>{assert.ok(k in imports,k);return imports[k];},confirm:()=>true,window:{confirm:()=>true}});
 const ctx={d:{doc:{levels:[],ignoredChecks:[],settings:{}},history:[]},view:{layers:new Set()},design:{id:42,name:'Kitchen'},isOwner:true,versions:[{id:1,number:7,label:'Saved',counts:{},published:false}],files:[]};
 const el=module.exports[entry](entry==='DesignsStrip'?{scope:{},designs:[{id:42,name:'Kitchen',counts:{},latestVersion:null}]}:{ctx});
 const button=nodes(el).find(n=>typeof n.props?.onClick==='function'&&text(n)===(entry==='VersionsPanel'?'Delete':'Delete design'));
 assert.ok(button,'delete entry');button.props.onClick();await promise;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(navigations,0);assert.equal(notice,block);
});
