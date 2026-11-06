import {createHash,randomUUID} from 'node:crypto';
import {open,mkdir,readFile,link,unlink,lstat} from 'node:fs/promises';
import path from 'node:path';
export const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export {removedAreas,showRowWarnings,audienceSentence,acknowledgementLabel} from './canvas-save-policy.mjs';
export function normalizeFilename(title,version,input){
 const value=input??`${title.replace(/[^\p{L}\p{N} _-]/gu,'').trim()||'Diagram'} (v${version}).html`;
 if(typeof value!=='string'||value.length>180||!value.endsWith('.html')||/[\\/\x00-\x1f\x7f]/.test(value)||!value.trim())throw Object.assign(Error('INVALID_INPUT'),{code:'INVALID_INPUT'});
 return value;
}
export const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function snapshotHtml(v,svg){return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(v.title)}</title></head><body><h1>${escapeHtml(v.title)}</h1><p>Made by Claude · Version ${v.version} · Internal draft</p><p>${escapeHtml(v.created_at instanceof Date?v.created_at.toISOString():v.created_at)}</p><p>${escapeHtml(v.summary)}</p>${svg}</body></html>`;}
/** Exclusive temp + fsync + no-replace atomic link. Existing bytes must match. */
export async function writeImmutableBlob(dir,name,bytes,expected=digest(bytes)){
 if(path.basename(name)!==name||digest(bytes)!==expected)throw Error('BLOB_HASH_MISMATCH');
 await mkdir(dir,{recursive:true});const target=path.join(dir,name);
 try{const st=await lstat(target);if(!st.isFile()||st.isSymbolicLink()||st.size>1048576)throw Error('BLOB_HASH_MISMATCH');if(digest(await readFile(target))!==expected)throw Error('BLOB_HASH_MISMATCH');return;}catch(e){if(e.code!=='ENOENT')throw e;}
 const temp=target+'.'+randomUUID()+'.tmp',f=await open(temp,'wx',0o600);
 try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
 try{try{await link(temp,target);}catch(e){if(e.code!=='EEXIST'||digest(await readFile(target))!==expected)throw e;}const d=await open(dir,'r');try{await d.sync();}finally{await d.close();}}finally{await unlink(temp).catch(()=>{});}
}
