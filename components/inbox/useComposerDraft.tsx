'use client';
import {useRef} from 'react';
import {Button} from '@/components/ui';
import {useSyncedDraft} from './useSyncedDraft';
import {discardDraft, dismissSuggestion, markDraftSent} from '@/lib/actions/inbox-drafts';
import {draftStatusLabel, finishDraftSend, prepareDraftSend} from '@/lib/inbox-draft-ui';
import type {SavedInboxDraft} from '@/lib/inbox-experience';
import type {DraftText, InboxDraft} from '@/lib/inbox-draft-types';
import type {ThreadChannel} from '@/lib/types';

/** Provenance is synced with the text. AI suggestions never become
 * human drafts until an explicit Use it click (or Send on the approval card). */
export function useComposerDraft(options: {mailbox:string;userId:string;owner:boolean;threadKey:string;channel:ThreadChannel;latestMessageId?:string;initial?:Partial<DraftText>;
  /** The suggestion the list already loaded — shown at once instead of waiting for this composer's own load. */
  initialSuggestion?:InboxDraft|null}) {
  const synced = useSyncedDraft(options);
  const meta=synced.draft.provenance;
  const accepted=meta?.acceptedSuggestionId?{id:meta.acceptedSuggestionId}:null;
  const value:SavedInboxDraft = {...synced.draft,model:meta?.model?meta.model[0].toUpperCase()+meta.model.slice(1):'',ai:Boolean(meta?.model),basedOn:meta?.basedOn,humanEdited:meta?.humanEdited};
  const latest=useRef(value);latest.current=value;
  const revision=useRef(0);
  const textKey=JSON.stringify(synced.draft);
  const lastText=useRef(textKey);
  if(lastText.current!==textKey){lastText.current=textKey;revision.current++;}
  function set(next:SavedInboxDraft,suggestionId=meta?.acceptedSuggestionId??undefined){
    revision.current++;latest.current=next;
    const model=next.model?.toLowerCase();
    synced.setDraft(current=>({...current,body:next.body,toEmail:next.toEmail,
      provenance:{model:next.ai&&(model==='claude'||model==='hermes'||model==='qwen')?model:null,basedOn:next.basedOn??'',acceptedSuggestionId:suggestionId??null,humanEdited:next.humanEdited??false}}));
  }
  const matches=(s?:InboxDraft|null)=>Boolean(options.owner&&options.channel==='email'&&options.latestMessageId&&s?.sourceMessageId===options.latestMessageId&&s.channel===options.channel);
  const own=matches(synced.suggestion)?synced.suggestion:null;
  // Until this composer's own load answers (server actions run one at a time, so it can
  // queue for seconds on a phone), show the suggestion the list already has.
  const early=!own&&!synced.checked&&matches(options.initialSuggestion)?options.initialSuggestion!:null;
  const suggestion=own??early;
  function acceptSuggestion(){
    if(!suggestion)return;
    synced.setDraft(current=>({...current,body:suggestion.body,toEmail:suggestion.toEmail||current.toEmail,cc:suggestion.cc,subject:suggestion.subject,
      provenance:{model:suggestion.model,basedOn:suggestion.basedOn,acceptedSuggestionId:suggestion.id,humanEdited:false}}));
  }
  async function clear(){
    const snapshot=await prepareDraftSend(synced.draft,synced.flush);
    const result=await discardDraft({threadKey:options.threadKey,channel:options.channel,baseVersion:snapshot.version});
    await synced.refresh();
    if(result.conflict)throw Error('This draft changed on another device. Resolve the conflict before discarding.');
    if(accepted)await dismissSuggestion(accepted.id);
  }
  async function prepare(){const draft=synced.draft;await synced.refresh();return prepareDraftSend(draft,synced.flush);}
  async function finish(version:number,suggestionId=accepted?.id){
    const warning=await finishDraftSend({threadKey:options.threadKey,channel:options.channel,baseVersion:version,suggestionId},markDraftSent,synced.refresh);
    return warning;
  }
  return {value,set,clear,latest,revision,loaded:true,synced,suggestion,accepted,acceptSuggestion,prepare,finish};
}
export function DraftSyncFooter({saved,disabled=false,localFiles=false}:{saved:ReturnType<typeof useComposerDraft>;disabled?:boolean;localFiles?:boolean}) {
  return <div className="flex flex-wrap items-center gap-1 py-1 text-meta text-ink-3" role="status">
    <span>{localFiles&&saved.synced.status==='saved'?'Text saved · files on this device':draftStatusLabel(saved.synced.status)}</span>
    {saved.synced.status==='conflict'&&<div className="w-full">
      <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto rounded border border-rule bg-card p-2" aria-label="Compare draft versions">
        {[{label:'Your version',draft:saved.synced.draft},{label:'Other device',draft:saved.synced.conflict?.current}].map(({label,draft})=><section key={label} className="min-w-0 break-words"><p className="font-semibold text-ink">{label}</p><p>To: {draft?.toEmail||'No recipient'}</p>{Boolean(draft?.cc?.length)&&<p>Cc: {draft!.cc.join(', ')}</p>}<p>{draft?.subject}</p><p className="whitespace-pre-wrap">{draft?.body||'No draft text'}</p>{label==='Other device'&&saved.synced.conflict?.current?.status!=='ready'&&<p>{saved.synced.conflict?.current?.status??'No saved draft'}</p>}</section>)}
      </div>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={()=>saved.synced.keepMine()}>Keep mine</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={()=>saved.synced.resolve('server')}>Use theirs</Button>
    </div>}
  </div>;
}
