import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
// Include private derivatives, not just the five source tables. SQL fragments
// and their interpolating callers are tracked; comments do not authorize SQL.
const tables=/\b(?:ai_conversations|ai_messages|dev_agent_runs|agent_interactions|owner_replies|ai_folders|run_steers|run_effects|agent_pending_actions|orchestration_tasks|orchestration_events)\b/i;
const sql=/\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|TRUNCATE|ALTER|COPY)\b/i;
export const digest=text=>createHash('sha256').update(text).digest('hex');
export function scanSource(file,source){
 const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const fragments=new Set();
 // Fixed point follows table-name constants and composed SQL across fragments.
 let changed=true;
 const relevant=n=>tables.test(n.getText(sf))||[...fragments].some(v=>new RegExp('\\b'+v+'\\b').test(n.getText(sf)));
 while(changed){changed=false;const walk=n=>{if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer&&relevant(n.initializer)&&!fragments.has(n.name.text)){fragments.add(n.name.text);changed=true;}ts.forEachChild(n,walk);};walk(sf);}
 const hits=[];
 function walk(n,fn='<module>'){
  if(ts.isFunctionLike(n))fn=n.name?.getText(sf)||(ts.isVariableDeclaration(n.parent)?n.parent.name.getText(sf):fn);
  if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateExpression(n)){
   const text=n.getText(sf);
   let compound=n;
   while(ts.isBinaryExpression(compound.parent))compound=compound.parent;
   if(relevant(compound)&&(sql.test(text)||ts.isCallExpression(n.parent)&&n.parent.arguments[0]===n&&/query|run|safe|rows|exec/i.test(n.parent.expression.getText(sf)))){
    hits.push({file,function:fn,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,sha256:digest(text)});return;
   }
  }
  ts.forEachChild(n,c=>walk(c,fn));
 }
 walk(sf);return hits;
}
export function scanTree(root){
 const hits=[],sources={};
 function walk(dir){for(const f of readdirSync(path.join(root,dir),{withFileTypes:true})){
  const file=dir+'/'+f.name;if(f.isDirectory())walk(file);
  else if(/\.(?:[cm]?js|tsx?|sql)$/.test(file)){
   const source=readFileSync(path.join(root,file),'utf8');
   const found=file.endsWith('.sql')&&tables.test(source)&&sql.test(source)?[{file,function:'<sql>',line:1,sha256:digest(source)}]:scanSource(file,source);
   if(found.length){sources[file]=digest(source);hits.push(...found);}
  }
 }}
 for(const dir of ['lib','app','mcp','scripts'])walk(dir);
 return {hits,sources};
}
export function violations(actual,allow){
 const errors=[],seen=new Set();
 for(const e of allow.entries){
  if(!['fenced-by-helper','trusted-background','owner-health-opaque-ids'].includes(e.reason)||!e.explanation||!['fenced','trusted-background','not-private'].includes(e.classification))errors.push('invalid audit entry '+e.file+' '+e.function);
  const key=e.file+'#'+e.function;if(seen.has(key))errors.push('duplicate '+key);seen.add(key);
 }
 for(const hit of actual.hits){const entry=allow.entries.find(e=>e.file===hit.file&&e.function===hit.function);
  if(!entry?.queries.includes(hit.sha256))errors.push(`Unaudited private SQL: ${hit.file}:${hit.line} ${hit.function}`);
 }
 for(const [file,hash] of Object.entries(actual.sources))if(allow.sources[file]!==hash)errors.push(`Private SQL/guard source changed; review audit: ${file}`);
 for(const e of allow.entries)for(const hash of e.queries)if(!actual.hits.some(h=>h.file===e.file&&h.function===e.function&&h.sha256===hash))errors.push(`Stale private SQL audit: ${e.file} ${e.function}`);
 return errors;
}
