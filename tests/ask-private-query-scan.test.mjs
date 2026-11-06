import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {scanTree,scanSource,violations,digest} from './_harness/ask-private-query-scan.mjs';
const root=new URL('../',import.meta.url).pathname;
// Expectations first: new SQL, new file/function, edited SQL and removed
// authorization all fail until explicitly reviewed. Composed strings and
// quoted/schema-qualified tables are included, as are private derivatives.
test('all private SQL and its enclosing guard sources have an explicit audit',()=>{
 const allow=JSON.parse(readFileSync(new URL('./fixtures/ask-private-query-allowlist.json',import.meta.url)));
 assert.deepEqual(violations(scanTree(root),allow),[]);
});
test('scan refuses new queries even in an already reviewed file or function',()=>{
 const source='async function rail(){ return db.query(`SELECT title FROM ai_conversations`); }';
 const hits=scanSource('lib/example.ts',source);
 const allow={sources:{'lib/example.ts':digest(source)},entries:[{file:'lib/example.ts',function:'rail',classification:'fenced',reason:'fenced-by-helper',explanation:'fixture',queries:hits.map(h=>h.sha256)}]};
 assert.deepEqual(violations({hits,sources:allow.sources},allow),[]);
 for(const edited of [source.replace('title','*'),source.replace('function rail','function foreign'),source+'\n db.query("DELETE FROM ai_messages");'])assert.ok(violations({hits:scanSource('lib/example.ts',edited),sources:{'lib/example.ts':digest(edited)}},allow).length);
 assert.ok(violations({hits:scanSource('app/new.ts',source),sources:{}},allow).length);
 assert.ok(violations({hits,sources:{'lib/example.ts':digest(source+' // guard removed')}},allow).length);
});
test('scan includes SQL fragments, dynamic table constants, qualified names and derivatives',()=>{
 for(const source of ['const base=`SELECT * FROM ai_conversations`; function rail(){db.query(`${base} WHERE id=$1`)}', 'const table="ai_messages"; db.query(`SELECT * FROM ${table}`)', 'db.query(\'SELECT * FROM public."owner_replies"\')','db.query(`SELECT * FROM run_effects`)','const table="ai_messages"; db.query("SELECT * FROM "+table)'])assert.ok(scanSource('lib/example.ts',source).length);
 assert.equal(scanSource('lib/example.ts','// SELECT * FROM ai_conversations\nconst title="Hello";').length,0);
});
test('background sweep is imported only by its secret-authenticated cron route',()=>{
 const route=readFileSync(new URL('../app/api/cron/agent-retries/route.ts',import.meta.url),'utf8');
 assert.match(route,/if \(!authorized\(req\)\)/);assert.match(route,/CRON_SECRET/);
 const files=[];
 const walk=dir=>{for(const f of readdirSync(root+dir,{withFileTypes:true})){const name=dir+'/'+f.name;if(f.isDirectory())walk(name);else if(/\.(?:[cm]?js|tsx?)$/.test(name))files.push(name);}};
 for(const dir of ['lib','app','mcp','scripts'])walk(dir);
 for(const file of files.filter(f=>f!=='app/api/cron/agent-retries/route.ts'&&f!=='lib/thread-folder-maintenance.ts'))assert.doesNotMatch(readFileSync(root+file,'utf8'),/(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["\'][^"\']*thread-folder-maintenance/,file);
});

// R2 counterexamples, expectations before scanner execution.
test('R2 attachment readers, grant excerpts, reply derivatives and composed names require explicit review',()=>{
 for(const source of [
  'query("SELECT reason FROM owner_grants")',
  'const table="ai_"+"messages"; db.query("SELECT body FROM "+table)',
  'query("SELECT * FROM "+["ai","messages"].join("_"))',
  'query("SELECT * FROM private_chat_view")',
  'query("SELECT title,subline FROM notifications")',
  'query("UPDATE owner_replies SET answer=$1")',
  'const root=path.join(cwd,"uploads","ai-chat"); readFile(file)',
  'async function readHandedFiles(paths){return paths.map(readFile)}',
 ]){const hits=scanSource('lib/new.ts',source);assert.ok(hits.length,source);assert.ok(violations({hits,sources:{}},{entries:[],sources:{}}).length,source);}
});

// R3: shared status columns once held private replies. Every new reader must
// still be reviewed even after those copies are removed; include Browser's
// payload/manifest/audit carriers and runtime fan-out tables in the census.
test('R3 reply fan-out and browser carriers cannot escape the scanner',()=>{
 for(const [table,column] of [['decisions','decision_note'],['decision_events','detail'],['action_intents','last_error'],['work_items','blocked_reason'],['agent_triggers','payload'],['agent_executions','tool_trace'],['browser_commands','safe_result'],['browser_read_manifests','public_entries'],['browser_audit','result_code']]){
  const source=`query("SELECT ${column} FROM ${table}")`;
  assert.ok(scanSource('lib/new-copy-reader.ts',source).length,source);
 }
});
