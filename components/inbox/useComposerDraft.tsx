'use client';
import {useEffect, useRef, useState} from 'react';
import {Button} from '@/components/ui';
import {useSyncedDraft} from './useSyncedDraft';
import {discardDraft, dismissSuggestion, markDraftSent} from '@/lib/actions/inbox-drafts';
import {draftStatusLabel, finishDraftSend, prepareDraftSend} from '@/lib/inbox-draft-ui';
import type {SavedInboxDraft} from '@/lib/inbox-experience';
import type {DraftText} from '@/lib/inbox-draft-types';
import type {ThreadChannel} from '@/lib/types';

/** UI metadata stays separate from synced text. AI suggestions never become
 * human drafts until an explicit Use it click (or Send on the approval card). */
export function useComposerDraft(options: {mailbox:string;userId:string;owner:boolean;threadKey:string;channel:ThreadChannel;latestMessageId?:string;initial?:Partial<DraftText>}) {
  const synced = useSyncedDraft(options);
  const metaKey=JSON.stringify(['sjc:inbox:draft-meta',options.mailbox,options.userId,options.threadKey,options.channel]);
  type Metadata=Pick<SavedInboxDraft,'ai'|'model'|'basedOn'|'humanEdited'> & {suggestionId?:string};
  const [entry,setEntry] = useState<{key:string;value:Partial<Metadata>}>({key:metaKey,value:{}});
  const meta=entry.key===metaKey?entry.value:{};
  useEffect(()=>{
    let prior:Partial<Metadata>={};
    try{prior=JSON.parse(localStorage.getItem(metaKey)??'null')??{};}catch{}
    setEntry({key:metaKey,value:prior});
  },[metaKey]);
  function metadata(next:Partial<Metadata>){setEntry({key:metaKey,value:next});try{localStorage.setItem(metaKey,JSON.stringify(next));}catch{}}
  const accepted=meta.suggestionId?{id:meta.suggestionId}:null;
  const value:SavedInboxDraft = {...meta,...synced.draft,model:meta.model??'',ai:meta.ai??false};
  const latest=useRef(value);latest.current=value;
  const revision=useRef(0);
  const textKey=JSON.stringify(synced.draft);
  const lastText=useRef(textKey);
  if(lastText.current!==textKey){lastText.current=textKey;revision.current++;}
  function set(next:SavedInboxDraft,suggestionId=meta.suggestionId){
    revision.current++;latest.current=next;
    metadata({...meta,suggestionId,ai:next.ai,model:next.model,basedOn:next.basedOn,humanEdited:next.humanEdited});
    synced.setDraft(current=>({...current,body:next.body,toEmail:next.toEmail}));
  }
  const suggestion=options.owner&&options.channel==='email'&&options.latestMessageId&&synced.suggestion?.sourceMessageId===options.latestMessageId&&synced.suggestion.channel===options.channel?synced.suggestion:null;
  function acceptSuggestion(){
    if(!suggestion)return;
    metadata({suggestionId:suggestion.id,ai:true,model:suggestion.model==='claude'?'Claude':'Hermes',basedOn:suggestion.basedOn,humanEdited:false});
    synced.acceptSuggestion();
  }
  async function clear(){
    const snapshot=await prepareDraftSend(synced.draft,synced.flush);
    const result=await discardDraft({threadKey:options.threadKey,channel:options.channel,baseVersion:snapshot.version});
    await synced.refresh();
    if(result.conflict)throw Error('This draft changed on another device. Resolve the conflict before discarding.');
    if(accepted)await dismissSuggestion(accepted.id);
    metadata({});
  }
  async function prepare(){const draft=synced.draft;await synced.refresh();return prepareDraftSend(draft,synced.flush);}
  async function finish(version:number,suggestionId=accepted?.id){
    const warning=await finishDraftSend({threadKey:options.threadKey,channel:options.channel,baseVersion:version,suggestionId},markDraftSent,synced.refresh);
    if(!warning)metadata({});
    return warning;
  }
  return {value,set,clear,latest,revision,loaded:true,synced,suggestion,accepted,acceptSuggestion,prepare,finish};
}
export function DraftSyncFooter({saved,disabled=false}:{saved:ReturnType<typeof useComposerDraft>;disabled?:boolean}) {
  return <div className="flex flex-wrap items-center gap-1 py-1 text-meta text-ink-3" role="status">
    <span>{draftStatusLabel(saved.synced.status)}</span>
    {saved.synced.status==='conflict'&&<><span>·</span><Button size="sm" variant="ghost" disabled={disabled} onClick={()=>saved.synced.keepMine()}>Keep mine</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={()=>saved.synced.resolve('server')}>Use theirs</Button></>}
  </div>;
}
