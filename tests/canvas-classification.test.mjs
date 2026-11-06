import {startCluster} from './_harness/testdb.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
import {CLASSIFICATION_REGISTRY as registry,CONTENT_AREAS,assertEveryToolClassified,classifyToolAreas} from '../lib/canvas-classification.mjs';

// Construction registers the REAL inventory, including loop-generated names. No
// transport, handler, SQL, app server or connection is started by buildServer.
process.env.DATABASE_URL_AGENT=startCluster().url;
process.env.DATABASE_URL=process.env.DATABASE_URL_AGENT;
const {buildServer}=await import('../mcp/sjcos-mcp.mjs');
const server=buildServer({transportKind:'http'});
const registered=Object.keys(server._registeredTools).sort();
test('every actual sjcos registration has an explicit classification, with no stale entries',()=>{
 assertEveryToolClassified(registered,registry);
 assert.deepEqual(Object.keys(registry.tools).sort(),registered);
 assert.equal(registered.length,285);
 for(const name of registered){const r=classifyToolAreas(name,registry);assert.equal(r.complete,true,name);assert.ok(r.areas.every(a=>!['ai','projects'].includes(a)),name);}
 const catalog=[...readFileSync(new URL('../lib/permissions.ts',import.meta.url),'utf8').matchAll(/\{\s*key:\s*"(\w+)"/g)].map(m=>m[1]).filter(k=>!['projects','ai'].includes(k));
 assert.deepEqual(CONTENT_AREAS,catalog);
});
test('handoff has one returned-field evidence row per tool and a reason for each full-C entry',()=>{
 const doc=readFileSync(new URL('../docs/plans/build/canvas-classification-HANDOFF.md',import.meta.url),'utf8');
 const rows=[...doc.matchAll(/^\| ([a-z_]+) \|/gm)].map(m=>m[1]);assert.deepEqual(rows.sort(),registered);
 for(const [name,entry] of Object.entries(registry.tools))if(entry.areas.length===CONTENT_AREAS.length)assert.ok(doc.includes('**'+name+'**:'),name);
});
const moneyAreas=['estimates','invoices','purchase_orders','change_orders','bidding','cost_book','money'];
const moneyField=/^(?:(?:.*_)?(?:amount|price|cost|markup|budget|subtotal|total|balance|paid|collected|profit|margin|retainage|outstanding|allowance|funding)(?:_.*)?|rate|msrp|extended|value_display|costCaps)$/i;
const moneyKey=s=>moneyField.test(s.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()));
function parse(file){const text=readFileSync(file,'utf8');return ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);}
function visit(n,fn){fn(n);ts.forEachChild(n,c=>visit(c,fn));}
// Deliberately simple result scan. Follow local aliases from json(result),
// object shorthands/spreads and mappings into SELECT projections/RETURNING and
// returned object keys. Do not scan inputSchema, write columns, WHERE clauses or
// SELECTs only used internally: a financial WRITE returning {ok,id} adds none.
const tableFields=new Map();
for(const file of [new URL('../db/schema.sql',import.meta.url),...readdirSync(new URL('../db/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).map(f=>new URL('../db/migrations/'+f,import.meta.url))]){
 const sql=readFileSync(file,'utf8');
 for(const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? ([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)){
  const fields=[...m[2].matchAll(/(?:^|[,\n])\s*([a-z_]+)\s+(?:text|varchar|uuid|bigint|integer|int|numeric|boolean|date|timestamptz|jsonb)/gi)].map(x=>x[1]);tableFields.set(m[1],[...(tableFields.get(m[1])??[]),...fields]);
 }
}
function resultFields(handler,source,key=moneyKey){
 const bindings=new Map(),fields=new Set(),seen=new Set();
 visit(handler,n=>{if(ts.isVariableDeclaration(n)){if(ts.isIdentifier(n.name)&&n.initializer)bindings.set(n.name.text,n.initializer);else if(n.initializer&&ts.isArrayBindingPattern(n.name))for(const el of n.name.elements)if(ts.isBindingElement(el)&&ts.isIdentifier(el.name))bindings.set(el.name.text,n.initializer);}});
 function scan(n){if(!n||seen.has(n))return;seen.add(n);
  if(ts.isIdentifier(n)){scan(bindings.get(n.text));return;}
  if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateExpression(n)){
   const sql=n.getText(source);for(const m of sql.matchAll(/(?:SELECT|RETURNING)\s+([\s\S]*?)(?:\s+FROM\b|\s+WHERE\b|`|$)/gi))for(const k of m[1].matchAll(/\b[a-z][a-z0-9_]*\b/gi))if(key(k[0]))fields.add(k[0]);
   for(const m of sql.matchAll(/SELECT\s+(?:[a-z]+\.)?\*\s+FROM\s+([a-z_]+)/gi))for(const k of tableFields.get(m[1])??[])if(key(k))fields.add(k);return;
  }
  if(ts.isCallExpression(n)){
   const name=n.expression.getText(source);
   if(['json','payload','rows','run','Promise.all'].includes(name))scan(n.arguments[0]);
   else if(ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='map'){scan(n.expression.expression);for(const a of n.arguments)if(ts.isArrowFunction(a)){if(ts.isBlock(a.body))returns(a.body);else scan(a.body);}}
   return;
  }
  if(ts.isPropertyAccessExpression(n)){if(key(n.name.text))fields.add(n.name.text);scan(n.expression);return;}
  if(ts.isPropertyAssignment(n)){if(key(n.name.getText(source).replaceAll(/["']/g,'')))fields.add(n.name.getText(source));scan(n.initializer);return;}
  if(ts.isShorthandPropertyAssignment(n)&&key(n.name.text))fields.add(n.name.text);
  ts.forEachChild(n,scan);
 }
 function returns(n){if(n!==handler&&ts.isFunctionLike(n))return;if(ts.isReturnStatement(n))scan(n.expression);else ts.forEachChild(n,returns);}
 returns(handler.body);
 // Expression-bodied handlers have no return statement.
 if(handler.body&&!ts.isBlock(handler.body))scan(handler.body);
 return [...fields];
}
test('returned SQL projections and object keys never drop every money fence',()=>{
 let scanned=0,sensitive=0;
 for(const file of readdirSync(new URL('../mcp/',import.meta.url)).filter(f=>f.endsWith('-tools.mjs')||f==='sjcos-mcp.mjs')){
  const source=parse(new URL('../mcp/'+file,import.meta.url).pathname);
  visit(source,n=>{if(!ts.isCallExpression(n)||!n.expression.getText(source).endsWith('.registerTool')||!ts.isStringLiteral(n.arguments[0]))return;
   const name=n.arguments[0].text;if(!registered.includes(name))return;scanned++;
   // Library total is a product COUNT (list.length), never a price.
   const fields=resultFields(n.arguments[2],source).filter(k=>!(name==='list_plan_library'&&k==='total'));if(!fields.length)return;sensitive++;
   assert.ok(classifyToolAreas(name,registry).areas.some(a=>moneyAreas.includes(a)),`${name} returns money-like fields: ${fields.join(', ')}`);
  });
 }
 assert.ok(scanned>250);assert.ok(sensitive>=20,`scanner must see actual money outputs (${sensitive})`);
});
test('field scan detects new financial keys and SQL aliases, without scanning write-only input',()=>{
 const s=ts.createSourceFile('fixture.mjs',`const a=()=>{const r=await rows(\`SELECT unit_cost, amount_cents FROM invoices\`);return json({rows:r,markup_pct:2});}; const b=()=>{rows(\`UPDATE x SET amount=$1 RETURNING id\`);return json({ok:true,id:1});};`,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const handlers=[];visit(s,n=>{if(ts.isArrowFunction(n))handlers.push(n);});
 assert.deepEqual(resultFields(handlers[0],s).sort(),['amount_cents','markup_pct','unit_cost']);assert.deepEqual(resultFields(handlers[1],s),[]);
});
test('known incidental and helper-return financial fields keep their matching money areas',()=>{
 const expected={list_projects:['invoices'],get_project:['estimates','invoices','change_orders','money','leads','subs'],list_leads:['estimates'],get_lead:['estimates','money'],list_subs:['money'],list_catalog_materials:['money'],list_mood_boards:['money'],get_project_selections:['money'],get_scope_register:['estimates','money'],record_site_findings:['estimates','money'],list_schedule_plans:['money'],confirm_schedule:['money'],prepare_tentative_schedule:['money'],adjust_internal_schedule:['money'],list_project_estimates:['estimates','change_orders'],get_project_financials:['invoices','purchase_orders','change_orders','money'],pricing_setup:['estimates','cost_book','money'],cost_learning_preview:['cost_book'],get_project_funding:['invoices','money'],final_reconciliation:['estimates','invoices','change_orders'],get_document_draft:['estimates','invoices','change_orders','money'],measurement_summary:['money'],delete_expense:['money'],get_work_item:['money'],get_bid_package:['bidding'],get_purchase_order:['purchase_orders']};
 for(const [tool,areas] of Object.entries(expected))for(const area of areas)assert.ok(classifyToolAreas(tool,registry).areas.includes(area),`${tool}: ${area}`);
});
test('bookkeeping returns no business data and project geometry does not inherit actor areas',()=>{
 for(const tool of ['record_agent_run','record_receipt','record_skill_used','capture_knowledge','set_sub_archived','update_sub_record','add_selection_option','get_plan_measures','run_plan_checks','record_workflow_event'])assert.deepEqual(classifyToolAreas(tool,registry),{complete:true,areas:[]},tool);
 assert.deepEqual(classifyToolAreas('list_schedule_plans',registry).areas,['money']);
});
test('unknown tools/variants fail closed; explicit variants union with base areas',()=>{
 for(const [tool,variant] of [['not_registered',undefined],['get_project','missing'],['list_schedule_plans','empty']])assert.deepEqual(classifyToolAreas(tool,registry,variant),{complete:false,areas:[...CONTENT_AREAS]});
 assert.throws(()=>assertEveryToolClassified([...registered,'new_tool'],registry),/Unclassified/);
 const r={version:1,content_areas:CONTENT_AREAS,tools:{shape:{areas:['today'],variants:{read:{areas:['money']},write:{areas:[]}}}}};
 assert.deepEqual(classifyToolAreas('shape',r,'read'),{complete:true,areas:['today','money']});assert.deepEqual(classifyToolAreas('shape',r,'write'),{complete:true,areas:['today']});assert.equal(classifyToolAreas('shape',r).complete,false);
});

// Every narrow handler is re-scanned against returned keys/SQL, including broad
// row projections expanded from the checked-in schema, rather than tool names.
test('all narrow returned contacts and subcontractor fields retain their fences',()=>{
 let audited=0,found=0;
 const keys=/^(client_email|client_phone|sub_slug|sub_email|vendor_email|vendor_phone|email|phone)$/;
 for(const file of readdirSync(new URL('../mcp/',import.meta.url)).filter(f=>f.endsWith('-tools.mjs')||f==='sjcos-mcp.mjs')){
  const source=parse(new URL('../mcp/'+file,import.meta.url).pathname);
  visit(source,n=>{if(!ts.isCallExpression(n)||!n.expression.getText(source).endsWith('.registerTool')||!ts.isStringLiteral(n.arguments[0]))return;
   const name=n.arguments[0].text;if(!registry.tools[name]||registry.tools[name].areas.length===CONTENT_AREAS.length)return;audited++;
   const fields=resultFields(n.arguments[2],source,k=>keys.test(k));
   for(const field of fields){found++;const areas=classifyToolAreas(name,registry).areas;
    const area=field.startsWith('client_')?'leads':field.startsWith('sub_')?'subs':field.startsWith('vendor_')?'vendors':null;
    assert.ok(area?areas.includes(area):areas.some(a=>['leads','subs','vendors','chat','comms','inbox','newsletter'].includes(a)),`${name} returns ${field}, needs ${area}`);
   }
  });
 }
 assert.ok(audited>140);assert.ok(found>=3,found);
});
