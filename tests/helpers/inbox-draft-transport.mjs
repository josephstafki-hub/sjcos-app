// In-memory draft server for component tests. Never imports a DB/provider.
export function draftTransport() {
 const rows=new Map(),calls=[];
 const key=input=>`${input.threadKey}:${input.channel}`;
 const api={rows,calls,suggestions:[],offline:false,cleanupFails:false,
  async load(keys){calls.push(['load',keys]);if(api.offline)throw Error('offline');return [...rows.values(),...api.suggestions].filter(r=>keys.includes(r.threadKey));},
  async save(input){calls.push(['save',input]);if(api.offline)throw Error('offline');const prior=rows.get(key(input));if(input.baseVersion!==(prior?.version??0))return {conflict:true,current:prior??null};const current={...input,model:input.provenance?.model??null,basedOn:input.provenance?.basedOn??'',acceptedSuggestionId:input.provenance?.acceptedSuggestionId??null,humanEdited:input.provenance?.humanEdited??false,sources:input.provenance?.sources??[],id:key(input),source:'human',status:'ready',version:(prior?.version??0)+1};rows.set(key(input),current);return {conflict:false,current};},
  async finish(input,status){calls.push([status,input]);if(api.cleanupFails)throw Error('cleanup offline');const prior=rows.get(key(input));if(input.baseVersion!==(prior?.version??0))return {conflict:true,current:prior??null};const current={...input,id:key(input),source:'human',body:'',toEmail:'',cc:[],subject:'',status,version:(prior?.version??0)+1};rows.set(key(input),current);if(input.suggestionId)api.suggestions=api.suggestions.filter(r=>r.id!==input.suggestionId);return {conflict:false,current};},
  async dismiss(id){calls.push(['dismiss',id]);api.suggestions=api.suggestions.filter(r=>r.id!==id);}
 };return api;
}
export const draftActionStub=`const a=globalThis.__draftServer;export const loadDrafts=k=>a.load(k),saveDraft=i=>a.save(i),discardDraft=i=>a.finish(i,'discarded'),markDraftSent=i=>a.finish(i,'sent'),dismissSuggestion=id=>a.dismiss(id);`;
export const draftComponentUrls=['useComposerDraft.tsx','useSyncedDraft.ts'].map(name=>new URL('../../components/inbox/'+name,import.meta.url).href);
export function draftResolve(s,c,n) {
 if(s==='@/lib/actions/inbox-reminders')return n('data:text/javascript,'+encodeURIComponent('export const quickInboxReminder=async()=>({ok:true});export const undoInboxReminder=async()=>({ok:true});'),c);
 if(s==='./useComposerDraft'||s==='./useSyncedDraft')return n(new URL(s+(s.endsWith('ComposerDraft')?'.tsx':'.ts'),c.parentURL).href,c);
 if(s==='./inbox-experience')return n(new URL('../../lib/inbox-experience.ts',import.meta.url).href,c);
}
