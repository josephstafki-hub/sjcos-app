// Expectations 9–12 written first in phone-push-r6-expectations.md.
// Compile the unchanged card functions from the real TSX. Inspect their JSX
// and invoke real event handlers; this does not claim browser/layout coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);

function card(file, engine = false) {
  const source = ts.createSourceFile(file, readFileSync(new URL(`../${file}`, import.meta.url),'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'WorkItemCard');
  assert.ok(fn, 'compile the production card, never a copied implementation');
  const code = ts.transpileModule(fn.getText(source), {compilerOptions:{jsx:ts.JsxEmit.ReactJSX, module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}}).outputText;
  const calls = [];
  let hook = 0;
  const approve = async (...args) => {calls.push(args); return {ok:true};};
  const scope = {
    require, exports:{},
    useRouter:()=>({refresh(){}}),
    useState:()=>[engine && hook++ === 0,()=>{}],
    useTransition:()=>[false,fn=>fn()],
    runAction:async(fn,opts)=>{assert.equal(opts?.title,'Approve failed'); return fn();},
    approveRecordWorkItem:approve, approveWorkItem:approve,
    rejectRecordWorkItem:async()=>({ok:true}), rejectWorkItem:async()=>({ok:true}),
    toast(){}, describeApproval:()=>({}), statusChip:()=> 'flag',
    STATUS_LABEL:{approval_needed:'Needs approval'}, PRIORITY_LABEL:{},
    btnCls:'button',btnPrimary:'primary',Chip:'Chip',Card:'Card',Button:'Button',
    WorkItemDraft:'WorkItemDraft',agentLabel:x=>x,
  };
  const render = new Function(...Object.keys(scope), `${code}; return WorkItemCard;`)(...Object.values(scope));
  return {render:props=>{hook=0;return render(props);},calls};
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if(Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree,...nodes(tree.props?.children)];
}
const item = (body='Check stock.') => ({id:'shown-work-item',title:'Internal plan',body,bucket:'approval',status:'approval_needed',priority:'normal',assignedTo:[],createdBy:'agent',requiresApproval:true,draft:{body,to:null,subject:null,binding:'displayed-binding'}});
const buttons = tree=>nodes(tree).filter(n=>['Approve','Reject'].includes(n.props?.children));
const draftBoxes = tree=>nodes(tree).filter(n=>n.type==='WorkItemDraft');
for(const kind of ['lead','project']) test(`long ${kind} internal Ops text is fully readable and retains binding`,async()=>{
  const c=card('components/engine/RecordOps.tsx');
  const body=Array.from({length:8},(_,i)=>`${i+1}. Review material stock, delivery windows and installation dependencies.`).join('\n');
  const it=item(body),props={item:it,kind,slug:'oak',canApprove:true};
  const tree=c.render(props);
  assert.equal(draftBoxes(tree).length,0);
  const text=nodes(tree).find(n=>n.props?.children===body);
  assert.ok(text);assert.doesNotMatch(text.props.className,/line-clamp|overflow-hidden|max-h-/);
  assert.match(text.props.className,/whitespace-pre-wrap/);
  assert.match(text.props.className,/break-words/);
  assert.equal(buttons(tree).length,2);
  await buttons(tree).find(n=>n.props.children==='Approve').props.onClick();
  assert.deepEqual(c.calls,[[it.id,kind,'oak',it.draft.binding]]);
  // Without a receipt the read layer falls back to the same internal body.
  assert.doesNotMatch(nodes(c.render({...props,item:{...it,draft:null}})).find(n=>n.props?.children===body).props.className,/line-clamp/);
  const page=readFileSync(new URL(`../app/(os)/${kind==='lead'?'leads':'projects'}/[slug]/page.tsx`,import.meta.url),'utf8');
  assert.ok(page.includes('canApprove={can(viewer, "today")}'),'page derives button access from Today');
});
test('Ops keeps duplicate suppression and distinct/email/portal previews; no-area staff have no controls',()=>{
  const c=card('components/engine/RecordOps.tsx'),it=item();
  const render=it=>c.render({item:it,kind:'lead',slug:'oak',canApprove:false});
  assert.equal(draftBoxes(render(it)).length,0);
  assert.equal(buttons(render(it)).length,0);
  for(const draft of [{...it.draft,body:'Different receipt content.'},{...it.draft,to:'client@example.test',subject:'Quote'},{...it.draft,to:'Oak (client portal)'}]) {
    const tree=render({...it,draft}); assert.equal(draftBoxes(tree).length,1);
    assert.deepEqual(draftBoxes(tree)[0].props.draft,draft);
  }
});
test('Engine staff can approve/reject without assignment authority and submit displayed binding',async()=>{
  const c=card('components/engine/EngineClient.tsx',true),it=item();
  const tree=c.render({item:it,assignees:[],canAssign:false});
  assert.equal(buttons(tree).length,2);assert.equal(draftBoxes(tree).length,0);
  await buttons(tree).find(n=>n.props.children==='Approve').props.onClick();
  assert.deepEqual(c.calls,[[it.id,it.draft.binding]]);
  assert.ok(!nodes(tree).some(n=>n.props?.trigger==='Assign'),'approval access does not confer assignment');
});

// R7 expectation 14: actual card JSX on both record surfaces, no browser.
test('Ops without Today explains the pending approval without offering controls',()=>{
  const c=card('components/engine/RecordOps.tsx');
  for(const kind of ['lead','project']) {
    const props={item:item(),kind,slug:'oak',canApprove:false};
    const tree=c.render(props);
    assert.equal(buttons(tree).length,0);
    const notes=nodes(tree).filter(n=>n.props?.children==='Waiting on approval.');
    assert.equal(notes.length,1);
    assert.equal(notes[0].type,'span');
    assert.equal(notes[0].props.className,'text-meta text-ink-3');
    const allowed=c.render({...props,canApprove:true});
    assert.equal(buttons(allowed).length,2);
    assert.ok(!nodes(allowed).some(n=>n.props?.children==='Waiting on approval.'));
  }
});
