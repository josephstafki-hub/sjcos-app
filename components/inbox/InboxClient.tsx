"use client";

import {
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useTransition,
  useCallback,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
} from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Maximize2,
  Paperclip,
  Filter,
  Mail,
  MessageSquare,
  UserRound,
  UserCheck,
  Globe,
  Tag,
  MoreHorizontal,
  ChevronLeft,
  Send,
  PenSquare,
  Inbox,
  X,
  Star,
  MailOpen,
  Archive,
  Trash2,
  Flag,
  ExternalLink,
  OctagonAlert,
  Check,
  Clock,
  ListPlus,
  ChevronRight,
  Search,
  Keyboard,
  Link as LinkIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Button,
  EmptyState,
  Segmented,
  Chip,
  Avatar,
  VoiceButton,
} from "@/components/ui";
import {
  automationDeadline, rememberNeedsCount,
  splitQuotedText,
  substantiveSnippet,
  channelCommitLabel,
  smsSegments,
  latestInboundIndex,
  composerExpanded,
  isNoReplyAddress,
} from "@/lib/inbox-rules";
import {guardInboxNavigation,registerInboxDraft} from '@/lib/inbox-navigation';
import {completionKey,readCompletions,saveCompletion,clearCompletion,retryCompletion,type SentCompletion} from "@/lib/inbox-completion";
import {attachInquiryContinuity} from "@/lib/inbox-continuity";
import {MAIL_FILE_ACCEPT,validateMailFiles,fileSize} from "@/lib/inbox-files";
import {MAX_HTML_RETRIES, type EmailHtmlResult} from '@/lib/inbox-email-content';
import {readableEmailHtml} from "@/lib/inbox-email-html";
import { applyRemoteImagePolicy } from "@/lib/inbox-image-policy";
import { mergeTranscript } from "@/lib/append-transcript";
import {
  draftReplyAction,
  getThreadHtmlAction,
  sendReplyAction,
  sendChannelReplyAction,
  findInquiryConversationsAction,
  sendNewEmailAction,
  setThreadStarredAction,
  setThreadReadAction,
  setThreadImportantAction,
  archiveThreadAction,
  restoreThreadToInboxAction,
  trashThreadAction,
  setThreadSpamAction,
  loadMoreInboxAction,
  loadLabelInboxAction,
  loadSystemViewAction,
  linkThread,
  unlinkThread,
  disconnectMyMailboxAction,
} from "@/lib/actions/inbox";
import {toast,dismissToast} from "@/components/ui/Toast";
import { runAction } from "@/lib/run-action";
import type { ThreadChannel, ThreadStatus, SystemViewKey } from "@/lib/types";
import { SYSTEM_VIEWS } from "@/lib/types";
import type {
  InboxData,
  InboxTodo,
  InboxThread,
  MailboxState,
  ThreadReader,
} from "@/lib/inbox";

import {
  INBOX_TABS,
  orderedInboxThreads, orderedAttentionThreads, attentionGroup, rowDay, canLoadMore, completionPass, attentionTaskTitle, draftGenerationResult,
  applyInboxPreferences,
  contextStripText, threadTodoCue, todoDateLabel, contextLayout,
  completeAfterSend,
  shortJobLabel,
  formatContactPhone,
  matchesInboxTab,
  tabCounts,
  shortcutFor,
  type InboxTab,
  type SavedInboxDraft,
} from "@/lib/inbox-experience";
import {reflowPlainText, draftInputSources, draftRecipientName, askExcerpt, excerptLinks, rowActionTitle, automationState, composerMode, olderOtherMail, completeMailBatch, draftReviewSize, regenerateModel, restoreForwardChoices} from '@/lib/inbox-review';
import {quickInboxReminder,undoInboxReminder} from '@/lib/actions/inbox-reminders';
import {reminderTitle} from '@/lib/inbox-review';
import {messageWorkItem,reminderDueAt} from '@/lib/inbox-experience';
import {receiptFields, useCompactReceipt} from '@/lib/inbox-receipt';
import {registerInboxFiles,confirmInboxFileLoss,flushInboxDrafts} from '@/lib/inbox-navigation';
import {swipeIntent, fileLossWarning, sourceHref} from '@/lib/inbox-round12';
import {useComposerDraft, DraftSyncFooter} from './useComposerDraft';
import {loadDrafts, dismissSuggestion} from '@/lib/actions/inbox-drafts';
import {matchingSuggestion, draftRow} from '@/lib/inbox-draft-ui';
import type {InboxDraft} from '@/lib/inbox-draft-types';
import { setInboxPreferenceAction } from "@/lib/actions/inbox-screening";
import type { InboxLinkKind } from "@/lib/inbox-directory";
import type { InboxContext } from "@/lib/inbox-context";
import { undoChannelDoneAction, markChannelDoneAction } from "@/lib/actions/inbox-experience";
import {
  ContactCreateDialog, SenderScreening,
  ContextPanel,
  LinkPicker,
  MessageTaskDialog,
  ShortcutHelp,
  ThreadSummary,
} from "./InboxPanels";

/** Views scope the source; the counted split tabs refine that source. */
type Lens =
  | { kind: "all" }
  | { kind: "inbox" }
  | { kind: "view"; view: ThreadStatus }
  | { kind: "channel"; channel: ThreadChannel }
  | { kind: "label"; id: string; name: string }
  | { kind: "system"; view: SystemViewKey }
  | { kind: "project"; slug: string; label: string };

/** Namespaced cache key for a server-fetched lens (label or system view). One
 *  slot holds whichever is open; switching keys refetches, re-clicking is a
 *  cache hit. `null` for lenses served from the already-loaded thread list. */
function remoteKeyOf(lens: Lens): string | null {
  if (lens.kind === "label") return `label:${lens.id}`;
  if (lens.kind === "system") return `system:${lens.view}`;
  return null;
}

const SYSTEM_ICON: Record<SystemViewKey, LucideIcon> = {
  unread: MailOpen,
  starred: Star,
  sent: Send,
  spam: OctagonAlert,
  trash: Trash2,
};

/** labelId for the label-scoped system views, so the client can filter the
 *  already-loaded threads as a fallback before the server-scoped fetch lands. */
const SYSTEM_LABEL_ID: Partial<Record<SystemViewKey, string>> =
  Object.fromEntries(
    SYSTEM_VIEWS.filter((v) => v.labelId).map((v) => [v.key, v.labelId!]),
  );

const CHANNEL_ICON: Record<ThreadChannel, LucideIcon> = {
  email: Mail,
  sms: MessageSquare,
  client_portal: UserRound,
  sub_portal: UserCheck,
  site_form: Globe,
};

/** Small-caps mono section label for the light-background rail. */
function RailLabel({ children }: { children: string }) {
  return (
    <div className="px-1 pb-1 pt-2 text-meta font-medium text-ink-3">
      {children}
    </div>
  );
}

const DOT_BG: Record<string, string> = {
  flag: "bg-flag",
  accent: "bg-accent",
  ghost: "bg-ink-4",
};

/** A single row in the reader's ⋮ dropdown menu. */
function MenuItem({
  icon: Icon,
  onClick,
  danger,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-2 min-h-11 px-3 py-1.5 text-left text-meta hover:bg-paper-3",
        danger ? "text-flag" : "text-ink-2",
      ].join(" ")}
    >
      <Icon className="size-3.5 flex-none" strokeWidth={1.5} />
      {children}
    </button>
  );
}

export function InboxClient({
  data,
  selfEmail,
  userId = selfEmail, owner = false,
}: {
  userId?:string; owner?:boolean;
  data: InboxData;
  /** The signed-in person's own address — the connected mailbox when there is
   *  one, else their login email. Used to scope saved drafts.
   *  Was `ownerEmail`, which handed Joe's address to every staff login. */
  selfEmail: string;
}) {
  const [lens, setLens] = useState<Lens>({ kind: "all" });
  const [tab, setTab] = useState<InboxTab | null>("needs");
  const [query, setQuery] = useState("");
  const [phoneSearch,setPhoneSearch]=useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState<"person" | "job" | null>(null);
  const [linking, setLinking] = useState(false);
  const [screeningThread,setScreeningThread]=useState<InboxThread|null>(null);
  const [adding,setAdding]=useState<{thread:InboxThread;kind:'lead'|'sub'|'vendor'}|null>(null);
  const [contextError,setContextError]=useState("");
  const [contextResult,setContextResult]=useState<{key:string;data:InboxContext|null;pending:boolean}|null>(null);
  const contextCache=useRef(new Map<string,InboxContext>());
  const [contextRefresh,setContextRefresh]=useState(0);
  const [wideContext,setWideContext]=useState(false);
  const [compactList,setCompactList]=useState(false);
  const [contextWidths,setContextWidths]=useState({listWidth:240,panelWidth:274});
  const [passFinished,setPassFinished]=useState(false);
  const [passCompleted,setPassCompleted]=useState<Set<string>>(new Set());
  const [contextPreference,setContextPreference]=useState(true);
  const tabsRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{try{setContextPreference(localStorage.getItem('sjc:inbox:context')!=='closed');}catch{}},[]);
  useEffect(()=>{
    const root=rootRef.current;
    if(!root)return;
    const observer=new ResizeObserver(([entry])=>{
      const layout=contextLayout(entry.contentRect.width);
      setWideContext(layout.docked);setCompactList(layout.compact);setContextWidths(layout);
    });
    observer.observe(root);return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{tabsRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});},[tab]);
  function closeContext(){setContext(null);if(wideContext){setContextPreference(false);try{localStorage.setItem('sjc:inbox:context','closed');}catch{}}}
  function openContext(){setContext('job');if(wideContext){setContextPreference(true);try{localStorage.setItem('sjc:inbox:context','open');}catch{}}}

  const [task, setTask] = useState<{
    thread: InboxThread;
    remind: boolean; anchor?:HTMLElement|null;
  } | null>(null);
  function openTask(thread:InboxThread,remind:boolean,anchor?:HTMLElement|null){
    const focused=typeof document!=='undefined'?document.activeElement as HTMLElement|null:null;
    setTask({thread,remind,anchor:anchor??(focused?.tagName==='BUTTON'?focused:rootRef.current?.querySelector<HTMLElement>('[data-task-anchor]'))});
  }
  const [help, setHelp] = useState(false);
  const [selectedId, setSelectedId] = useState(data.selectedId);
  // Mobile master/detail: below lg, show the thread list OR the reader, not both.
  const router = useRouter();
  const leaveInbox=(navigate:()=>void)=>guardInboxNavigation(navigate,()=>setNotice('Draft not synced yet. Resolve its save or conflict before leaving.'));
  useEffect(()=>{
    const follow=(event:MouseEvent)=>{
      if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const link=(event.target as Element|null)?.closest?.('a[href]') as HTMLAnchorElement|null;
      if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
      const url=new URL(link.href,window.location.href);
      if(url.origin!==window.location.origin||url.pathname.startsWith('/api/')||url.pathname===window.location.pathname&&url.search===window.location.search)return;
      event.preventDefault();event.stopPropagation();void leaveInbox(()=>router.push(url.pathname+url.search+url.hash));
    };
    document.addEventListener('click',follow,true);return()=>document.removeEventListener('click',follow,true);
  },[router]);

  const [mobileReader, setMobileReader] = useState(false);
  const [showSources, setShowSources] = useState(false);
  useEffect(()=>{
    const search=()=>{setPhoneSearch(true);setMobileReader(false);requestAnimationFrame(()=>searchRef.current?.focus());};
    const compose=()=>{if(data.mailbox.connected)setComposing(true);else setNotice('Connect your email before composing.');};
    const views=()=>setShowSources(v=>!v);
    window.addEventListener('inbox-views',views);window.addEventListener('inbox-search',search);window.addEventListener('inbox-compose',compose);
    return()=>{window.removeEventListener('inbox-views',views);window.removeEventListener('inbox-search',search);window.removeEventListener('inbox-compose',compose);};
  },[data.mailbox.connected]);
  const [splitSheet,setSplitSheet]=useState(false);
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("sjc:inbox-surface", {
        detail: Boolean(mobileReader || task || help || linking || context || composing),
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("sjc:inbox-surface", { detail: false }),
      );
    };
  }, [mobileReader, task, help, linking, context, composing]);
  // Threads/readers grow as "Load more" pages in from Gmail.
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set());
  const onDraftReady = useCallback(
    (id: string, ready: boolean) =>
      setDraftIds((previous) => {
        if (previous.has(id) === ready) return previous;
        const next = new Set(previous);
        if (ready) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const [threads, setThreads] = useState(data.threads);
  const [preferences,setPreferences]=useState<Record<string,string|null>>({});
  const [readers, setReaders] = useState(data.readers);
  const [pageToken, setPageToken] = useState(data.nextPageToken);
  const [pagePausedAt, setPagePausedAt] = useState<number | null>(null);
  // Follow the server's first page: a refresh (LiveUpdates, or an action's own
  // revalidate) re-reads Gmail — new mail, read state, links. Plain useState
  // kept the first render forever, so counts and the list went stale. Pages
  // pulled in with "Load more" stay after it; render-phase adjustment, as in
  // lib/use-server-state.ts.
  const serverJson = JSON.stringify([
    data.threads,
    data.readers,
    data.lastSyncedAt,
    data.emailPaused,
  ]);
  const [seenServer, setSeenServer] = useState({
    json: serverJson,
    ids: data.threads.map((t) => t.id),
    token: data.nextPageToken,
  });
  if (serverJson !== seenServer.json) {
    const oldFirst = new Set(seenServer.ids);
    const fresh = new Set(data.threads.map((t) => t.id));
    setSeenServer({
      json: serverJson,
      ids: [...fresh],
      token: data.nextPageToken,
    });
    if (!data.emailPaused) setPagePausedAt(null);
    setThreads((prev) => [
      ...data.threads,
      ...prev.filter((t) => !oldFirst.has(t.id) && !fresh.has(t.id)),
    ]);
    setReaders((prev) => ({ ...prev, ...data.readers }));
    // Nothing paged in past the first page yet — the next page starts after the new one.
    if (pageToken === seenServer.token) setPageToken(data.nextPageToken);
  }
  const [loadingMore, setLoadingMore] = useState(false);
  // Label + system-view lists are fetched server-side (scoped to that Gmail
  // label / mailbox) so they show the full mail, not just whatever paged into
  // the inbox window. One slot, namespaced by remoteKeyOf; null until opened.
  const [remoteData, setRemoteData] = useState<{
    key: string;
    threads: InboxThread[];
    pageToken?: string;
    emailPaused?: boolean;
    lastSyncedAt?: number;
  } | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreButtonRef=useRef<HTMLButtonElement>(null);
  const [sentCompletions,setSentCompletions]=useState<SentCompletion[]>([]);
  useEffect(()=>{
    const refresh=()=>{try{setSentCompletions(readCompletions(localStorage,completionKey(selfEmail)));}catch{setSentCompletions([]);}};
    refresh();window.addEventListener('inbox-completion-changed',refresh);window.addEventListener('storage',refresh);
    return ()=>{window.removeEventListener('inbox-completion-changed',refresh);window.removeEventListener('storage',refresh);};
  },[selfEmail]);
  async function retrySentCompletion(receipt:SentCompletion){
    const r=await retryCompletion(localStorage,completionKey(selfEmail),receipt,async saved=>saved.channel==='email'?archiveThreadAction(saved.threadId):markChannelDoneAction(saved.threadId,saved.through));
    completionChanged();if(!r.ok)setNotice("Sent — couldn't mark done. Try again.");else{setNotice('Marked done. The message stays sent.');router.refresh();}
  }
  const [notice, setNotice] = useState<string | null>(null);
  const [undo,setUndo]=useState<{label:string;run:()=>Promise<void>}|null>(null);
  // Optimistic star state, keyed by thread id, until the revalidate lands.
  const [starOverride, setStarOverride] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();
  useEffect(()=>{
    if(!undo)return;
    const id=toast({kind:'success',message:'Inbox updated.',sticky:15000,action:{label:undo.label,onClick:()=>startTransition(undo.run)}});
    return ()=>dismissToast(id);
  },[undo]);

  const [serverDrafts,setServerDrafts]=useState<{key:string;rows:InboxDraft[]}>({key:'',rows:[]});
  // One batch per loaded window (the action accepts at most 200 keys), never per row.
  const draftWindow=JSON.stringify([...new Set([...threads,...(remoteData?.threads??[])].map(t=>t.id))].sort());
  const draftScope=JSON.stringify([selfEmail,userId,owner,draftWindow]);
  useEffect(()=>{
    let alive=true,loading=false;
    const refresh=async()=>{
      if(loading)return;loading=true;
      try{
        const keys:string[]=JSON.parse(draftWindow),rows:InboxDraft[]=[];
        for(let offset=0;offset<keys.length;offset+=200){
          rows.push(...await loadDrafts(keys.slice(offset,offset+200)));
          if(!alive)return;
        }
        if(alive)setServerDrafts({key:draftScope,rows});
      }
      catch{/* Retain the last successful batch during an outage. */}finally{loading=false;}
    };
    void refresh();const timer=window.setInterval(()=>void refresh(),20_000);
    window.addEventListener('focus',refresh);window.addEventListener('inbox-drafts-changed',refresh);
    return()=>{alive=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('inbox-drafts-changed',refresh);};
  },[draftWindow,draftScope]);
  const suggestions=useMemo(()=>new Map([...threads,...(remoteData?.threads??[])].flatMap(t=>{
    const suggestion=matchingSuggestion(serverDrafts.key===draftScope?serverDrafts.rows:[],t.id,readers[t.id],owner);
    return suggestion&&t.view!=='done'&&!t.automated&&!t.filedOther&&!t.newSender?[[t.id,suggestion] as const]:[];
  })),[threads,remoteData,readers,owner,serverDrafts,draftScope]);
  const readyIds=useMemo(()=>new Set([...threads,...(remoteData?.threads??[])].filter(t=>t.view!=='done'&&(draftIds.has(t.id)||suggestions.has(t.id))).map(t=>t.id)),[threads,remoteData,draftIds,suggestions]);

  useEffect(()=>setPreferences({}),[selfEmail]);
  async function savePreference(thread:InboxThread,kind:'sender'|'thread',decision:string|null, offerUndo=true) {
    const target=kind==='sender'?thread.fromEmail:thread.id;if(!target)return false;
    const r=await runAction(()=>setInboxPreferenceAction(kind,target,decision),{fallback:'Could not save your decision.'});
    if(!r.ok){setNotice(r.error??'Could not save your decision.');return false;}
    setPreferences(p=>({...p,[`${kind}:${kind==='sender'?target.toLowerCase():target}`]:decision}));
    if(offerUndo){
      setNotice(decision==='blocked'?'Sender blocked. Future mail files to Other.':decision==='other'?'Filed in Other.':'Screening decision saved.');
      setUndo({label:decision==='blocked'?'Undo block':'Undo filing',run:async()=>{if(await savePreference(thread,kind,r.previous??null,false)){setNotice('Decision undone.');setUndo(null);}}});
    }
    router.refresh();return true;
  }
  function fileSender(thread:InboxThread,other:boolean){startTransition(async()=>{await savePreference(thread,'sender',other?'other':null);});}
  function blockSender(thread:InboxThread){startTransition(async()=>{await savePreference(thread,'sender','blocked');});}
  function reportSpam(thread:InboxThread){
    setMenuOpen(false);
    startTransition(async()=>{
      const result=await runAction(()=>setThreadSpamAction(thread.id,true),{fallback:'Could not report spam.'});
      if(!result.ok){setNotice(result.error??'Could not report spam.');return;}
      setThreads(ts=>ts.filter(t=>t.id!==thread.id));setRemoteData(d=>d?{...d,threads:d.threads.filter(t=>t.id!==thread.id)}:d);
      setNotice('Reported as spam.');
      setUndo({label:'Undo spam',run:async()=>{
        const restored=await runAction(()=>setThreadSpamAction(thread.id,false,Boolean(thread.inInbox)),{fallback:'Could not undo spam.'});
        if(!restored.ok){setNotice(restored.error??'Could not undo spam.');return;}
        setThreads(ts=>[thread,...ts.filter(t=>t.id!==thread.id)]);setRemoteData(d=>d&&d.key===remoteData?.key?{...d,threads:[thread,...d.threads.filter(t=>t.id!==thread.id)]}:d);setUndo(null);setNotice('Spam report undone.');router.refresh();
      }});
      router.refresh();
    });
  }


  // Threads under the current lens, before the audience filter is applied.
  const sourceVisible = useMemo(() => {
    switch (lens.kind) {
      case "all":
        return threads;
      case "inbox":
        return threads.filter((t) =>
          t.channel === "email" ? t.inInbox : t.view !== "done",
        );
      case "view":
        return threads.filter(
          (t) =>
            t.view === lens.view ||
            (lens.view === "needs_reply" && readyIds.has(t.id)),
        );
      case "channel":
        return threads.filter((t) => t.channel === lens.channel);
      case "label": {
        // Prefer the server-fetched, label-scoped list once it's loaded; until
        // then (or if it fails) fall back to client-filtering the loaded inbox.
        const key = `label:${lens.id}`;
        return remoteData?.key === key
          ? remoteData.threads
          : threads.filter((t) => (t.labelIds ?? []).includes(lens.id));
      }
      case "system": {
        // Prefer the server-fetched mailbox page once it lands. Before then,
        // fall back to filtering loaded threads by the view's system label
        // (Unread/Starred/Sent); Spam/Trash have no local match, so show
        // nothing until the fetch returns (the loading state covers the gap).
        const key = `system:${lens.view}`;
        if (remoteData?.key === key) return remoteData.threads;
        const labelId = SYSTEM_LABEL_ID[lens.view];
        return labelId
          ? threads.filter((t) => (t.labelIds ?? []).includes(labelId))
          : [];
      }
      case "project":
        return threads.filter((t) => t.projectSlug === lens.slug);
    }
  }, [threads, lens, remoteData, readyIds]);

  const baseVisible=useMemo(()=>sourceVisible.map(t=>applyInboxPreferences(t,preferences)),[sourceVisible,preferences]);

  const visible = useMemo(() => {
    const rows=baseVisible.filter(t =>
      !passCompleted.has(t.id) && (!tab || matchesInboxTab(t,tab,readyIds.has(t.id))) &&
      `${t.fromName} ${t.fromEmail??""} ${t.subject} ${t.preview} ${t.projectLabel??""}`.toLowerCase().includes(query.toLowerCase())
    ).filter((t,i,all)=>tab!=='new'||all.findIndex(other=>other.fromEmail?.toLowerCase()===t.fromEmail?.toLowerCase())===i);
    return tab==='needs'?orderedAttentionThreads(rows,readyIds):orderedInboxThreads(rows);
  },[baseVisible,tab,readyIds,query,passCompleted]);
  // Count of threads sitting in the Gmail inbox (the plain "Inbox" rail view).
  const inboxCount = useMemo(
    () => threads.filter((t) => t.inInbox).length,
    [threads],
  );

  const counts = useMemo(
    () => tabCounts(baseVisible, readyIds),
    [baseVisible, readyIds],
  );
  const globalNeedsCount=tabCounts(threads.map(t=>applyInboxPreferences(t,preferences)),readyIds).needs;
  useEffect(()=>{
    rememberNeedsCount(selfEmail,globalNeedsCount);
    window.dispatchEvent(new CustomEvent('sjc:inbox-needs-count',{detail:globalNeedsCount}));
  },[selfEmail,globalNeedsCount]);
  useEffect(()=>{setPassFinished(false);setPassCompleted(new Set());},[lens,tab,query]);
  // Keep the selection valid as the lens narrows the list.
  const selectedRaw = passFinished ? null : visible.find((t) => t.id === selectedId) ?? visible[0] ?? null;
  const selected=selectedRaw?draftRow(selectedRaw,suggestions.get(selectedRaw.id)):null;
  const continuityReaders=useMemo(()=>{
    const copy=Object.fromEntries(Object.entries(readers).map(([id,r])=>[id,{...r,...(r.form?{form:{...r.form}}:{})}]));
    attachInquiryContinuity([...threads,...(remoteData?.threads ?? [])].map(t=>({...t})),copy);return copy;
  },[readers,threads,remoteData]);
  const reader = selected ? continuityReaders[selected.id] : undefined;
  function openConversation(id:string){void leaveInbox(()=>{setLens({kind:'all'});setTab(null);setQuery('');setSelectedId(id);setMobileReader(true);});}
  const contextKey=`${selfEmail}:${selected?.id??''}`;
  const contextData=contextResult?.key===contextKey?contextResult.data:null;
  useEffect(()=>{
    let active=true;
    setContextError('');
    if(!selected){setContextResult(null);return;}
    const key=contextKey;
    setContextResult({key,data:contextCache.current.get(key) ?? null,pending:true});
    // A queued server action used to leave the wide panel in Loading forever.
    // Keep the last successful result and always give a stalled request a retry.
    const controller=new AbortController();
    const timeout=setTimeout(()=>{if(active){active=false;controller.abort();setContextResult(r=>r?{...r,pending:false}:r);setContextError('Context is taking too long. Try again.');}},12000);
    const params=new URLSearchParams({threadId:selected?.id??''});
    if(selected?.fromEmail)params.set('email',selected.fromEmail);
    if(selected?.contactKey)params.set('contactKey',selected.contactKey);
    if(selected?.projectSlug)params.set('projectSlug',selected.projectSlug);
    if(selected?.linkedType==='lead'&&selected.linkedSlug)params.set('leadSlug',selected.linkedSlug);
    if(selected)fetch(`/api/inbox/context?${params}`,{cache:'no-store',signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error('Context unavailable');
      return await response.json() as InboxContext;
    }).then(d=>{
      if(active){contextCache.current.set(key,d);if(contextCache.current.size>50)contextCache.current.delete(contextCache.current.keys().next().value!);setContextResult({key,data:d,pending:false});clearTimeout(timeout);}
    }).catch(()=>{if(active){setContextResult(r=>r?{...r,pending:false}:r);setContextError('Could not load context. Try again.');clearTimeout(timeout);}});
    return ()=>{active=false;controller.abort();clearTimeout(timeout);};
  },[selected?.id,selected?.projectSlug,selected?.linkedSlug,selected?.contactKey,contextRefresh,selfEmail]);
  // Email gets its mailbox controls; every channel has its own reply adapter.
  const readerIsEmail = (reader?.channel ?? "email") === "email";

  const linkOptions = data.linkOptions;
  const linkTarget=screeningThread??selected;
  const currentLink =
    linkTarget?.linkedType && linkTarget?.linkedSlug
      ? `${linkTarget.linkedType}:${linkTarget.linkedSlug}`
      : "";

  // A shared link is stored through the existing inbox link action on every channel.
  function relink(next: string) {
    if (!linkTarget) return;
    const target=linkTarget;
    const id = target.id;
    const previousLink=currentLink;
    const [type, slug] = next.split(":") as [InboxLinkKind, string];
    const option = (
      type === "project" ? linkOptions?.projects : linkOptions?.leads
    )?.find((o) => o.slug === slug);
    startTransition(async () => {
      const r = await runAction(
        () => (next ? linkThread(id, type, slug) : unlinkThread(id)),
        { fallback: "Could not link this conversation." },
      );
      if (!r.ok) {
        setNotice(r.error ?? "Could not link this conversation.");
        return;
      }
      if(next && target.fromEmail){
        const screened=await savePreference(target,'sender','linked',false);
        setNotice(screened?'Sender linked.':"Linked to the job; couldn't save the screening decision.");
        setUndo({label:'Undo',run:async()=>{
          const [oldType,oldSlug]=previousLink.split(':') as [InboxLinkKind,string];
          const result=await runAction(()=>previousLink?linkThread(id,oldType,oldSlug):unlinkThread(id),{fallback:'Could not undo link.'});
          if(result.ok){if(await savePreference(target,'sender',target.senderDecision??'pending',false)){setNotice('Link undone.');setUndo(null);}router.refresh();}else setNotice(result.error??'Could not undo link.');
        }});
      }
      setScreeningThread(null);
      const patch = (t: InboxThread): InboxThread =>
        t.id !== id
          ? t
          : {
              ...t,
              linkedType: next ? type : undefined,
              linkedSlug: next ? slug : undefined,
              projectSlug: next && type === "project" ? slug : undefined,
              projectLabel: option?.name,
              contactStage: option?.stage,
              contactKey: next && (type==="sub"||type==="vendor")?`${type}:${slug}`:t.contactKey,
              contactRole: next?(type==="project"?"client":type):t.contactRole,
              audience: next?(type==="sub"?"sub":type==="vendor"?"money":"client"):t.audience,
              newSender: next ? false : t.newSender,
            };
      setThreads((ts) => ts.map(patch));
      setRemoteData((d) => (d ? { ...d, threads: d.threads.map(patch) } : d));
      router.refresh();
    });
  }

  // Open a server-fetched lens (a Gmail label or a system mailbox): fetch its
  // mail scoped server-side, with its own pagination. Re-clicking the open one
  // is a no-op (cache stays); switching keys refetches.
  const fetchRemote = (
    key: string,
    loader: () => Promise<{
      ok: boolean;
      threads?: InboxThread[];
      readers?: Record<string, ThreadReader>;
      nextPageToken?: string;
      emailPaused?: boolean;
      lastSyncedAt?: number;
      error?: string;
    }>,
    force = false,
  ) => {
    if (!force && remoteData?.key === key) return;
    if (remoteData?.key !== key) setRemoteData(null);
    setNotice(null);
    setRemoteLoading(true);
    startTransition(async () => {
      const r = await runAction(loader, {
        fallback: "Couldn't load that view.",
      });
      if (r.ok && r.threads) {
        setReaders((prev) => ({ ...prev, ...(r.readers ?? {}) }));
        setRemoteData({
          key,
          threads: r.threads,
          pageToken: r.nextPageToken,
          emailPaused: r.emailPaused,
          lastSyncedAt: r.lastSyncedAt,
        });
      } else if (!r.ok) {
        setNotice(r.error ?? "Couldn't load that view.");
      }
      setRemoteLoading(false);
    });
  };

  const selectLabel = (id: string, name: string) => {void leaveInbox(()=>{
    setLens({ kind: "label", id, name });setTab(null);
    fetchRemote(`label:${id}`, () => loadLabelInboxAction(id));
  });};

  const selectSystem = (view: SystemViewKey) => {void leaveInbox(()=>{
    setLens({ kind: "system", view });setTab(null);
    fetchRemote(`system:${view}`, () => loadSystemViewAction(view));
  });};

  const remoteKey = remoteKeyOf(lens);
  const onRemote = remoteKey !== null && remoteData?.key === remoteKey;
  const remotePaused = onRemote && remoteData?.emailPaused;
  const emailPaused = data.emailPaused || remotePaused || pagePausedAt !== null;
  const lastSyncedAt = remotePaused
    ? remoteData?.lastSyncedAt
    : (pagePausedAt ?? data.lastSyncedAt);
  const retryEmail = () => {
    if (lens.kind === "label")
      fetchRemote(
        `label:${lens.id}`,
        () => loadLabelInboxAction(lens.id),
        true,
      );
    else if (lens.kind === "system")
      fetchRemote(
        `system:${lens.view}`,
        () => loadSystemViewAction(lens.view),
        true,
      );
    router.refresh();
  };
  // "Load more" pages within the open remote lens when one is selected, else the
  // main inbox.
  const moreToken = onRemote ? remoteData?.pageToken : remoteKey ? undefined : pageToken;
  const showLoadMore=canLoadMore({token:moreToken,lens:lens.kind,channel:lens.kind==='channel'?lens.channel:undefined,remoteReady:onRemote,tab,visibleCount:visible.length,knownTotal:tab?counts[tab]:undefined});

  const loadMore = () => {
    if (!moreToken || loadingMore) return;
    setLoadingMore(true);
    startTransition(async () => {
      const r = await runAction(
        () =>
          onRemote
            ? lens.kind === "label"
              ? loadLabelInboxAction(lens.id, moreToken)
              : loadSystemViewAction(
                  (lens as { view: SystemViewKey }).view,
                  moreToken,
                )
            : loadMoreInboxAction(moreToken),
        { fallback: "Couldn't load more." },
      );
      if (r.ok && r.threads) {
        setPagePausedAt(
          r.emailPaused ? (r.lastSyncedAt ?? data.lastSyncedAt ?? 0) : null,
        );
        setReaders((prev) => ({ ...prev, ...(r.readers ?? {}) }));
        if (onRemote) {
          setRemoteData((prev) =>
            prev
              ? {
                  ...prev,
                  threads: [
                    ...prev.threads,
                    ...r.threads!.filter(
                      (t) => !prev.threads.some((p) => p.id === t.id),
                    ),
                  ],
                  pageToken: r.nextPageToken,
                  emailPaused: r.emailPaused,
                  lastSyncedAt: r.lastSyncedAt,
                }
              : prev,
          );
        } else {
          // Append only genuinely new threads (guard against overlap).
          setThreads((prev) => {
            const seen = new Set(prev.map((t) => t.id));
            return [...prev, ...r.threads!.filter((t) => !seen.has(t.id))];
          });
          setPageToken(r.nextPageToken);
        }
      } else if (!r.ok) {
        setNotice(r.error ?? "Couldn't load more.");
      }
      setLoadingMore(false);
    });
  };

  const lensLabel =
    lens.kind === "all"
      ? "All conversations"
      : lens.kind === "inbox"
        ? "Inbox"
        : lens.kind === "view"
          ? (data.smartViews.find((v) => v.key === lens.view)?.label ?? "Inbox")
          : lens.kind === "channel"
            ? (data.channels.find((c) => c.key === lens.channel)?.label ??
              "Channel")
            : lens.kind === "project"
              ? lens.label
              : lens.kind === "system"
                ? (SYSTEM_VIEWS.find((v) => v.key === lens.view)?.label ??
                  "Mailbox")
                : lens.name;
  const headerLabel = tab
    ? `${INBOX_TABS.find((t) => t.value === tab)?.label}${lens.kind === "all" ? "" : ` · ${lensLabel}`}`
    : lensLabel;
  const isInbox = lens.kind === "inbox";
  const isView = (k: ThreadStatus) => lens.kind === "view" && lens.view === k;
  const isChannel = (k: ThreadChannel) =>
    lens.kind === "channel" && lens.channel === k;
  const isLabel = (id: string) => lens.kind === "label" && lens.id === id;
  const isSystem = (k: SystemViewKey) =>
    lens.kind === "system" && lens.view === k;
  const isProject = (slug: string) =>
    lens.kind === "project" && lens.slug === slug;

  const selectedStarred = selected
    ? (starOverride[selected.id] ?? selected.starred ?? false)
    : false;

  // Run a Gmail mutation; surface a plain-language notice if it fails (the
  // usual cause is the modify scope not yet granted).
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setNotice(null);
      const r = await runAction(fn, {
        fallback: "Couldn't complete that action.",
      });
      if (!r.ok) setNotice(r.error ?? "Couldn't complete that action.");
    });

  const toggleStar = () => {
    if (!selected) return;
    const next = !selectedStarred;
    setStarOverride((m) => ({ ...m, [selected.id]: next }));
    run(() => setThreadStarredAction(selected.id, next));
  };

  const menuAction = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setMenuOpen(false);
    run(fn);
  };

  // Mark read/unread, optimistically: flip the row's bold treatment (and its
  // UNREAD label, so the Unread mailbox filter agrees) before Gmail confirms.
  const setReadSelected = (read: boolean) => {
    if (!selected) return;
    const id = selected.id;
    const patch = (t: InboxThread): InboxThread => {
      if (t.id !== id) return t;
      const labelIds = read
        ? t.labelIds?.filter((l) => l !== "UNREAD")
        : t.labelIds?.includes("UNREAD")
          ? t.labelIds
          : [...(t.labelIds ?? []), "UNREAD"];
      return { ...t, unread: !read, labelIds };
    };
    setThreads((ts) => ts.map(patch));
    setRemoteData((prev) =>
      prev ? { ...prev, threads: prev.threads.map(patch) } : prev,
    );
    menuAction(() => setThreadReadAction(id, read));
  };

  // Confirm the existing archive/handled path before updating the visible list.
  async function doneThread(t: InboxThread, sent=false) {
    if(!sent){if(!await flushInboxDrafts()){setNotice('Save or resolve the draft before marking done.');return {ok:false,error:'Draft not saved.'};}if(!confirmInboxFileLoss())return {ok:false,error:'Kept the draft open.'};}
    const previousView={lens,tab,query,selectedId,mobileReader};
    const r=await runAction(()=>t.channel==='email'?archiveThreadAction(t.id):markChannelDoneAction(t.id,readers[t.id]?.messages.at(-1)?.date??0),{fallback:'Could not mark done.'});
    if(!r.ok){setNotice(sent?"Sent — couldn't mark done":r.error??'Could not mark done.');return r;}
    const queue=completionPass(visible,t.id);
    const next=queue.next;
    const patch=(v:InboxThread)=>v.id===t.id?{...v,inInbox:false,view:'done' as const,needsMeReason:undefined,newSender:false}:v;
    setThreads(ts=>[...new Map([...ts,...(remoteData?.threads??[])].map(v=>[v.id,patch(v)])).values()]);setRemoteData(d=>d?{...d,threads:d.threads.map(patch)}:d);
    setDraftIds(ids=>new Set([...ids].filter(id=>id!==t.id)));
    setPassCompleted(ids=>new Set([...ids,t.id]));setSelectedId(next?.id??'');setMobileReader(Boolean(next));setPassFinished(!next);
    setNotice(`${sent?'Sent and marked done.':'Marked done.'} ${queue.left} left in this pass.`);
    setUndo({label:sent?'Undo Done — the message stays sent.':'Undo Done',run:async()=>{
      const result=await runAction(()=>t.channel==='email'?restoreThreadToInboxAction(t.id):undoChannelDoneAction(t.id),{fallback:'Could not undo Done.'});
      if(result.ok){setThreads(ts=>ts.map(v=>v.id===t.id?t:v));setRemoteData(d=>d?{...d,threads:d.threads.map(v=>v.id===t.id?t:v)}:d);setNotice('Done undone.');setPassCompleted(ids=>new Set([...ids].filter(id=>id!==t.id)));setPassFinished(false);setUndo(null);setLens(previousView.lens);setTab(previousView.tab);setQuery(previousView.query);setSelectedId(previousView.selectedId||t.id);setMobileReader(previousView.mobileReader);router.refresh();}else setNotice(result.error??'Could not undo Done.');
    }});
    router.refresh();return {ok:true};
  }
  function remindTomorrow(t:InboxThread){
    const r=readers[t.id];if(!r||pending)return;
    startTransition(async()=>{
      const result=await runAction(()=>quickInboxReminder(messageWorkItem(t,r,{title:reminderTitle(t),dueAt:reminderDueAt('tomorrow')})),{fallback:'Could not set the reminder.'});
      if(!result.ok){setNotice(result.error??'Could not set the reminder.');return;}
      setNotice('To-do set for tomorrow 8 AM Central. It enters Today at midnight; the conversation stays in your inbox.');
      if('undo' in result&&result.undo){const receipt=result.undo;setUndo({label:'Undo reminder',run:async()=>{
        const undone=await runAction(()=>undoInboxReminder(receipt),{fallback:'Could not undo the reminder.'});
        if(undone.ok){setNotice('Reminder undone.');setUndo(null);router.refresh();}else setNotice(undone.error??'Could not undo the reminder.');
      }});}
      contextCache.current.clear();setContextRefresh(n=>n+1);router.refresh();
    });
  }
  function markOtherDone(){
    const candidates=olderOtherMail(visible);
    startTransition(async()=>{
      const result=await completeMailBatch(candidates,archiveThreadAction);
      const ids=new Set(result.completed.map(t=>t.id));
      const patch=(t:InboxThread)=>ids.has(t.id)?{...t,inInbox:false,view:'done' as const,needsMeReason:undefined}:t;
      setThreads(ts=>ts.map(patch));setRemoteData(d=>d?{...d,threads:d.threads.map(patch)}:d);
      setPassCompleted(prev=>new Set([...prev,...ids]));
      if(ids.has(selectedId))setSelectedId(visible.find(t=>!ids.has(t.id))?.id??'');
      setNotice(`${result.completed.length} older automated messages marked done.${result.failed.length?` ${result.failed.length} could not be archived; try again.`:''}`);
      if(result.completed.length){
        const remaining=new Map(result.completed.map(t=>[t.id,t]));
        setUndo({label:'Undo mark all as done',run:async()=>{
          const restored=await completeMailBatch([...remaining.values()],restoreThreadToInboxAction);
          const originals=new Map(restored.completed.map(t=>[t.id,t]));
          restored.completed.forEach(t=>remaining.delete(t.id));
          setThreads(ts=>ts.map(t=>originals.get(t.id)??t));setRemoteData(d=>d?{...d,threads:d.threads.map(t=>originals.get(t.id)??t)}:d);
          setPassCompleted(prev=>new Set([...prev].filter(id=>!originals.has(id))));
          setNotice(restored.failed.length?`${restored.completed.length} restored. Undo failed for ${restored.failed.length}; try Undo again.`:'Archive older automated mail undone.');
          if(!remaining.size)setUndo(null);router.refresh();
        }});
      }
      router.refresh();
    });
  }
  const archiveSelected = () => {
    if (selected) startTransition(async()=>{await doneThread(selected);});
  };
  function navigate(delta: number) {
    const i = visible.findIndex((t) => t.id === selected?.id);
    const t = visible[Math.max(0, Math.min(visible.length - 1, i + delta))];
    if (t) {
      void leaveInbox(()=>{setSelectedId(t.id);
      rootRef.current
        ?.querySelector<HTMLElement>(`[data-thread-row="${CSS.escape(t.id)}"]`)
        ?.scrollIntoView({ block: "nearest" });});
    }
  }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (e.key === "Escape") {
        setMenuOpen(false);
        setShowSources(false);
        setSplitSheet(false);
        closeContext();
        return;
      }
      if(e.key==='H'&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!el.isContentEditable&&!el.closest('input,textarea,select,[role="dialog"],[role="menu"]')&&!task&&!composing&&!pending&&selected){e.preventDefault();remindTomorrow(selected);return;}
      const action = shortcutFor({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        tagName: el.tagName,
        listRow: Boolean(el.closest("[data-thread-row]")),
        editable: el.isContentEditable,
        inDialog:
          Boolean(el.closest('[role="dialog"],[role="menu"]')) ||
          help ||
          linking ||
          Boolean(task) ||
          composing ||
          splitSheet ||
          showSources ||
          menuOpen ||
          pending,
      });
      if (!action) return;
      e.preventDefault();
      if (action === "next") navigate(1);
      else if (action === "previous") navigate(-1);
      else if (action === "open") setMobileReader(true);
      else if (action === "done") archiveSelected();
      else if (action === "remind" && selected)
        openTask(selected,true);
      else if (action === "link") setLinking(true);
      else if (action === "search") {
        setMobileReader(false);
        setPhoneSearch(true);requestAnimationFrame(()=>searchRef.current?.focus());
      } else if (action === "help") setHelp(true);
      else if (action === "reply") {
        setMobileReader(true);
        rootRef.current?.dispatchEvent(new Event("inbox-reply"));
      } else if (action === "approve")
        rootRef.current?.dispatchEvent(new Event("inbox-approve"));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div
      ref={rootRef}
      data-inbox-root
      className="relative flex h-full min-h-0 flex-col [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-focus [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-focus"
    >
      <div
        className={`${mobileReader ? "hidden @4xl/page:flex" : "flex"} ${phoneSearch?"":"@max-[40rem]/page:!hidden"} min-h-12 flex-none flex-wrap items-center gap-2 border-b border-rule bg-paper px-3 py-1 @4xl/page:flex-nowrap`}
      >
        <Button
          onClick={() => setShowSources((v) => !v)}
          variant="ghost"
          icon={Filter}
          aria-expanded={showSources}
          className="@max-[40rem]/page:hidden min-h-11 @4xl/page:min-h-8"
        >
          Views
        </Button>
        <div ref={tabsRef} title="Counts are loaded conversations" className="hidden @4xl/page:block order-last w-full min-w-0 overflow-x-auto [mask-image:linear-gradient(to_right,black_94%,transparent)] @4xl/page:order-none @4xl/page:w-auto @4xl/page:flex-1">
          <Segmented
            aria-label="Inbox splits · loaded conversations"
            value={tab ?? ""}
            onChange={(v) => {void leaveInbox(()=>{
              setTab(v as InboxTab);setMobileReader(false);
            });}}
            options={INBOX_TABS.map((t) => ({
              ...t,
              count: emailPaused ? "—" : counts[t.value],
            }))}
            className="w-max !max-w-none !overflow-visible h-11 [&_button]:shrink-0 [&_button]:h-11 @4xl/page:h-8 @4xl/page:[&_button]:h-7"
          />
        </div>

        <label className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-rule bg-card px-2 @4xl/page:min-h-8 @4xl/page:w-28 @4xl/page:flex-none">
          <Search className="size-3.5 shrink-0 text-ink-3" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {const value=e.target.value;void leaveInbox(()=>setQuery(value));}}
            aria-label="Search inbox"
            placeholder="Search"
            className="w-full min-w-0 bg-transparent text-body outline-none"
          />
        </label>
        <Button
          onClick={() => setHelp(true)}
          icon={Keyboard}
          iconOnly
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          className="hidden @5xl/page:inline-flex"
        />
        {phoneSearch&&<Button className="@min-[40rem]/page:hidden" variant="ghost" onClick={()=>{setPhoneSearch(false);setQuery('');}}>Cancel</Button>}
        {data.mailbox.connected && (
          <Button
            onClick={() => setComposing(true)}
            icon={PenSquare}
            className="@max-[40rem]/page:hidden min-h-11 @4xl/page:min-h-8"
          >
            Compose
          </Button>
        )}
      </div>
      {sentCompletions.map(receipt=><div key={receipt.threadId} role="status" className="flex flex-wrap items-center gap-2 border-b border-warn/20 bg-warn-soft px-3 py-2 text-meta"><span className="min-w-0 flex-1 break-words">Sent — couldn’t mark done · {receipt.recipient} · {receipt.channel.replaceAll('_',' ')} · {new Date(receipt.sentAt).toLocaleString('en-US')}</span><Button variant="secondary" disabled={pending} onClick={()=>startTransition(()=>retrySentCompletion(receipt))}>Retry</Button></div>)}
      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-rule bg-paper-2 px-4 py-2 text-meta text-ink-2"
        >
          <span className="flex-1">{notice}</span>
          {undo&&<Button variant="ghost" onClick={()=>startTransition(undo.run)} disabled={pending}>{undo.label}</Button>}
          <Button
            onClick={() => {setNotice(null);setUndo(null);}}
            icon={X}
            iconOnly
            aria-label="Dismiss notice"
            title="Dismiss"
            className="size-11"
          />
        </div>
      )}
      {(data.loadError || emailPaused) && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-warn/20 bg-warn-soft px-4 py-3"
        >
          <p className="min-w-0 flex-1 text-body text-ink-2">
            {emailPaused
              ? `Email paused · ${lastSyncedAt ? `last synced ${new Date(lastSyncedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "not synced yet"}`
              : data.loadError}
          </p>
          <Button variant="secondary" size="sm" onClick={retryEmail}>
            Try again
          </Button>
        </div>
      )}
      {!data.mailbox.connected && (
        <div className="border-b border-warn/20 bg-warn-soft px-4 py-3">
          <div className="flex flex-col items-start gap-2 @xl/page:flex-row @xl/page:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-subheading font-semibold text-ink">
                No email connected
              </p>
              <p className="mt-1 text-body text-ink-2">
                {data.mailbox.canConnect
                  ? "Connect Gmail to read and reply here. Saved conversations are below."
                  : "Finish Gmail setup to connect email. Saved conversations are below."}
              </p>
            </div>
            <Button
              href={
                data.mailbox.canConnect
                  ? "/api/inbox/oauth/start"
                  : "https://console.cloud.google.com/apis/credentials"
              }
              variant="primary"
              size="sm"
              className="max-sm:h-11"
              icon={Mail}
            >
              {data.mailbox.canConnect ? "Connect Gmail" : "Set up Gmail"}
            </Button>
          </div>
          {!data.mailbox.canConnect && (
            <details className="mt-2 text-body text-ink-2">
              <summary className="cursor-pointer py-1 font-semibold">
                Gmail setup checklist
              </summary>
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                <li>
                  Open Google Cloud credentials for your Gmail application.
                </li>
                <li>
                  Have your account administrator securely connect Gmail sign-in
                  and the SJC OS return address.
                </li>
                <li>
                  Reload Inbox, then choose Connect Gmail and sign in to your
                  mailbox.
                </li>
              </ol>
            </details>
          )}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {showSources && (
          <button
            type="button"
            aria-label="Close views and channels"
            tabIndex={-1}
            onClick={() => setShowSources(false)}
            className="absolute inset-0 z-20 cursor-default bg-ink/10"
          />
        )}
        {/* ─── Sources rail ─────────────────────────────────────────── */}
        <aside
          aria-label="Inbox views and channels"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) {
              setShowSources(false);
            }
          }}
          className={`flex-none flex-col overflow-y-auto bg-paper-2 p-3 ${showSources ? "absolute left-2 top-2 z-30 flex max-h-[calc(100%-1rem)] w-72 max-w-[calc(100%-1rem)] rounded-lg border border-rule shadow-pop" : "hidden"}`}
        >
          <button
            onClick={() => {void leaveInbox(()=>{setLens({ kind: "inbox" });setTab(null);});}}
            className={[
              "mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
              isInbox
                ? "bg-accent-soft font-semibold text-accent-2"
                : "text-ink-2 hover:bg-paper-3",
            ].join(" ")}
          >
            <Inbox className="size-3 flex-none text-ink-3" strokeWidth={1.5} />
            <span className="flex-1">Inbox</span>
            <span className="text-meta text-ink-3">
              {emailPaused ? "—" : inboxCount}
            </span>
          </button>

          <RailLabel>Smart views</RailLabel>

          <div className="flex flex-col gap-0.5">
            {data.smartViews.map((v) => (
              <button
                key={v.key}
                onClick={() => {void leaveInbox(()=>{setLens({ kind: "view", view: v.key });setTab(null);});}}
                className={[
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
                  isView(v.key)
                    ? "bg-accent-soft font-semibold text-accent-2"
                    : "text-ink-2 hover:bg-paper-3",
                ].join(" ")}
              >
                <span className={`size-1.5 rounded-full ${DOT_BG[v.dot]}`} />
                <span className="flex-1">{v.label}</span>
                <span className="text-meta text-ink-3">
                  {emailPaused ? "—" : (v.count ?? "—")}
                </span>
              </button>
            ))}
          </div>

          <div className="my-2 h-px bg-rule" />
          <RailLabel>Mailboxes</RailLabel>
          <div className="flex flex-col gap-0.5">
            {SYSTEM_VIEWS.map((v) => {
              const Icon = SYSTEM_ICON[v.key];
              return (
                <button
                  key={v.key}
                  onClick={() => selectSystem(v.key)}
                  className={[
                    "flex items-center gap-2 rounded-md px-2 py-1 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
                    isSystem(v.key)
                      ? "bg-accent-soft font-semibold text-accent-2"
                      : "text-ink-2 hover:bg-paper-3",
                  ].join(" ")}
                >
                  <Icon
                    className="size-3 flex-none text-ink-3"
                    strokeWidth={1.5}
                  />
                  {/* No count badge: the only honest number would be one derived
                    from what clicking shows, but these are server-fetched pages —
                    a labels.get total counts across folders (incl. spam/trash)
                    and wouldn't match the opened list. No badge beats a wrong
                    one (same principle as the smart-view/channel counts). User
                    labels DO badge from labels.get — see the Labels rail below —
                    because their trash/spam overlap is rare, unlike Unread's,
                    where every spam thread is unread and the skew is systematic. */}
                  <span className="flex-1 truncate">{v.label}</span>
                </button>
              );
            })}
          </div>

          <div className="my-2 h-px bg-rule" />
          <RailLabel>Channels</RailLabel>
          <div className="flex flex-col gap-0.5">
            {data.channels.map((c) => {
              const Icon = CHANNEL_ICON[c.key];
              return (
                <button
                  key={c.key}
                  onClick={() => {void leaveInbox(()=>{setLens({ kind: "channel", channel: c.key });setTab(null);});}}
                  className={[
                    "flex items-center gap-2 rounded-md px-2 py-1 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
                    isChannel(c.key)
                      ? "bg-accent-soft font-semibold text-accent-2"
                      : "text-ink-2 hover:bg-paper-3",
                  ].join(" ")}
                >
                  <Icon
                    className="size-3 flex-none text-ink-3"
                    strokeWidth={1.5}
                  />
                  <span className="flex-1 truncate">{c.label}</span>
                  <span className="text-meta text-ink-3">
                    {c.key === "email" && emailPaused ? "—" : (c.count ?? "—")}
                  </span>
                </button>
              );
            })}
            {data.mailbox.connected && <MailboxStrip mailbox={data.mailbox} />}
          </div>

          {data.labels.length > 0 && (
            <>
              <div className="my-2 h-px bg-rule" />
              <RailLabel>Labels</RailLabel>
              <div className="flex flex-col gap-0.5">
                {data.labels.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => selectLabel(l.id, l.name)}
                    className={[
                      "flex items-center gap-2 rounded-md px-2 py-1 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
                      isLabel(l.id)
                        ? "bg-accent-soft font-semibold text-accent-2"
                        : "text-ink-2 hover:bg-paper-3",
                    ].join(" ")}
                  >
                    <Tag
                      className="size-3 flex-none text-ink-3"
                      strokeWidth={1.5}
                    />
                    <span className="flex-1 truncate">{l.name}</span>
                    <span className="text-meta text-ink-3">
                      {emailPaused ? "—" : (l.count ?? "—")}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {data.projects.length > 0 && (
            <>
              <div className="my-2 h-px bg-rule" />
              <RailLabel>By project</RailLabel>
              <div className="flex flex-col gap-0.5">
                {data.projects.map((p) => {
                  const slug = p.slug ?? p.label;
                  return (
                    <button
                      key={slug}
                      onClick={() => {void leaveInbox(()=>{setLens({ kind: "project", slug, label: p.label });setTab(null);});}}
                      className={[
                        "flex items-center gap-2 rounded-md px-2 py-1 text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-focus text-meta",
                        isProject(slug)
                          ? "bg-accent-soft font-semibold text-accent-2"
                          : "text-ink-2 hover:bg-paper-3",
                      ].join(" ")}
                    >
                      {p.emphasis ? (
                        <span
                          className={`size-1.5 rounded-full ${DOT_BG[p.emphasis]}`}
                        />
                      ) : (
                        <span className="size-1.5" />
                      )}
                      <span className="flex-1 truncate">{p.label}</span>
                      <span className="text-meta text-ink-3">
                        {emailPaused ? "—" : p.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </aside>

        {/* ─── Thread list ──────────────────────────────────────────── */}
        <section
          data-inbox-list
          style={wideContext&&(context||contextPreference)?{width:contextWidths.listWidth}:undefined}
          className={[
            "min-w-0 w-full flex-none flex-col border-r border-rule-soft",
            compactList && (context || contextPreference) ? "@4xl/page:w-[240px]" : "@4xl/page:w-80 @[1100px]/page:w-[260px] @[1280px]/page:w-[340px]",
            mobileReader ? "hidden @4xl/page:flex" : "flex",
          ].join(" ")}
        >
          {passFinished&&<div className="border-b border-rule-soft p-3"><p className="mb-2 text-body">This pass is finished.</p><Button variant="secondary" onClick={()=>{setLens({kind:'all'});setTab('needs');setQuery('');setPassFinished(false);}}>Back to Needs me ({globalNeedsCount})</Button></div>}
          {lens.kind !== "all" && (
            <div className="flex min-h-11 items-center gap-2 border-b border-rule-soft px-3">
              <span className="min-w-0 flex-1 truncate text-meta text-ink-3">
                {lensLabel}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {void leaveInbox(()=>{setLens({ kind: "all" });setTab(null);});}}
              >
                Clear view
              </Button>
            </div>
          )}
          {tab==='other'&&olderOtherMail(visible).length>0&&<div className="border-b border-rule-soft p-2"><Button variant="secondary" size="sm" disabled={pending} onClick={markOtherDone}>Archive older automated mail ({olderOtherMail(visible).length})</Button></div>}
          {tab==="new"&&<p className="border-b border-rule-soft px-3 py-2 text-meta text-ink-3">{counts.new} new {counts.new===1?"sender":"senders"}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {remoteLoading && visible.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-meta text-ink-3">Loading {headerLabel}…</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                {/* On an empty remote lens (a mailbox/label that failed to load)
                  the reader — and its notice banner — never mounts, so surface a
                  fetch error here instead of a misleading "Nothing in …". */}
                {notice && remoteKey !== null ? (
                  <>
                    <X className="size-6 text-flag" strokeWidth={1.5} />
                    <p className="text-meta text-flag">{notice}</p>
                    <Button variant="secondary" size="sm" onClick={retryEmail}>
                      Try again
                    </Button>
                  </>
                ) : emailPaused &&
                  !(lens.kind === "channel" && lens.channel !== "email") ? (
                  <p className="text-meta text-ink-3">
                    Email is paused. Try again to check this view.
                  </p>
                ) : !data.mailbox.connected && !tab ? (
                  <NoMailboxPrompt />
                ) : (
                  <>
                    <Inbox className="size-6 text-ink-3" strokeWidth={1.5} />
                    <p className="text-meta text-ink-3">
                      Nothing in {headerLabel.toLowerCase()}.
                    </p>
                  </>
                )}
              </div>
            ) : (
              visible.map((t,i) => (
                <div key={t.id}>
                {(i===0||(tab==='needs'?attentionGroup(t,readyIds)!==attentionGroup(visible[i-1],readyIds):rowDay(t)!==rowDay(visible[i-1])))&&<p className="border-b border-rule-soft bg-paper-2 px-3 py-1.5 text-meta font-semibold text-ink-3">{tab==='needs'?`${attentionGroup(t,readyIds)} · ${visible.filter(row=>attentionGroup(row,readyIds)===attentionGroup(t,readyIds)).length}`:rowDay(t)}</p>}
                <ThreadRow
                  thread={draftRow(t,suggestions.get(t.id))}
                  selected={selected?.id === t.id && (mobileReader||wideContext)}
                  onDone={() => startTransition(async()=>{await doneThread(t);})}
                  onTomorrow={()=>remindTomorrow(draftRow(t,suggestions.get(t.id)))}
                  onRemind={anchor => openTask(draftRow(t,suggestions.get(t.id)),true,anchor)}
                  compact={compactList && Boolean(context || contextPreference)}
                  onScreen={t.newSender?()=>{setScreeningThread(t);setLinking(true);}:undefined}
                  onAdd={t.newSender?kind=>setAdding({thread:t,kind}):undefined}
                  onOther={t.newSender?()=>fileSender(t,true):undefined}
                  onSelect={() => {void leaveInbox(()=>{setSelectedId(t.id);setMobileReader(true);});}}
                />
                </div>
              ))
            )}

            {showLoadMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full border-t border-rule px-3 py-2.5 text-center text-meta font-medium text-ink-3 hover:bg-paper-3 disabled:opacity-60"
              >
                {loadingMore ? "Loading older email…" : "Load older email"}
              </button>
            )}
          </div>
          {!composing&&<div className="relative border-t border-rule-soft px-3 py-1 @4xl/page:hidden">
            <Button variant="ghost" className="min-h-11" aria-expanded={splitSheet} onClick={()=>setSplitSheet(v=>!v)}>{INBOX_TABS.find(t=>t.value===tab)?.label??headerLabel} {tab?counts[tab]:visible.length} ▾</Button>
            {splitSheet&&<div role="dialog" aria-label="Inbox splits" className="absolute inset-x-0 bottom-full z-[75] rounded-t-xl border border-rule bg-card p-3 shadow-pop"><div className="flex items-center"><h2 className="flex-1 text-subheading font-semibold">Inbox splits</h2><Button variant="ghost" onClick={()=>{setSplitSheet(false);setShowSources(true);}}>Views</Button><Button variant="ghost" icon={X} iconOnly aria-label="Close splits" title="Close splits" onClick={()=>setSplitSheet(false)}/></div>{INBOX_TABS.map(split=><button key={split.value} aria-pressed={tab===split.value} className="flex min-h-11 w-full items-center justify-between rounded-md px-3 text-body aria-pressed:bg-selected" onClick={()=>{void leaveInbox(()=>{setTab(split.value);setMobileReader(false);setSplitSheet(false);});}}><span>{split.label}</span><span>{counts[split.value]}</span></button>)}</div>}
          </div>}
        </section>

        {/* ─── Reader ───────────────────────────────────────────────── */}
        <section
          className={[
            "relative min-w-0 flex-1 flex-col group/reader",
            mobileReader ? "flex" : "hidden @4xl/page:flex",
          ].join(" ")}
        >
          {!reader || !selected ? (
            <div className="grid flex-1 place-items-center">
              <EmptyState
                icon={Mail}
                title="Select a conversation"
                description="Choose a message from the list to read it and reply."
              />
            </div>
          ) : (
            <>
              <div className="flex-none border-b border-rule bg-paper">
                <div className="flex h-13 items-center gap-1 px-2 @4xl/page:h-12">
                  <Button
                    onClick={() => setMobileReader(false)}
                    icon={ChevronLeft}
                    iconOnly
                    aria-label="Back to inbox list"
                    title="Back"
                    className="size-11 @4xl/page:hidden"
                  />
                  <span className="min-w-0 flex-1 truncate text-body font-semibold @4xl/page:hidden">
                    {selected.fromName}
                  </span>

                  <Button
                    onClick={archiveSelected}
                    icon={Check}
                    variant="ghost"
                    disabled={pending||selected.view==='done'}
                    className="min-h-11 @4xl/page:min-h-8"
                  >
                    {selected.view==='done'?'Done ✓':'Done'}
                  </Button>
                  <Button
                    onClick={() => openTask(selected,true)}
                    icon={Clock}
                    variant="ghost"
                    data-task-anchor
                    title="Remind me (h)"
                    className="hidden @4xl/page:inline-flex"
                  >
                    Remind me
                  </Button>
                  <Button
                    onClick={() => openTask(selected,false)}
                    icon={ListPlus}
                    variant="ghost"
                    className="hidden @5xl/page:inline-flex"
                  >
                    Make to-do
                  </Button>
                  <div className="hidden flex-1 @4xl/page:block" />
                  <Button
                    onClick={() => navigate(-1)}
                    disabled={
                      visible.findIndex((t) => t.id === selected.id) <= 0
                    }
                    icon={ChevronLeft}
                    iconOnly
                    aria-label="Previous conversation"
                    title="Previous (k)"
                    className="hidden @4xl/page:inline-flex"
                  />
                  <Button
                    onClick={() => navigate(1)}
                    disabled={
                      visible.findIndex((t) => t.id === selected.id) >=
                      visible.length - 1
                    }
                    icon={ChevronRight}
                    iconOnly
                    aria-label="Next conversation"
                    title="Next (j)"
                    className="hidden @4xl/page:inline-flex"
                  />
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen((o) => !o)}
                      ref={moreButtonRef}
                      aria-label="More actions"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      className="inline-flex size-11 items-center justify-center rounded hover:bg-paper-3 @4xl/page:size-8"
                    >
                      <MoreHorizontal
                        className="size-3.5 text-ink-3"
                        strokeWidth={1.5}
                      />
                    </button>
                    {menuOpen && (
                      <>
                        {/* click-away backdrop */}
                        <button
                          aria-hidden
                          tabIndex={-1}
                          onClick={() => setMenuOpen(false)}
                          className="fixed inset-0 z-10 cursor-default"
                        />
                        <div
                          role="menu"
                          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-rule bg-card py-1 shadow-lg"
                        >
                          <MenuItem
                            icon={Clock}
                            onClick={() => {
                              setMenuOpen(false);
                              openTask(selected,true,moreButtonRef.current);
                            }}
                          >
                            Remind me
                          </MenuItem>
                          <MenuItem icon={Clock} onClick={()=>{setMenuOpen(false);remindTomorrow(selected);}}>Tomorrow 8 AM · Shift H</MenuItem>
                          <MenuItem
                            icon={ListPlus}
                            onClick={() => {
                              setMenuOpen(false);
                              openTask(selected,false,moreButtonRef.current);
                            }}
                          >
                            Make to-do
                          </MenuItem>
                          <MenuItem
                            icon={LinkIcon}
                            onClick={() => {
                              setMenuOpen(false);
                              setLinking(true);
                            }}
                          >
                            Link to job / lead
                          </MenuItem>
                          {readerIsEmail && (
                            <>
                              {selected.fromEmail&&<MenuItem icon={OctagonAlert} onClick={()=>{setMenuOpen(false);blockSender(selected);}}>Block sender</MenuItem>}
                              <MenuItem icon={OctagonAlert} onClick={()=>reportSpam(selected)}>Report spam</MenuItem>
                              <MenuItem icon={Star} onClick={toggleStar}>
                                {selectedStarred ? "Unstar" : "Star"}
                              </MenuItem>
                              <MenuItem icon={selected.unread?MailOpen:Mail} onClick={()=>setReadSelected(Boolean(selected.unread))}>{selected.unread?'Mark as read':'Mark as unread'}</MenuItem>
                              <MenuItem
                                icon={Flag}
                                onClick={() =>
                                  menuAction(() =>
                                    setThreadImportantAction(selected.id, true),
                                  )
                                }
                              >
                                Mark important
                              </MenuItem>

                              <div className="my-1 h-px bg-rule" />
                              <MenuItem
                                icon={Trash2}
                                danger
                                onClick={() =>
                                  menuAction(() =>
                                    trashThreadAction(selected.id),
                                  )
                                }
                              >
                                Trash
                              </MenuItem>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="px-4 pb-3 group-has-[[data-reply-active=true]]/reader:pb-1">
                  <p className="truncate text-meta text-ink-3">{selected.fromName}</p>
                  <h1 className="line-clamp-2 font-serif text-heading font-medium leading-tight text-accent-2 group-has-[[data-reply-active=true]]/reader:text-body">{rowActionTitle(selected)}</h1>
                  {rowActionTitle(selected)!==reader.subject&&<p className="truncate text-meta text-ink-3" title={reader.subject}>{reader.subject}</p>}
                  <button onClick={openContext} title="Open contact, job, money and to-dos" aria-label="Open person and job context" aria-expanded={Boolean(context || wideContext && contextPreference)} className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-md border border-rule bg-card px-3 text-left text-meta text-ink-2 @4xl/page:min-h-8 group-has-[[data-reply-active=true]]/reader:mt-1 group-has-[[data-reply-active=true]]/reader:min-h-7">
                    <span className="min-w-0 flex-1 truncate">{selected.automated?`Automated · ${selected.fromName} · ${rowActionTitle(selected)}`:contextStripText(selected,contextData)}</span><ChevronRight className="size-3.5 shrink-0"/>
                  </button>
                  {selected.automated&&<div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-ink-3"><span>{automationState(selected).label}</span><Button variant="secondary" size="sm" disabled={pending} onClick={()=>startTransition(async()=>{await savePreference(selected,'thread',(selected.attentionOverride??selected.attentionRequired)?'other':'attention');})}>{(selected.attentionOverride??selected.attentionRequired)?'Keep in Other':'Mark as needs my attention'}</Button></div>}
                  {(selected.newSender||selected.senderDecision)&&selected.fromEmail&&!selected.automated&&<div className="mt-1 flex flex-wrap items-center gap-1 text-meta text-ink-3">
                    <span title={selected.fromEmail} className="w-full truncate">{selected.newSender?'New sender':`Screened: ${selected.senderDecision}`} · {selected.fromEmail}</span>
                    {!selected.newSender&&<Button variant="ghost" size="sm" onClick={()=>startTransition(async()=>{if(await savePreference(selected,'sender','pending'))setTab('new');})}>Undo screening</Button>}
                  </div>}

                </div>
              </div>

              {readerIsEmail ? (
                <ReaderBody
                  key={`${selfEmail}:${userId}:${selected.id}`}
                  reader={reader}
                  todos={selected.todos}
                  threadId={selected.id}
                  newSender={selected.newSender}
                  screening={<SenderScreening thread={selected} onLink={()=>{setScreeningThread(selected);setLinking(true);}} onAdd={kind=>setAdding({thread:selected,kind})} onOther={()=>fileSender(selected,true)} onBlock={()=>blockSender(selected)} onSpam={()=>reportSpam(selected)}/>}
                  needsAttention={automationState(selected).attention}
                  onMakeTodo={()=>openTask(selected,false)}
                  onDone={archiveSelected}
                  onSendDone={()=>doneThread(selected,true)}
                  onDraftReady={onDraftReady}
                  mailbox={selfEmail} userId={userId} owner={owner} initialSuggestion={suggestions.get(selected.id)??null}
                  blockImages={!selected.contactRole && !selected.projectSlug && !["linked","lead","sub","vendor"].includes(selected.senderDecision??"")}
                />
              ) : (
                <ChannelReaderBody
                  key={`${selfEmail}:${userId}:${selected.id}`}
                  reader={reader}
                  todos={selected.todos}
                  threadId={selected.id}
                  visible={mobileReader}
                  onOpenConversation={openConversation}
                  availableConversations={threads.filter(t=>t.channel==='email').map(t=>t.id)}
                  onSendDone={()=>doneThread(selected,true)}
                  mailbox={selfEmail} userId={userId} owner={owner}
                />
              )}
            </>
          )}
        </section>

        {(context || wideContext && contextPreference) && selected && (
          <ContextPanel
            key={`${selected.id}:${context}`}
            thread={selected}
            threads={threads}
            initialTab={context??"job"}
            initialData={contextData}
            refreshing={contextResult?.key===contextKey&&contextResult.pending}
            loadError={contextResult?.key===contextKey?contextError:undefined}
            onRetry={()=>setContextRefresh(n=>n+1)}
            docked={wideContext}
            compact={compactList}
            panelWidth={contextWidths.panelWidth}
            onClose={closeContext}
            onLink={() => setLinking(true)}
            onSelect={openConversation}
            onTaskDone={id=>{
              const remove=(c:InboxContext)=>({...c,todos:c.todos.filter(t=>t.id!==id)});
              setContextResult(r=>r?.data?{...r,data:remove(r.data)}:r);
              for(const [key,c]of contextCache.current)contextCache.current.set(key,remove(c));
              const removeTasks=(t:InboxThread)=>({...t,todos:t.todos?.filter(todo=>todo.id!==id),jobTodos:t.jobTodos?.filter(todo=>todo.id!==id)});
              setThreads(rows=>rows.map(removeTasks));setRemoteData(d=>d?{...d,threads:d.threads.map(removeTasks)}:d);
            }}
          />
        )}
      </div>
      {linking && (
        <LinkPicker
          sender={linkTarget?.fromEmail}
          options={linkOptions}
          value={currentLink}
          onPick={relink}
          onClose={() => {setLinking(false);setScreeningThread(null);}}
        />
      )}
      {adding&&<ContactCreateDialog thread={adding.thread} kind={adding.kind} onClose={()=>setAdding(null)} onLink={()=>{setScreeningThread(adding.thread);setAdding(null);setLinking(true);}} onCreated={slug=>{
        const {thread,kind}=adding;setAdding(null);
        const patch=(t:InboxThread)=>t.fromEmail===thread.fromEmail?{...t,newSender:false,contactRole:kind,contactKey:`${kind}:${slug}`}:t;
        setThreads(ts=>ts.map(patch));
        startTransition(async()=>{const screened=await savePreference(thread,'sender',kind,false);setNotice(screened?`Added as ${kind}. Undo screening keeps the contact in your directory.`:`Contact created; couldn't save the screening decision.`);setUndo({label:'Undo screening',run:async()=>{if(await savePreference(thread,'sender','pending',false)){setTab('new');setUndo(null);setNotice('Screening undone; contact kept.');}}});});
      }}/>}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {task && readers[task.thread.id] && (
        <MessageTaskDialog
          thread={draftRow(task.thread,suggestions.get(task.thread.id))}
          reader={readers[task.thread.id]}
          remind={task.remind} anchor={task.anchor}
          options={linkOptions}
          onClose={() => setTask(null)}
          onCreated={(todo) => {
            const patch = (t: InboxThread) =>
              t.id === task.thread.id
                ? {
                    ...t,
                    hasOpenTodo: true,
                    todos: [
                      ...(t.todos ?? []).filter((old) => old.id !== todo.id),
                      todo,
                    ],
                  }
                : t;
            setThreads((ts) => ts.map(patch));
            setRemoteData((d) =>
              d ? { ...d, threads: d.threads.map(patch) } : d,
            );
            contextCache.current.delete(`${selfEmail}:${task.thread.id}`);
            setContextResult(null);setContextRefresh(n=>n+1);
            setNotice(
              task.remind ? "Reminder saved for its due day." : "To-do saved.",
            );
          }}
        />
      )}
      {composing && (
        <ComposeModal
          key={`${selfEmail}:${userId}`}
          selfEmail={selfEmail} userId={userId} owner={owner}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}

const completionChanged=()=>window.dispatchEvent(new Event('inbox-completion-changed'));
async function sendWithReceipt(mailbox:string,threadId:string,reader:ThreadReader,recipient:string,send:()=>Promise<{ok:boolean;error?:string}>,done?:()=>Promise<{ok:boolean;error?:string}>,confirmed?:()=>void) {
 const receipt:SentCompletion={threadId,recipient,channel:reader.channel,sentAt:Date.now(),through:reader.messages.at(-1)?.date ?? 0};
 return completeAfterSend(async()=>{
   const result=await send();
   if(result.ok)receipt.sentAt=Date.now();
   if(result.ok&&done){try{saveCompletion(localStorage,completionKey(mailbox),receipt);completionChanged();}catch{}}
   if(result.ok)confirmed?.();
   return result;
 },done?async()=>{
   const result=await done();if(result.ok){try{clearCompletion(localStorage,completionKey(mailbox),threadId);completionChanged();}catch{}}return result;
 }:undefined);
}

function useMailFiles(originals: {name:string;size:number;type:string}[] = []) {
  const [files,setFiles]=useState<File[]>([]);
  const latest=useRef(files);latest.current=files;
  useEffect(()=>{
    const unregister=registerInboxFiles(()=>latest.current.length);
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(latest.current.length){event.preventDefault();event.returnValue=fileLossWarning(latest.current.length);}};
    window.addEventListener('beforeunload',beforeUnload);
    return()=>{unregister();window.removeEventListener('beforeunload',beforeUnload);};
  },[]);
  const confirmLoss=()=>!latest.current.length||window.confirm(fileLossWarning(latest.current.length));
  const [error,setError]=useState('');
  const data=()=>{const form=new FormData();for(const file of files)form.append('files',file);return form;};
  const picker=(disabled:boolean,compact=false)=><div className={`flex max-w-full items-center gap-1 text-meta ${compact?"shrink-0 flex-nowrap":"flex-wrap"}`}>
    <label className={`inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-2 hover:bg-hover max-sm:min-h-11 ${disabled?'opacity-50':''}`}>
      <Paperclip className="size-4"/><span>{files.length?`${files.length} · ${fileSize(files.reduce((n,f)=>n+f.size,0))}`:""}</span><span className="sr-only">Attach files / photos</span>
      <input type="file" multiple accept={MAIL_FILE_ACCEPT} disabled={disabled} className="sr-only" aria-label="Attach files or photos" onChange={e=>{
        const next=[...files,...Array.from(e.target.files ?? [])];
        try{validateMailFiles([...originals,...next]);setFiles(next);setError('');}catch(err){setError((err as Error).message);}e.target.value='';
      }}/>
    </label>
    <ul aria-label="Files to send" className={`flex gap-2 ${compact?"flex-nowrap":"flex-wrap"}`}>{files.map((file,i)=><li key={i} className="flex min-w-0 items-center gap-1 rounded-md border border-rule bg-card px-2"><span className={compact?"max-w-24 truncate":"break-all"} title={file.name}>{file.name} · {fileSize(file.size)}</span><Button variant="ghost" disabled={disabled} aria-label={`Remove ${file.name}`} title={`Remove ${file.name}`} icon={X} iconOnly onClick={()=>setFiles(items=>items.filter((_,j)=>j!==i))}/></li>)}</ul>
    {error&&<p role="alert" className="text-flag">{error}</p>}
  </div>;
  return {files,data,picker,confirmLoss,clear:()=>{latest.current=[];setFiles([]);}};
}

type ForwardMessage = {threadId:string;subject:string;message:ThreadReader['messages'][number]};
function ComposeModal({
  selfEmail,
  onClose,
  forward, userId=selfEmail, owner=false,
}: {
  userId?:string;owner?:boolean;
  selfEmail: string;
  onClose: () => void;
  forward?:ForwardMessage;
}) {
  const saved=useComposerDraft({mailbox:selfEmail,userId,owner,channel:'email',threadKey:forward?`forward:${forward.threadId}:${forward.message.id}`:'compose:new',
    initial:{toEmail:'',cc:[],subject:forward?`Fwd: ${forward.subject.replace(/^fwd?:\s*/i,'')}`:'',
      body:forward?`\n\n---------- Forwarded message ----------\nFrom: ${forward.message.fromName} <${forward.message.fromEmail??''}>\nDate: ${forward.message.date?new Date(forward.message.date).toLocaleString('en-US'):forward.message.meta??''}\nSubject: ${forward.subject}\nTo: ${forward.message.to??''}\n\n${forward.message.body.join('\n\n')}`:''}});
  const {body,toEmail:to,subject}=saved.synced.draft;
  const cc=saved.synced.draft.cc.join(', ');
  const setTo=(toEmail:string)=>saved.synced.setDraft(d=>({...d,toEmail}));
  const setCc=(value:string)=>saved.synced.setDraft(d=>({...d,cc:value.split(',')}));
  const setSubject=(subject:string)=>saved.synced.setDraft(d=>({...d,subject}));
  const setBody=(next:string|((body:string)=>string))=>saved.synced.setDraft(d=>({...d,body:typeof next==='function'?next(d.body):next}));
  const [originals,setOriginals]=useState(forward?.message.attachments ?? []);
  const forwardChoiceKey=JSON.stringify(['sjc:inbox:forward-files',selfEmail,userId,forward?.threadId,forward?.message.id]);
  const [choicesLoaded,setChoicesLoaded]=useState(false);
  useEffect(()=>{
    try{setOriginals(restoreForwardChoices(forward?.message.attachments??[],localStorage.getItem(forwardChoiceKey)));}catch{}
    setChoicesLoaded(true);
  },[forwardChoiceKey,forward]);
  useEffect(()=>{if(choicesLoaded&&forward)try{localStorage.setItem(forwardChoiceKey,JSON.stringify(originals.map(a=>a.id)));}catch{}},[choicesLoaded,forward,forwardChoiceKey,originals]);
  const files=useMailFiles(originals);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, startSend] = useTransition();
  const sendBusy=useRef(false);
  useEffect(()=>registerInboxDraft(async()=>!sendBusy.current),[]);
  function close() {
    if(sendBusy.current||sending)return;
    void guardInboxNavigation(onClose,()=>setError('Draft not synced yet. Resolve its save or conflict before closing.'));
  }


  function send() {
    if(sendBusy.current)return;
    sendBusy.current=true;
    setError("");
    startSend(async () => {
      try {
      let snapshot;
      try{snapshot=await saved.prepare();}catch(e){setError((e as Error).message);return;}
      const res = await runAction(
        () => sendNewEmailAction({ to, cc, subject, body, files:files.data(), ...(forward?{forward:{threadId:forward.threadId,messageId:forward.message.id!,attachmentIds:originals.map(a=>a.id)}}:{}) }),
        { fallback: "Send failed." },
      );
      if (res.ok) {
        setSent(true);
        const warning=await saved.finish(snapshot.version);
        window.dispatchEvent(new Event('inbox-drafts-changed'));
        if(warning)setError(warning);else onClose();
      } else setError(res.error ?? "Send failed.");
      } finally {sendBusy.current=false;}
    });
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/30 p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={forward?"Forward message":"New message"}
        className="max-h-[90dvh] w-full max-w-[560px] overflow-y-auto rounded-xl border border-rule-soft bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
          <h3 className="flex-1 text-subheading font-semibold text-ink">
            {forward?"Forward message":"New message"}
          </h3>
          <Button
            onClick={close}
            disabled={sending}
            icon={X}
            iconOnly
            aria-label="Close new message"
            title="Close new message"
          />
        </div>
        <div className="flex flex-col gap-2 p-4">
          <input
            value={to} disabled={sending||sent}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To"
            placeholder="To"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-body text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <input value={cc} onChange={e=>setCc(e.target.value)} aria-label="Cc" placeholder="Cc (optional)" disabled={sending||sent} className="rounded-md border border-rule bg-paper px-3 py-2 text-body" />
          {forward&&<p className="text-meta text-ink-3">Review To and Cc before sending. Original files are included below.</p>}
          <input
            value={subject} disabled={sending||sent}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Subject"
            placeholder="Subject"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-body text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <textarea
            value={body} disabled={sending||sent}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            aria-label="Message"
            placeholder="Write your message…"
            className="resize-y rounded-md border border-rule bg-paper px-3 py-2 text-body leading-relaxed text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <ul aria-label="Original files to forward">{originals.map(a=><li key={a.id} className="flex items-center gap-2 text-meta"><span className="min-w-0 flex-1 break-all">{a.name} · {fileSize(a.size)} · Original</span><Button variant="ghost" disabled={sending||sent} aria-label={`Remove ${a.name}`} title={`Remove ${a.name}`} icon={X} iconOnly onClick={()=>setOriginals(items=>items.filter(v=>v.id!==a.id))}/></li>)}</ul>
          {files.picker(sending||sent)}
          <DraftSyncFooter saved={saved} disabled={sending||sent} localFiles={files.files.length>0||originals.length>0}/>
          <p className="text-meta text-ink-3">New files stay on this device. Forwarded file choices restore on this device; review them before sending.</p>
          <Button variant="ghost" disabled={sending||sent} onClick={()=>{if(!files.confirmLoss())return;startSend(async()=>{try{await saved.clear();files.clear();try{localStorage.removeItem(forwardChoiceKey);}catch{}onClose();}catch(e){setError((e as Error).message);}});}}>Discard</Button>
          {error && <p className="text-meta text-flag">{error}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button
              onClick={()=>send()}
              icon={Send}
              disabled={!to.trim() || !body.trim() || sending || sent || !choicesLoaded}
            >
              {sent ? "Sent ✓" : sending ? "Sending…" : "Send email"}
            </Button>
            <VoiceButton
              compact
              onText={(t) => setBody((cur) => mergeTranscript(cur, t))}
            />
            <span className="text-meta text-ink-3">Sends from your Gmail</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Project\nPartial basement finish" — a website-form field and its value. */
const FORM_FIELD = /^([^\n]{1,40})\n([\s\S]+)$/;

/** Wide mail tables scroll at their natural text size; quoted history folds. */
function EmailHtml({ html,receiptChoice='auto',onCompactReceipt }: { html: string;receiptChoice?:'auto'|'compact'|'formatted';onCompactReceipt?:(compact:boolean)=>void }) {
  const inner = useRef<HTMLDivElement>(null);
  const scroller=useRef<HTMLDivElement>(null);
  const [overflowing,setOverflowing]=useState(false);
  const fields=useMemo(()=>receiptFields(html),[html]);
  const compactReceipt=useCompactReceipt(fields,overflowing,receiptChoice==='auto'?null:receiptChoice);
  useLayoutEffect(()=>{onCompactReceipt?.(compactReceipt);},[compactReceipt,onCompactReceipt]);
  const [hasQuote, setHasQuote] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  useLayoutEffect(() => {
    setHasQuote(!!inner.current?.querySelector("blockquote"));
    const measure=()=>{if(scroller.current)setOverflowing(scroller.current.scrollWidth>scroller.current.clientWidth+1);};
    const observer=new ResizeObserver(measure);if(scroller.current)observer.observe(scroller.current);if(inner.current)observer.observe(inner.current);measure();
    const imgs = Array.from(inner.current?.querySelectorAll("img") ?? []);
    const failed=(event:Event)=>{
      const im=event.target as HTMLImageElement;
      if(!im.getAttribute('src')){im.remove();return;}
      const placeholder=document.createElement('span');placeholder.className='inline-block rounded border border-rule px-2 py-1 text-meta text-ink-3';placeholder.textContent=im.alt?`Image unavailable · ${im.alt}`:'Image unavailable';im.replaceWith(placeholder);
    };
    imgs.forEach(im=>{im.addEventListener('error',failed);if(im.complete&&im.naturalWidth===0)failed({target:im} as unknown as Event);});
    return () => {
      observer.disconnect();
      imgs.forEach(im=>im.removeEventListener('error',failed));
    };
  }, [html]);
  return (
    <div className="relative min-w-0">
      {compactReceipt&&<dl aria-label="Receipt details" className="space-y-2">{fields.map((field,i)=><div key={i} className="grid grid-cols-[minmax(80px,1fr)_minmax(0,2fr)] gap-3 border-b border-rule-soft pb-2"><dt className="text-meta text-ink-3">{field.label}</dt><dd className="break-words text-body font-semibold text-ink">{field.value}</dd></div>)}</dl>}
      {compactReceipt&&<details className="mt-2"><summary className="min-h-11 cursor-pointer text-meta text-accent-2">Full receipt text and links</summary><div dangerouslySetInnerHTML={{__html:readableEmailHtml(html)}}/></details>}
      {overflowing&&!compactReceipt&&<p className="sticky left-0 mb-1 text-meta font-semibold text-accent-2">Scroll sideways to see the full table →</p>}
      <div aria-hidden={compactReceipt||undefined} ref={scroller} tabIndex={overflowing&&!compactReceipt?0:undefined} role={overflowing?'region':undefined} aria-label={overflowing?'Scrollable email content':undefined} className={`min-w-0 overflow-x-auto ${compactReceipt?"invisible absolute inset-x-0 top-0 -z-10 h-0 overflow-hidden":""}`} style={overflowing?{background:'linear-gradient(to left, var(--paper-3), transparent) right / 18px 100% no-repeat',boxShadow:'inset -12px 0 12px -12px var(--ink-3)'}:undefined}>
      <div
        ref={inner}
        className={`email-html text-body leading-relaxed text-ink [&_a]:text-accent [&_a]:underline [&_img]:my-1 [&_img]:rounded ${showQuote ? "" : "[&_blockquote]:hidden"}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      </div>
      {hasQuote && (
        <button
          type="button"
          onClick={() => setShowQuote((v) => !v)}
          className="mt-2 inline-flex min-h-9 items-center rounded-md px-2 text-meta font-semibold text-accent-2 hover:bg-hover"
        >
          {showQuote ? "Hide quoted text" : "Show quoted text"}
        </button>
      )}
    </div>
  );
}

function PlainBody({ paras }: { paras: string[] }) {
  const [showQuote, setShowQuote] = useState(false);
  const {text,quote}=splitQuotedText(paras);
  const shown=(showQuote?[reflowPlainText(text),quote]:[reflowPlainText(text)]).filter(Boolean);
  return (
    <div className="flex flex-col gap-2.5">
      {shown.map((para, j) => (
        <p
          key={j}
          className="whitespace-pre-line break-words text-body leading-relaxed text-ink"
        >
          {para}
        </p>
      ))}
      {quote && (
        <button
          type="button"
          onClick={() => setShowQuote((v) => !v)}
          className="inline-flex min-h-9 w-fit items-center rounded-md px-2 text-meta font-semibold text-accent-2 hover:bg-hover"
        >
          {showQuote ? "Hide quoted text" : "Show quoted text"}
        </button>
      )}
    </div>
  );
}

/** The same conflict/restore flow protects drafts on every channel. */
function useSafeDraft(saved:ReturnType<typeof useComposerDraft>, threadId:string, onError:(message:string)=>void) {
  const [suggestion,setSuggestion]=useState<SavedInboxDraft|null>(null);
  const [previous,setPrevious]=useState<SavedInboxDraft|null>(null);
  const [pending,start]=useTransition();
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  function generate(intent='', model=saved.latest.current.model) {
    const snapshot={...saved.latest.current};
    const revision=saved.revision.current;
    onError('');
    start(async()=>{
      const r=await runAction(()=>draftReplyAction(threadId,regenerateModel(model),intent),{fallback:'Could not draft a reply.'});
      if(!alive.current)return;
      if(!r.ok){onError(r.error??'Could not draft a reply.');return;}
      const candidate:SavedInboxDraft={...snapshot,body:r.body??'',toEmail:snapshot.toEmail||r.toEmail||'',humanEdited:false,ai:true,model:r.model??'Hermes',basedOn:r.basedOn,sources:r.sources};
      const result=draftGenerationResult(snapshot,saved.latest.current,candidate,saved.revision.current!==revision);
      setPrevious(result.previous);setSuggestion(result.suggestion);
      if(!result.suggestion)saved.set(result.value);
    });
  }
  return {pending,generate,controls:<>
    {suggestion&&<div className="rounded border border-ai/30 bg-ai-soft p-2 text-meta">
      <p>Your reply is safe. Review the suggestion before replacing it.</p><details><summary className="cursor-pointer py-1">Compare</summary><p className="mb-2 whitespace-pre-line border-b border-rule pb-2">Your reply: {saved.value.body}</p><p className="whitespace-pre-line">{suggestion.body}</p></details>
      <div className="flex gap-2"><Button size="sm" onClick={()=>{setPrevious({...saved.latest.current});saved.set({...saved.latest.current,body:suggestion.body,ai:suggestion.ai,model:suggestion.model,basedOn:suggestion.basedOn,sources:suggestion.sources,humanEdited:false});setSuggestion(null);}}>Use suggestion</Button><Button size="sm" variant="ghost" onClick={()=>setSuggestion(null)}>Keep mine</Button></div>
    </div>}
    {previous&&<Button variant="ghost" size="sm" onClick={()=>{saved.set(previous);setPrevious(null);setSuggestion(null);}}>Restore previous</Button>}
  </>};
}
/** A bounded excerpt always announces its scope and offers local expansion. */
function RequestExcerpt({text,compact,links=[]}:{text:string;compact:boolean;links?:{href:string;label:string}[]}) {
  const [open,setOpen]=useState(false);
  const [overflow,setOverflow]=useState(false);
  const ref=useRef<HTMLQuoteElement>(null);
  useLayoutEffect(()=>{
    const el=ref.current;if(!el)return;
    const measure=()=>setOverflow(el.scrollHeight>el.clientHeight+1);
    const observer=new ResizeObserver(measure);observer.observe(el);measure();return()=>observer.disconnect();
  },[text,compact,open]);
  return <div className="flex min-h-0 flex-col">
    <div className="flex shrink-0 items-center gap-2 text-meta text-ink-3"><span>Request excerpt</span><button type="button" aria-expanded={open} className="min-h-11 text-accent-2 underline" onClick={()=>setOpen(v=>!v)}>{open?'less':'more'}</button></div>
    <div className="relative min-h-0 overflow-hidden">
      <blockquote ref={ref} aria-label="Incoming request" className={`max-h-[35dvh] overflow-y-auto whitespace-pre-line border-l-2 border-accent pl-2 pr-1 text-body text-ink-2 ${compact&&!open?'line-clamp-2':open?'':'max-h-[24dvh]'}`}>{links.reduce((value,link)=>value.replace(`\n\n${link.label}`,''),text)}{links.length>0&&<span className="mt-2 flex flex-wrap gap-2">{links.map(link=><a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="text-accent-2 underline">{link.label}</a>)}</span>}</blockquote>
      {overflow&&!open&&<button type="button" className="absolute inset-x-0 bottom-0 flex min-h-11 items-end justify-end bg-gradient-to-t from-paper-2 via-paper-2/90 to-transparent text-meta font-semibold text-accent-2" onClick={()=>setOpen(true)}>Read more ↓</button>}
    </div>
  </div>;
}
/** Text height follows wrapped content; resize and keyboard changes re-measure. */
function DraftBody({inputRef,expanded=false,fill=false,...props}:TextareaHTMLAttributes<HTMLTextAreaElement>&{inputRef:RefObject<HTMLTextAreaElement|null>;expanded?:boolean;fill?:boolean}) {
  const [more,setMore]=useState(false);
  useLayoutEffect(()=>{
    const input=inputRef.current;if(!input)return;
    const remaining=()=>setMore(input.scrollHeight-input.scrollTop>input.clientHeight+2);
    const measure=()=>{
      if(expanded){
        input.style.height='0px';input.style.minHeight='0px';
        const fullHeight=input.scrollHeight;
        input.style.height=`${fullHeight}px`;input.style.minHeight=`${fullHeight}px`;
      }else if(fill){input.style.height='100%';input.style.minHeight='0px';}else{input.style.height='0px';input.style.minHeight='0px';const size=draftReviewSize(input.scrollHeight,window.visualViewport?.height??window.innerHeight,parseFloat(getComputedStyle(input).lineHeight)||24);input.style.height=`${size.height}px`;}
      remaining();
    };
    measure();let width=input.clientWidth;
    const observer=new ResizeObserver(()=>{if(input.clientWidth!==width){width=input.clientWidth;measure();}else remaining();});
    observer.observe(input);input.addEventListener('scroll',remaining);window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);
    return ()=>{observer.disconnect();input.removeEventListener('scroll',remaining);window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);};
  },[props.value,expanded,fill,inputRef]);
  return <div className={`relative flex min-h-0 flex-col ${expanded?'shrink-0':fill?'flex-1':'shrink'}`}><textarea {...props} ref={inputRef} rows={8} className={`${props.className??''} block min-h-0 pb-1 ${expanded?'shrink-0 overflow-hidden':fill?'flex-1 overflow-y-auto':'shrink max-h-full overflow-y-auto'}`}/>{more&&<div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-card via-card/90 to-transparent pt-5 text-right text-meta text-accent-2">More below ↓</div>}</div>;
}
function useComposerViewport() {
  const [viewportSize,setViewportSize]=useState<{height:number;inset:number}|null>(null);
  useEffect(()=>{
    if(typeof window==='undefined')return;
    const viewport=window.visualViewport;
    const measure=()=>setViewportSize({height:Math.floor((viewport?.height??window.innerHeight)*0.45),inset:Math.max(0,window.innerHeight-(viewport?.height??window.innerHeight)-(viewport?.offsetTop??0))});
    measure();viewport?.addEventListener('resize',measure);viewport?.addEventListener('scroll',measure);
    return ()=>{viewport?.removeEventListener('resize',measure);viewport?.removeEventListener('scroll',measure);};
  },[]);
  return {'--inbox-composer-max':viewportSize?`${viewportSize.height}px`:'45dvh','--inbox-keyboard-inset':`${viewportSize?.inset??0}px`} as React.CSSProperties;
}
function useReplyShortcut(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  onOpen?: () => void,
) {
  useEffect(() => {
    const root = ref.current?.closest("[data-inbox-root]");
    const reply = () => {
      onOpen?.();
      requestAnimationFrame(() => ref.current?.focus());
    };
    root?.addEventListener("inbox-reply", reply);
    return () => root?.removeEventListener("inbox-reply", reply);
  });
}

function ThreadTasks({ todos = [] }: { todos?: InboxTodo[] }) {
  if (!todos.length) return null;
  return (
    <div aria-label="Linked to-dos" className="my-3 space-y-2">
      {todos.map((todo) => (
        <a
          key={todo.id}
          href={`/engine?work=${todo.id}`}
          className="flex min-h-11 items-start gap-2 rounded-lg border border-rule bg-paper-2 px-3 py-2 text-body text-accent-2"
        >
          <ListPlus className="mt-1 size-4 shrink-0" />
          <span>
            To-do: {todo.title}
            <span className="block text-meta text-ink-3">
              {todo.assignees ?? "Open to-do"} {todoDateLabel(todo).startsWith("Scheduled")?" · Scheduled":""}
              {todo.due_at
                ? ` · ${new Date(todo.due_at.length === 10 ? todo.due_at + "T12:00:00Z" : todo.due_at).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" })}`
                : ""}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}

function ChannelReaderBody({
  reader,
  todos,
  threadId,
  visible,
  onSendDone,
  mailbox = "", userId=mailbox, owner=false,
  onOpenConversation,availableConversations=[],
}: {
  userId?:string;owner?:boolean;
  onOpenConversation?:(id:string)=>void;availableConversations?:string[];
  reader: ThreadReader;
  todos?: InboxTodo[];
  threadId: string;
  visible?: boolean;
  onSendDone?:()=>Promise<{ok:boolean;error?:string}>;
  mailbox?: string;
}) {
  const [earlierEmail,setEarlierEmail]=useState<{id:string;subject:string}[]>([]);
  const [emailSearch,setEmailSearch]=useState('');
  const [searchAttempt,setSearchAttempt]=useState(0);
  useEffect(()=>{
    if(reader.channel!=='site_form'||!reader.form?.email)return;
    let active=true;setEmailSearch('Checking earlier email…');
    findInquiryConversationsAction(threadId).then(result=>{if(!active)return;if(result.ok){setEarlierEmail(result.conversations ?? []);setEmailSearch('');}else setEmailSearch(result.error ?? 'Could not check earlier email.');}).catch(()=>{if(active)setEmailSearch('Could not check earlier email.');});
    return ()=>{active=false;};
  },[threadId,reader.channel,reader.form?.email,searchAttempt]);
  const conversations=[...new Map([...(reader.form?.conversations ?? []),...earlierEmail].map(c=>[c.id,c])).values()];
  const scroller = useRef<HTMLDivElement>(null);
  const files=useMailFiles();
  const saved = useComposerDraft({mailbox,userId,owner,threadKey:threadId,channel:reader.channel,
    initial:{toEmail:reader.form?.email??'',subject:reader.form?.outgoingSubject??reader.subject}});
  const body = saved.value.body;
  const setBody = (body: string) => saved.set({ ...saved.value, body, humanEdited:true });
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const [replying,setReplying]=useState(false);
  useReplyShortcut(replyRef,()=>setReplying(true));
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [retryDone,setRetryDone]=useState<null|(()=>Promise<{ok:boolean;error?:string}>)>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const chat = reader.channel !== "site_form";
  const safety=useSafeDraft(saved,threadId,setError);
  const composerStyle=useComposerViewport();
  const [retried,setRetried]=useState<Set<string>>(new Set());
  const expanded=composerExpanded(replying,body);
  function generate(intent=''){setReplying(true);setSent(false);safety.generate(intent);}
  useLayoutEffect(() => {
    if (chat && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [chat, threadId, reader.messages, visible]);
  const canReply = chat || Boolean(reader.messages[0]?.fromEmail);
  function send(andDone=false) {
    setError("");
    start(async () => {
      let snapshot;
      try{snapshot=await saved.prepare();}catch(e){setError((e as Error).message);return;}
      let sendWarning:string|undefined;
      const r = await sendWithReceipt(mailbox,threadId,reader,reader.form?.email ?? reader.replyLabel ?? reader.channel,()=>runAction(
        async () => {const result=await sendChannelReplyAction({ threadId, body:snapshot.draft.body, ...(reader.channel==='site_form'?{files:files.data()}:{}) });sendWarning=result.warning;return result;},
        { fallback: "Could not send your reply." },
      ),andDone?onSendDone:undefined,()=>{files.clear();setSent(true);});
      if (r.sent) {
        if(r.error){setError(r.error);setRetryDone(()=>r.retry??null);}
        if(sendWarning)setError(sendWarning);
        files.clear();setSent(true);
        const warning=await saved.finish(snapshot.version);if(warning)setError(warning);
        window.dispatchEvent(new Event('inbox-drafts-changed'));
        router.refresh();
      } else setError(r.error ?? "Could not send your reply.");
    });
  }
  function retryMessage(message:ThreadReader['messages'][number]) {
    if(!message.id || !message.outbound || !/failed|undelivered|expired/i.test(message.deliveryState??'') || message.retry || retried.has(message.id))return;
    setError('');
    start(async()=>{
      const result=await runAction(()=>sendChannelReplyAction({threadId,body:message.body.join('\n\n'),retryOfId:message.id}),{fallback:'Could not retry your message.'});
      if(result.ok)setRetried(ids=>new Set([...ids,message.id!]));
      else setError(result.error??'Could not retry your message.');
      router.refresh();
    });
  }
  return (
    <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ThreadSummary reader={reader} />
        <div className="flex flex-col gap-3">
          {reader.messages.map((m, i) => {
            const day = m.date
              ? new Date(m.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "";
            const previous = reader.messages[i - 1]?.date;
            const newDay =
              day &&
              (!previous ||
                new Date(previous).toDateString() !==
                  new Date(m.date!).toDateString());
            return (
              <div key={m.id ?? i}>
                {chat && newDay && (
                  <div
                    role="separator"
                    className="mb-3 text-center text-meta text-ink-3"
                  >
                    {day}
                  </div>
                )}
                <div
                  className={`flex flex-col ${chat && m.outbound ? "items-end" : "items-start"}`}
                >
                  <div className="mb-1 text-meta text-ink-3">
                    {m.fromName} · {m.meta}
                  </div>
                  <div
                    className={
                      chat
                        ? `max-w-[90%] rounded-xl px-3 py-2 ${m.outbound ? "bg-accent-soft" : "border border-rule bg-card"}`
                        : "w-full"
                    }
                  >
                    {reader.channel === "site_form" && reader.form ? (
                      <div className="rounded-xl border border-rule bg-card p-4">
                        <h2 className="text-subheading font-semibold">
                          {reader.form.name}
                        </h2>
                        <p className="mt-1 text-meta text-ink-3">
                          {reader.form.contacted?"Contacted":"New website inquiry"}
                          {reader.form.town ? ` · ${reader.form.town}` : ""}
                        </p>
                        {Boolean(conversations.length)&&<div className="my-2 border-y border-rule-soft py-2 text-meta"><p className="font-semibold">{reader.form.contacted?'Contacted · Open email conversation':'Existing email conversation — review before replying'}</p>{conversations.map(c=><a key={c.id} className="flex min-h-11 items-center text-accent-2 underline" href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(mailbox)}#all/${encodeURIComponent(c.id)}`} target="_blank" rel="noopener noreferrer" onClick={e=>{if(availableConversations.includes(c.id)&&onOpenConversation){e.preventDefault();onOpenConversation(c.id);}}}>{c.subject} ↗</a>)}</div>}
                        {emailSearch&&<p role="status" className="my-2 text-meta text-ink-3">{emailSearch}{emailSearch!=='Checking earlier email…'&&<Button size="sm" variant="ghost" onClick={()=>setSearchAttempt(n=>n+1)}>Retry email check</Button>}</p>}
                        <p className="my-3 whitespace-pre-line text-body font-semibold leading-relaxed">
                          {m.body[0]}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {reader.form.phone && (
                            <>
                              <a
                                href={`tel:${reader.form.phone.replace(/[^+0-9]/g, "")}`}
                                className="inline-flex min-h-11 items-center rounded-full border border-rule px-3 text-meta text-accent-2"
                              >
                                Call {formatContactPhone(reader.form.phone)}
                              </a>
                              <a
                                href={`sms:${reader.form.phone.replace(/[^+0-9]/g, "")}`}
                                className="inline-flex min-h-11 items-center rounded-full border border-rule px-3 text-meta text-accent-2"
                              >
                                Text
                              </a>
                            </>
                          )}
                          {reader.form.email && (
                            <a
                              href={`mailto:${reader.form.email}`}
                              title={reader.form.email}
                              className="inline-flex min-h-11 max-w-full items-center truncate rounded-full border border-rule px-3 text-meta text-accent-2"
                            >
                              Email {reader.form.email}
                            </a>
                          )}
                        </div>
                        {m.body.length > 1 && (
                          <details className="mt-2">
                            <summary className="min-h-11 cursor-pointer py-3 text-meta text-accent-2">
                              Inquiry details
                            </summary>
                            <PlainBody paras={m.body.slice(1)} />
                          </details>
                        )}
                      </div>
                    ) : reader.channel === "site_form" &&
                      m.body.length > 1 &&
                      m.body.slice(1).every((p) => FORM_FIELD.test(p)) ? (
                      <>
                        <p className="mb-3 whitespace-pre-line text-body font-semibold">
                          {m.body[0]}
                        </p>
                        <dl className="space-y-2">
                          {m.body.slice(1).map((para, j) => {
                            const [, label, value] =
                              para.match(FORM_FIELD) ?? [];
                            return (
                              <div key={j}>
                                <dt className="text-meta text-ink-3">
                                  {label}
                                </dt>
                                <dd className="whitespace-pre-line text-body">
                                  {value}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      </>
                    ) : <>
                      {m.body.some(p=>p.trim())?<PlainBody paras={m.body}/>:!m.media?.length&&<p className="text-body text-ink-3">No text or stored media is available for this message.</p>}
                      {m.media?.map(media=><a key={media.file_id} href={`/api/files/${encodeURIComponent(media.file_id)}`} target="_blank" rel="noopener noreferrer" className="my-2 block max-w-full rounded-md border border-rule p-2 text-meta text-accent-2 underline">
                        {/^image\//.test(media.mime)&&<img src={`/api/files/${encodeURIComponent(media.file_id)}?w=600`} alt={media.name} loading="lazy" className="mb-1 max-h-64 max-w-full rounded object-contain"/>}
                        {media.name} · {fileSize(media.size)} · Open file
                      </a>)}
                      {reader.channel==='sms'&&m.originalHref&&<a href={m.originalHref} className="mt-2 block text-meta text-accent-2 underline">Open original message · {m.fromName} · {m.date?new Date(m.date).toLocaleString('en-US'):m.meta}</a>}
                    </>}
                  </div>
                  {chat&&m.outbound&&m.deliveryState&&<div className="mt-1 flex max-w-[90%] flex-wrap items-center justify-end gap-1 text-meta text-ink-3">
                    <span className={!m.retry&&/failed|undelivered|expired/i.test(m.deliveryState)?'text-flag':''}>{m.retry?`Retried · ${m.retry.status} ${new Date(m.retry.at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`:retried.has(m.id??'')?'Retry submitted · see newest message':/failed|undelivered|expired/i.test(m.deliveryState)?'Failed':m.deliveryState==='sent'?'Sent':m.deliveryState==='delivered'?'Delivered':m.deliveryState==='queued'?'Queued':m.deliveryState==='sending'?'Sending':m.deliveryState}</span>
                    {m.deliveryError&&!m.retry&&<span className="break-words text-flag">{m.deliveryError}</span>}
                    {m.id&&!m.retry&&/failed|undelivered|expired/i.test(m.deliveryState)&&<Button size="sm" variant="secondary" disabled={pending||retried.has(m.id)} onClick={()=>retryMessage(m)}>Retry</Button>}
                  </div>}
                </div>
              </div>
            );
          })}
        </div>
        <ThreadTasks todos={todos} />
      </div>
      <div
        data-reply-active={expanded}
        style={composerStyle}
        className={`flex min-h-0 flex-col border-t border-rule bg-paper-2 px-4 py-2 mb-[var(--inbox-keyboard-inset)] flex-none max-h-[var(--inbox-composer-max)]`}
        onFocusCapture={() =>
          window.dispatchEvent(
            new CustomEvent("sjc:inbox-surface", { detail: true }),
          )
        }
      >
        <div className="min-h-0 max-sm:overflow-y-auto">
        {canReply && <>
          <p title={reader.replyLabel} className="truncate text-meta font-semibold text-ink-2">{reader.replyLabel}</p>
          {reader.form&&<p className="truncate text-meta text-ink-3">Subject: {reader.form.outgoingSubject}</p>}

        {safety.controls}
          {expanded ? <>
            {saved.value.ai&&<p className="text-meta text-ai">Draft by {saved.value.model} · {saved.value.basedOn}</p>}
            <DraftBody inputRef={replyRef} aria-label={reader.channel==='sms'?'Text reply':'Reply'} value={body} disabled={pending} onChange={e=>{setBody(e.target.value);setSent(false);}} placeholder="Write a reply…" className="w-full resize-none rounded-lg border border-rule bg-card p-2 text-body text-ink" />
            <div className="grid grid-cols-2 gap-1">
              <div className="order-last col-span-2 flex flex-wrap items-center gap-1">
                  {reader.channel==='site_form'&&files.picker(pending)}
              <Button variant="ai" size="sm" onClick={()=>generate()} disabled={safety.pending||pending}>Draft with AI</Button>
              <Button variant="ghost" size="sm" onClick={()=>{if(!files.confirmLoss())return;start(async()=>{try{await saved.clear();files.clear();setReplying(false);}catch(e){setError((e as Error).message);}});}} disabled={pending}>Discard</Button>
              </div>

            </div>
            <details><summary className="cursor-pointer py-1 text-meta text-ink-3">Reply intent</summary><div className="flex flex-wrap gap-1">{['Yes, works','Need more info','Schedule a visit','Thanks'].map(intent=><Button key={intent} variant="ghost" size="sm" disabled={pending||safety.pending} onClick={()=>generate(intent)}>{intent}</Button>)}</div></details>
          </> : <div className="flex min-h-13 items-center gap-2 rounded-lg border border-rule bg-card px-3">
            <button onClick={()=>{setReplying(true);requestAnimationFrame(()=>replyRef.current?.focus());}} className="min-h-11 min-w-0 flex-1 truncate text-left text-body text-ink-3">Write a reply…</button>
            <Button variant="ai" size="sm" onClick={()=>generate()} disabled={safety.pending||pending}>Draft with AI</Button>
          </div>}
          {reader.channel==='sms'&&<p className="text-meta text-ink-3">{body.trim()?`${smsSegments(body)} segment${smsSegments(body)===1?'':'s'}`:'0 characters'}</p>}
          {safety.pending&&<p role="status" className="text-meta text-ink-3">Drafting a reply…</p>}
        </>}
        <DraftSyncFooter saved={saved} disabled={pending} localFiles={files.files.length>0}/>
        {retryDone&&<Button variant="secondary" disabled={pending} onClick={()=>start(async()=>{const r=await retryDone();if(r.ok){setRetryDone(null);setError('');}else setError("Sent — couldn't mark done");})}>Retry marking done</Button>}
        {sent && (
          <p role="status" className="mt-2 text-meta text-accent-2">
            {reader.channel === "site_form"
              ? "Reply sent by email."
              : reader.channel === "sms"
                ? "Text sent."
                : "Reply posted to portal."}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-meta text-flag">
            {error}
          </p>
        )}
        {reader.actionHref && (
          <a
            href={reader.actionHref}
            className="mt-2 inline-flex min-h-11 items-center gap-1 text-meta text-accent-2 underline"
          >
            <ExternalLink className="size-3" />
            {reader.actionLabel ?? "Open project"}
          </a>
        )}
        </div>
        {canReply&&expanded&&<div className="grid shrink-0 grid-cols-2 gap-1 bg-paper-2 pt-2">
          <Button aria-label={channelCommitLabel(reader.channel)} className="min-h-11 min-w-0 @4xl/page:min-h-8" icon={Send} disabled={!body.trim()||pending||safety.pending||sent} onClick={()=>send()}>{pending?'Sending…':<><span className="@4xl/page:hidden">Send</span><span className="hidden @4xl/page:inline">{channelCommitLabel(reader.channel)}</span></>}</Button>
          {onSendDone&&<Button variant="secondary" className="min-h-11 min-w-0 @4xl/page:min-h-8" disabled={!body.trim()||pending||safety.pending||sent} onClick={()=>send(true)}>Send &amp; Done</Button>}
        </div>}

      </div>
    </>
  );
}

function ThreadRow({
  thread,
  selected,
  onSelect,
  onDone,
  onRemind,
  onScreen, onTomorrow, compact=false,
}: {
  thread: InboxThread;
  selected: boolean;
  onSelect: () => void;
  onDone?: () => void;
  onRemind?: (anchor?:HTMLElement) => void;
  onScreen?:()=>void;
  onTomorrow?:()=>void;
  compact?:boolean;
  onAdd?:(kind:"lead"|"sub"|"vendor")=>void;
  onOther?:()=>void;
}) {
  const touch=useRef<{x:number;y:number}|null>(null);
  const swiped=useRef(false);
  const [drag,setDrag]=useState(0);
  const Icon = CHANNEL_ICON[thread.channel];
  const [rowMenu, setRowMenu] = useState(false);
  const attention=automationState(thread).attention;
  const needs = thread.view!=="done"&&(Boolean(thread.needsMeReason) || thread.view === "needs_reply");
  const unread=thread.unread&&thread.view!=="done"&&thread.inboundLast!==false;
  return (
    <div
      className={`group relative border-b border-rule-soft ${selected ? "bg-selected" : "hover:bg-hover"}`}
    >
      {Math.abs(drag)>=20&&<span aria-hidden className="absolute inset-y-0 flex items-center px-3 text-meta font-semibold text-accent-2" style={drag>0?{left:0}:{right:0}}>{drag>0?'Done':'Tomorrow 8 AM'}</span>}
      {(selected||attention) && <span className={`absolute inset-y-0 left-0 w-[3px] ${attention?"bg-warn":"bg-accent"}`} />}
      <button
        data-thread-row={thread.id}
        onClick={e=>{if(swiped.current){e.preventDefault();swiped.current=false;return;}onSelect();}}
        style={{touchAction:'pan-y',transform:drag?`translateX(${drag}px)`:undefined}}
        onTouchStart={e=>{if(e.touches.length!==1){touch.current=null;return;}const p=e.touches[0];touch.current={x:p.clientX,y:p.clientY};swiped.current=false;}}
        onTouchMove={e=>{if(!touch.current)return;const p=e.touches[0],dx=p.clientX-touch.current.x,dy=p.clientY-touch.current.y;if(Math.abs(dy)>Math.abs(dx)){touch.current=null;setDrag(0);}else setDrag(Math.max(-110,Math.min(110,dx)));}}
        onTouchCancel={()=>{touch.current=null;setDrag(0);}}
        onTouchEnd={e=>{const from=touch.current;touch.current=null;setDrag(0);if(!from||!e.changedTouches[0])return;const p=e.changedTouches[0],intent=swipeIntent(p.clientX-from.x,p.clientY-from.y);if(intent){swiped.current=true;if(intent==='done')onDone?.();else onTomorrow?.();}}}
        aria-current={selected ? "true" : undefined}
        className="flex min-h-16 w-full items-start gap-2 px-3 py-2 text-left [@media(hover:none)]:pr-14"
      >
        <span className={`relative mt-1 shrink-0 ${compact?"hidden":""}`}>
          <Avatar initials={thread.initials} kind={needs ? "accent" : "gray"} />
          <span
            title={thread.channel.replaceAll("_", " ")}
            className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full border border-rule bg-card"
          >
            <Icon className="size-2.5 text-accent-2" />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-h-7 items-center gap-1.5">
            {compact&&<Icon className="size-3 shrink-0 text-accent-2" aria-label={thread.channel.replaceAll('_',' ')}/>}
            <span
              className={`min-w-0 flex-1 truncate text-label ${unread ? "font-bold text-ink" : needs ? "font-semibold text-ink" : "text-ink-2"}`}
            >
              {thread.fromName}
            </span>
            {unread && !attention && (
              <span
                aria-label="Unread"
                className="size-1.5 shrink-0 rounded-full bg-accent"
              />
            )}
            <span className="w-16 shrink-0 text-right text-meta text-ink-3 group-hover:invisible group-focus-within:invisible [@media(hover:none)]:!visible">{thread.when}</span>
          </span>
          <span className="line-clamp-2 text-body leading-snug text-ink-2">
            {rowActionTitle(thread)}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            {thread.needsMeReason?.startsWith('Draft ready')&&<span className="shrink-0 rounded bg-ai-soft px-1 text-meta font-semibold text-ai">Draft</span>}
            <span className={`${thread.projectLabel?"hidden":"min-w-0 truncate"} text-meta ${attention?'text-warn':needs?'text-accent-2':'text-ink-3'}`} title={thread.automated?automationState(thread).label:thread.needsMeReason}>{thread.automated?(attention?'':automationState(thread).label):thread.needsMeReason?.replace(/^Draft ready(?: · )?/, '')|| (thread.view==='awaiting_them'?'Waiting for their reply':thread.view==='done'?'Done':'Unread')}</span>
          </span>
          {(thread.projectLabel||Boolean(thread.outstandingCents))&&<span data-row-job title={thread.projectLabel} className="flex min-w-0 items-baseline gap-2 text-meta">
            <span className="min-w-0 flex-1 break-words text-ink-2">{thread.projectLabel&&shortJobLabel(thread.projectLabel)}</span>
            {Boolean(thread.outstandingCents)&&<span title="Outstanding" className="shrink-0 tabular-nums text-warn">{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(thread.outstandingCents!/100)}<span className={compact?"sr-only":""}> outstanding</span></span>}
          </span>}

          {threadTodoCue(thread)&&<span title={threadTodoCue(thread)} aria-label="Open to-do" className="block truncate text-meta text-accent-2">{threadTodoCue(thread)}</span>}
          {thread.newSender&&!compact&&<span title={thread.fromEmail} className="block truncate text-meta text-ink-3">{thread.fromEmail}</span>}

          {automationDeadline(thread.attentionEvidence??'',thread.receivedAt)&&<span className="my-0.5 inline-block rounded bg-warn-soft px-1 text-meta font-semibold text-warn">{automationDeadline(thread.attentionEvidence??'',thread.receivedAt)}</span>}

        </span>
      </button>
      {onScreen&&<div className="px-3 pb-1"><Button variant="secondary" size="sm" onClick={onSelect}>Screen…</Button></div>}
      <div className="absolute top-2 right-2 hidden max-h-7 items-center rounded-md border border-rule bg-card shadow-card group-hover:flex group-focus-within:flex [@media(hover:none)]:hidden">
        <Button
          variant="ghost"
          size="sm"
          icon={Check}
          iconOnly
          aria-label={`Done: ${thread.fromName}`}
          title="Done (e)"
          onClick={onDone}
          className="!size-7 !min-h-7 !min-w-7"
        />
        <Button
          variant="ghost"
          size="sm"
          icon={Clock}
          iconOnly
          aria-label={`Remind me: ${thread.fromName}`}
          title="Remind me (h)"
          onClick={e=>onRemind?.(e.currentTarget)}
          className="!size-7 !min-h-7 !min-w-7"
        />
      </div>
      <Button
        variant="ghost"
        icon={MoreHorizontal}
        iconOnly
        aria-label={`Actions: ${thread.fromName}`}
        title="Conversation actions"
        aria-expanded={rowMenu}
        onClick={() => setRowMenu((v) => !v)}
        className="absolute right-1 top-2 hidden size-11 [@media(hover:none)]:inline-flex"
      />
      {rowMenu && (
        <div
          role="menu"
          className="flex flex-wrap justify-end gap-2 border-t border-rule-soft bg-card px-2 py-1"
        >
          <Button
            variant="ghost"
            icon={Check}
            onClick={() => {
              setRowMenu(false);
              onDone?.();
            }}
            className="min-h-11"
          >
            Done
          </Button>
          <Button
            variant="ghost"
            icon={Clock}
            onClick={() => {
              setRowMenu(false);
              onRemind?.();
            }}
            className="min-h-11"
          >
            Remind me
          </Button>
          <Button variant="ghost" icon={Clock} className="min-h-11" onClick={()=>{setRowMenu(false);onTomorrow?.();}}>Tomorrow 8 AM</Button>
        </div>
      )}
    </div>
  );
}

function EmailMessageCard({
  message,
  threadId,
  expanded,
  onToggle,
  blockImages=false, mailbox="", subject="Email conversation", userId=mailbox, owner=false,
}: {
  blockImages?:boolean; mailbox?:string; subject?:string;userId?:string;owner?:boolean;
  message: ThreadReader["messages"][number];
  threadId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [forwarding,setForwarding]=useState(false);
  const [content,setContent]=useState<EmailHtmlResult|{status:'loading';html:''}>({status:'loading',html:''});
  const [readingMode,setReadingMode]=useState<"readable"|"original">("original");
  const [receiptChoice,setReceiptChoice]=useState<'auto'|'compact'|'formatted'>('auto');
  const [compactReceipt,setCompactReceipt]=useState(false);
  const imageKey=`sjc:inbox:images:v1:${mailbox.toLowerCase()}:${message.fromEmail?.toLowerCase()??''}`;
  const [allowedImages,setAllowedImages]=useState(false);
  useEffect(()=>{try{setAllowedImages(localStorage.getItem(imageKey)==='show');}catch{}},[imageKey]);
  const [attempt,setAttempt]=useState(0);
  const loaded=useRef('');
  useEffect(() => {
    if(!expanded)return;
    const key=`${threadId}:${message.id}:${attempt}`;
    if(loaded.current===key)return;
    let alive=true;
    setContent({status:'loading',html:''});
    const failed={status:'failed',html:'',error:'Could not load formatted email. Showing text below.'} as const;
    const timer=setTimeout(()=>{if(alive){alive=false;loaded.current=key;setContent(failed);}},20_000);
    if(!message.id){clearTimeout(timer);loaded.current=key;setContent(failed);return;}
    getThreadHtmlAction(threadId,message.id).then(result=>{
      if(!alive)return;
      clearTimeout(timer);loaded.current=key;setContent(result);
    }).catch(()=>{if(alive){clearTimeout(timer);loaded.current=key;setContent(failed);}});
    return ()=>{alive=false;clearTimeout(timer);};
  },[expanded,threadId,message.id,attempt]);
  const html=content.html;
  const imagePolicy=useMemo(()=>applyRemoteImagePolicy(html,!blockImages||allowedImages),[html,blockImages,allowedImages]);
  const receiptAvailable=useMemo(()=>receiptFields(imagePolicy.html).length>0,[imagePolicy.html]);
  return (
    <article id={`inbox-message-${encodeURIComponent(message.id??'')}`} className="overflow-hidden rounded-lg border border-rule bg-card">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex h-11 w-full items-center gap-2 px-3 text-left"
      >
        <Avatar initials={message.initials} size="sm" />
        <span className="max-w-[35%] truncate text-meta font-semibold text-ink">
          {message.fromName}
        </span>
        {!expanded && (
          <span className="min-w-0 flex-1 truncate text-meta text-ink-3">
            {substantiveSnippet(message.body)}
          </span>
        )}
        <span className="ml-auto shrink-0 text-meta text-ink-3">
          {message.meta}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-rule-soft px-3 py-3">
          <details className="mb-2 break-words text-meta text-ink-3">
            <summary className="min-h-8 cursor-pointer py-1 text-meta">
              Message details
            </summary>
            <p>
              {message.fromName} {message.fromEmail && `<${message.fromEmail}>`}
            </p>
            <p>To: {message.to}</p>
            {Boolean(message.cc?.length) && <p>Cc: {message.cc!.join(", ")}</p>}
            {message.date && (
              <p>{new Date(message.date).toLocaleString("en-US")}</p>
            )}
          </details>
          {html ? (
            <>
              <div className="mb-2 flex items-center gap-1" aria-label="Reading mode"><Button size="sm" variant={readingMode==='readable'?'secondary':'ghost'} aria-pressed={readingMode==='readable'} onClick={()=>setReadingMode('readable')}>Readable</Button>{receiptAvailable&&<Button size="sm" variant={readingMode==='original'&&compactReceipt?'secondary':'ghost'} aria-pressed={readingMode==='original'&&compactReceipt} onClick={()=>{setReceiptChoice('compact');setReadingMode('original');}}>Compact receipt</Button>}<Button size="sm" variant={readingMode==='original'&&!compactReceipt?'secondary':'ghost'} aria-pressed={readingMode==='original'&&!compactReceipt} onClick={()=>{setReceiptChoice('formatted');setReadingMode('original');}}>Formatted</Button></div>
              {readingMode==='original'&&imagePolicy.blocked>0&&<div className="mb-2 flex flex-wrap items-center gap-2 text-meta text-ink-3"><span>{imagePolicy.blocked} remote {imagePolicy.blocked===1?"resource":"resources"} blocked ·</span><Button variant="secondary" size="sm" onClick={()=>{setAllowedImages(true);try{localStorage.setItem(imageKey,'show');}catch{}}}>Show images</Button></div>}
              <EmailHtml receiptChoice={readingMode==='original'?receiptChoice:'formatted'} onCompactReceipt={setCompactReceipt} key={`${imageKey}:${allowedImages}:${readingMode}`} html={readingMode==='readable'?readableEmailHtml(imagePolicy.html):imagePolicy.html} />
            </>
          ) : <>
            {content.status==='loading'&&<p role="status" className="mb-2 text-meta text-ink-3">Loading formatted email… Text preview below.</p>}
            {content.status==='text-only'&&<p className="mb-2 text-meta text-ink-3">Text-only email · no HTML part</p>}
            {content.status==='failed'&&<div role="status" className="mb-2 flex flex-wrap items-center gap-2 text-meta text-ink-3"><span>{content.error}</span>{attempt<MAX_HTML_RETRIES?<Button size="sm" variant="secondary" onClick={()=>setAttempt(a=>a+1)}>Retry formatted email ({MAX_HTML_RETRIES-attempt} left)</Button>:<span>Retry limit reached. Reopen the conversation later to try again.</span>}</div>}
            <PlainBody paras={message.body}/>
          </>}
          {message.id&&<Button variant="ghost" size="sm" onClick={()=>setForwarding(true)}>Forward</Button>}
          {forwarding&&<ComposeModal selfEmail={mailbox} userId={userId} owner={owner} onClose={()=>setForwarding(false)} forward={{threadId,subject,message}}/>}
          {Boolean(message.attachments?.length) && (
            <ul
              aria-label="Attachments"
              className="mt-3 space-y-1 border-t border-rule-soft pt-2"
            >
              {message.attachments!.map((a, i) => (
                <li
                  key={a.id || i}
                  className="break-words text-meta text-ink-2"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2"><Paperclip className="size-3.5 shrink-0"/><span className="min-w-0 flex-1 break-all">{a.name} · {Math.ceil(a.size / 1024)} KB</span>{message.id&&a.id&&<><a className="inline-flex min-h-11 items-center px-2 text-accent-2 underline" target="_blank" rel="noopener noreferrer" href={`/api/inbox/attachment?${new URLSearchParams({thread:threadId,message:message.id,attachment:a.id})}`}>Open</a><a className="inline-flex min-h-11 items-center px-2 text-accent-2 underline" href={`/api/inbox/attachment?${new URLSearchParams({thread:threadId,message:message.id,attachment:a.id,download:'1'})}`}>Download</a></>}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

// Scrollable message body + AI draft card + send composer, with the draft/send
// state for this thread. Keyed on threadId by the caller so it resets on switch.
// Arrival suggestions remain separate from the human draft until accepted.
// On-demand regeneration uses the same protected composer and explicit Send.
function ReaderBody({
  reader,
  todos,
  threadId,
  onDone,
  onMakeTodo,
  onSendDone,
  needsAttention,
  onDraftReady,
  mailbox = "",
  blockImages=false, userId=mailbox, owner=false, newSender=false, screening, initialSuggestion=null,
}: {
  newSender?:boolean;screening?:ReactNode;initialSuggestion?:InboxDraft|null;
  userId?:string;owner?:boolean;
  blockImages?:boolean;
  reader: ThreadReader;
  todos?: InboxTodo[];
  threadId: string;
  onDone?: () => void;
  onMakeTodo?:()=>void;
  onSendDone?:()=>Promise<{ok:boolean;error?:string}>;
  needsAttention?:boolean;
  onDraftReady?: (id: string, ready: boolean) => void;
  mailbox?: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set([
        reader.messages[latestInboundIndex(reader.messages)]?.id ??
          String(latestInboundIndex(reader.messages)),
      ]),
  );
  const saved = useComposerDraft({mailbox,userId,owner,threadKey:threadId,channel:'email',
    latestMessageId:reader.messages.findLast(m=>!m.outbound)?.id, initialSuggestion,
    initial:{body:reader.aiDraft.body,toEmail:reader.replyTarget?.toEmail??'',subject:reader.subject}});
  const sentPreviewHidden=useRef(false);
  const [dismissed,setDismissed]=useState<string|null>(null);
  const suggestion=saved.suggestion?.id!==dismissed?saved.suggestion:null;
  // A pristine composer previews the suggestion as an approval card. It is
  // still separate from Joe's synced draft until he edits or clicks Send.
  const preview=Boolean(suggestion&&!saved.value.body&&!saved.accepted&&!sentPreviewHidden.current);
  const display=preview&&suggestion?{...saved.value,body:suggestion.body,toEmail:suggestion.toEmail,ai:true,model:suggestion.model==='claude'?'Claude':'Hermes',basedOn:suggestion.basedOn,sources:suggestion.sources}:saved.value;
  const {body:draft,toEmail,ai:isAI,model}=display;
  const replyAll=Boolean(saved.synced.draft.cc.length);
  const update=(patch:Partial<SavedInboxDraft>)=>{
    if(preview)saved.acceptSuggestion();
    saved.set({...display,...patch},preview?suggestion?.id:undefined);
  };
  const [replying, setReplying] = useState(false);
  // Filed as automated, but Joe may still answer it (the server only refuses no-reply addresses).
  const [replyAnyway, setReplyAnyway] = useState(false);
  const mode = composerMode(newSender,replyAnyway,Boolean(reader.automated));
  const automated = mode==='automated';
  const screeningFirst=mode==='screen';
  const [reviewExpanded,setReviewExpanded]=useState(false);
  const [showSource,setShowSource]=useState(false);
  const [sourceMessage,setSourceMessage]=useState<string|null>(null);
  function openDraftSource(id:string){
    setSourceMessage(id);setShowSource(true);setExpanded(prev=>new Set([...prev,id]));
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const target=document.getElementById(`inbox-message-${encodeURIComponent(id)}`);
      const history=target?.closest('details');if(history)history.open=true;
      target?.scrollIntoView({block:'nearest',behavior:'smooth'});
    }));
  }
  const [draftOpen, setDraftOpen] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [retryDone,setRetryDone]=useState<null|(()=>Promise<{ok:boolean;error?:string}>)>(null);
  const safety=useSafeDraft(saved,threadId,setError);
  const drafting=safety.pending;
  const composerStyle=useComposerViewport();
  const [sending, startSend] = useTransition();
  const files=useMailFiles();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const latestPassage=useRef<HTMLDivElement>(null);
  const approvalRef = useRef<HTMLTextAreaElement>(null);
  const recipientsRef=useRef<HTMLDetailsElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const hasDraft = Boolean(draft.trim());
  const reviewActive=hasDraft&&!sent&&!screeningFirst&&!automated;
  const incoming=reader.messages[latestInboundIndex(reader.messages)];
  useEffect(() => {
    onDraftReady?.(threadId, hasDraft && isAI && !sent);
  }, [threadId, hasDraft, isAI, sent, onDraftReady]);
  useEffect(() => {
    const root = regionRef.current?.closest("[data-inbox-root]");
    const reply = () => {
      if (automated || screeningFirst || !reader.replyTarget) return;
      setReplying(true);
      if (isAI) setDraftOpen(true);
      requestAnimationFrame(() =>
        (isAI ? approvalRef : composerRef).current?.focus(),
      );
    };
    const approve = () => {
      if (!isAI) return;
      setDraftOpen(true);
      requestAnimationFrame(() =>
        root?.querySelector<HTMLButtonElement>("[data-draft-send]")?.focus(),
      );
    };
    root?.addEventListener("inbox-reply", reply);
    root?.addEventListener("inbox-approve", approve);
    return () => {
      root?.removeEventListener("inbox-reply", reply);
      root?.removeEventListener("inbox-approve", approve);
    };
  }, [isAI, automated, screeningFirst, reader.replyTarget]);
  useEffect(() => {
    if (typeof window !== "undefined" && (replying || draftOpen || drafting))
      window.dispatchEvent(
        new CustomEvent("sjc:inbox-surface", { detail: true }),
      );
  }, [replying, draftOpen, drafting]);
  useEffect(()=>{
    if(typeof window!=='undefined'&&(replying||draftOpen)&&window.matchMedia('(max-width: 639px)').matches){
      requestAnimationFrame(()=>{const scroller=regionRef.current,passage=latestPassage.current;if(scroller&&passage)scroller.scrollTop=passage.offsetTop-scroller.offsetTop;});
    }
  },[replying,draftOpen]);
  function toggleMessage(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function generate(intent = "") {
    setError("");
    setSent(false);
    setDraftOpen(true);
    safety.generate(intent,model);
  }

  function discard() {
    if(!files.confirmLoss())return;
    startSend(async()=>{
      try{
        if(preview&&suggestion){await dismissSuggestion(suggestion.id);setDismissed(suggestion.id);await saved.synced.refresh();}
        else await saved.clear();
        files.clear();setReplying(false);setDraftOpen(false);setReviewExpanded(false);setSent(false);setError('');onDraftReady?.(threadId,false);
        window.dispatchEvent(new Event('inbox-drafts-changed'));
      }catch(e){setError((e as Error).message);}
    });
  }
  function send(andDone=false) {
    setError('');
    startSend(async()=>{
      let snapshot;
      const suggestionId=preview?suggestion?.id:saved.accepted?.id;
      try{
        if(preview)saved.acceptSuggestion();
        // Flush the exact accepted suggestion or the text currently displayed.
        snapshot=await (preview ? saved.synced.flush() : saved.prepare());
        if(!snapshot||snapshot.status!=='saved'||snapshot.conflict)throw Error('Resolve the draft save before sending.');
        if(snapshot.draft.body!==draft||snapshot.draft.toEmail!==toEmail)throw Error('This draft changed while saving. Review it before sending.');
      }catch(e){setError((e as Error).message);return;}
      const r=await sendWithReceipt(mailbox,threadId,reader,snapshot.draft.toEmail,()=>runAction(
        ()=>sendReplyAction({threadId,toEmail:snapshot.draft.toEmail,replyAll:Boolean(snapshot.draft.cc.length),subject:snapshot.draft.subject,body:snapshot.draft.body,files:files.data()}),
        {fallback:'Send failed.'}),andDone?onSendDone:undefined,()=>{sentPreviewHidden.current=true;files.clear();setSent(true);});
      if(!r.sent){setError(r.error??'Send failed.');return;}
      if(r.error){setError(r.error);setRetryDone(()=>r.retry??null);}
      setSent(true);setDraftOpen(false);setReviewExpanded(false);setReplying(false);onDraftReady?.(threadId,false);
      const warning=await saved.finish(snapshot.version,suggestionId);if(warning)setError(warning);
      window.dispatchEvent(new Event('inbox-drafts-changed'));
      router.refresh();
    });
  }
  const approval = (
    <div data-draft-card className={`flex flex-col rounded-lg border border-ai/35 bg-card p-2 ${reviewExpanded?'min-h-fit shrink-0':'min-h-0 flex-1'}`}>
      <div className="flex shrink-0 items-start gap-1 text-meta text-ink-3">
        <details ref={recipientsRef} className="min-w-0 flex-1">
          <summary className="min-h-11 cursor-pointer list-none py-1" title={`To ${toEmail}`}>
            <span className="block truncate font-semibold text-ink">To {draftRecipientName(toEmail,reader.replyTarget)} ▾</span>
            <span className="block truncate text-ai">Draft by {model || 'AI'} · not sent</span>
          </summary>
          <div className="max-h-40 space-y-1 overflow-y-auto border-t border-rule-soft py-2">
            <p className="break-all">From {mailbox}</p>
            <label>To <input aria-label="AI reply recipient" type="email" value={toEmail} disabled={sending} onChange={e=>update({toEmail:e.target.value})} className="min-h-9 w-full bg-paper p-1"/></label>
            <label className="flex min-h-9 items-center gap-1"><input type="checkbox" checked={replyAll} disabled={sending||!reader.replyTarget?.cc.length} onChange={e=>{if(preview)saved.acceptSuggestion();saved.synced.setDraft(d=>({...d,cc:e.target.checked?reader.replyTarget?.cc??[]:[]}));}}/>Reply all{replyAll&&` · ${saved.synced.draft.cc.join(', ')}`}</label>{!reader.replyTarget?.cc.length&&<p className="text-meta text-ink-3">No other recipients on this email.</p>}
          </div>
        </details>
        <Button size="sm" variant={replyAll?'secondary':'ghost'} disabled={sending} aria-label="Cc and reply-all options" onClick={()=>{if(recipientsRef.current)recipientsRef.current.open=!recipientsRef.current.open;}}>{replyAll?'Reply-all':'Cc / Reply-all'}</Button>
        {!reviewExpanded&&<Button variant="ghost" icon={Maximize2} iconOnly aria-label="Expand review" title="Expand review" className="size-11 shrink-0" onClick={()=>setReviewExpanded(true)}/>}
      </div>
      {display.basedOn&&<details data-draft-sources title={`Based on: ${display.basedOn.replace(/^Based on:\s*/i,'')}`} className="shrink-0 text-meta text-ink-3">
        <summary className="min-h-8 cursor-pointer py-1 text-accent-2">Based on{display.sources?.length?` · ${display.sources.length} sources`:''}</summary>
        {display.sources?.length?<ul className="max-h-40 space-y-1 overflow-y-auto pb-2">{display.sources.map((source,i)=><li key={i}>{source.kind==='message'?<button type="button" className="min-h-11 break-words text-left text-accent-2 underline" onClick={()=>openDraftSource(source.messageId)}>{source.label}</button>:<a className="inline-flex min-h-11 items-center text-accent-2 underline" href={sourceHref(source)} target="_blank" rel="noopener noreferrer">{source.label} ↗</a>}</li>)}</ul>:<><p className="text-meta">Exact references were not saved for this older draft.</p><ul className="list-disc space-y-1 pb-2 pl-4">{draftInputSources(display.basedOn).map(source=><li key={source} className="break-words">{source}</li>)}</ul></>}
        <button type="button" className="mb-1 min-h-9 text-accent-2 underline" onClick={()=>setShowSource(true)}>Read full message</button>
      </details>}
      <DraftBody
        onFocus={() => window.dispatchEvent(new CustomEvent("sjc:inbox-surface", { detail: true }))}
        inputRef={approvalRef}
        expanded={reviewExpanded} fill={reviewActive}
        aria-label="AI draft body"
        value={draft}
        disabled={sending}
        onChange={(e) => update({ body: e.target.value, humanEdited:true })}
        className="w-full resize-none bg-transparent text-body leading-relaxed text-ink outline-none focus-visible:ring-1 focus-visible:ring-focus"
      />
    </div>
  );
  return (
    <div className={reviewExpanded?"absolute inset-0 z-[65] flex min-h-0 flex-col bg-paper":"flex min-h-0 flex-1 flex-col"}>
      {reviewExpanded&&<div className="flex shrink-0 items-center justify-between border-b border-rule px-4 py-2"><span className="min-w-0 break-words text-meta font-semibold text-accent-2">Review reply · {draftRecipientName(toEmail,reader.replyTarget)}</span><Button variant="ghost" onClick={()=>setReviewExpanded(false)}>Close review</Button></div>}

      <div ref={regionRef} hidden={reviewActive&&!showSource} className={`min-h-0 overflow-y-auto px-4 py-2 ${reviewActive?"max-h-[40%] shrink-0":"flex-1"}`}>
        <div className="mx-auto flex max-w-[720px] flex-col gap-2">
          {reader.websiteInquiry&&<p className="text-meta text-accent-2">From website inquiry</p>}
          {sourceMessage&&!reader.messages.some(m=>m.id===sourceMessage)&&<EmailMessageCard threadId={threadId} mailbox={mailbox} userId={userId} owner={owner} subject={reader.subject} blockImages={blockImages} expanded onToggle={()=>setSourceMessage(null)} message={{id:sourceMessage,fromName:'Saved draft source',initials:'S',meta:'',to:'',body:[]}}/>}
          {!reviewActive&&<ThreadSummary reader={reader} />}
          {latestInboundIndex(reader.messages) > 0 && (
            <details open={sourceMessage&&reader.messages.slice(0,latestInboundIndex(reader.messages)).some(m=>m.id===sourceMessage)?true:undefined}>
              <summary className="min-h-8 cursor-pointer truncate py-1 text-meta font-semibold text-accent-2">
                {latestInboundIndex(reader.messages)} earlier {reader.automated?`${reader.automationKind?.toLowerCase()??"notification"}${latestInboundIndex(reader.messages)===1?"":"s"}`:latestInboundIndex(reader.messages)===1?"message":"messages"}
                <span className="ml-2 font-normal text-ink-3">{reader.messages[latestInboundIndex(reader.messages)-1]?.fromName} · {substantiveSnippet(reader.messages[latestInboundIndex(reader.messages)-1]?.body??[])}</span>
              </summary>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setExpanded(
                    new Set(reader.messages.map((m, i) => m.id ?? String(i))),
                  )
                }
              >
                Expand all
              </Button>
              <div className="space-y-2">
                {reader.messages
                  .slice(0, latestInboundIndex(reader.messages))
                  .map((m, i) => (
                    <EmailMessageCard
                      key={m.id ?? i}
                      message={m}
                      blockImages={m.imagesBlocked??(blockImages&&!m.outbound)} mailbox={mailbox} userId={userId} owner={owner} subject={reader.subject}
                      threadId={threadId}
                      expanded={expanded.has(m.id ?? String(i))}
                      onToggle={() => toggleMessage(m.id ?? String(i))}
                    />
                  ))}
              </div>
            </details>
          )}
          {reader.messages
            .slice(latestInboundIndex(reader.messages))
            .map((m, j) => {
              const id =
                m.id ?? String(latestInboundIndex(reader.messages) + j);
              return (
                <div key={id} ref={j===0?latestPassage:undefined}><EmailMessageCard
                  message={m}
                  blockImages={m.imagesBlocked??(blockImages&&!m.outbound)} mailbox={mailbox} userId={userId} owner={owner} subject={reader.subject}
                  threadId={threadId}
                  expanded={expanded.has(id)}
                  onToggle={() => toggleMessage(id)}
                /></div>
              );
            })}
          <ThreadTasks todos={todos} />

        </div>
      </div>
      <div
        data-reply-active={!screeningFirst&&(composerExpanded(replying,draft)||draftOpen)}
        style={composerStyle}
        className={`flex min-h-0 flex-col border-t border-rule bg-paper-2 px-4 py-2 mb-[var(--inbox-keyboard-inset)] ${reviewActive?"flex-1":"flex-none max-h-[var(--inbox-composer-max)]"}`}
        onFocusCapture={() =>
          window.dispatchEvent(
            new CustomEvent("sjc:inbox-surface", { detail: true }),
          )
        }
        onBlur={(e) => {
          if (
            !e.currentTarget.contains(e.relatedTarget as Node | null) &&
            !draft.trim()
          )
            setReplying(false);
        }}
      >
        <div className={`min-h-0 flex-1 ${reviewActive?`flex flex-col ${reviewExpanded?'overflow-y-auto':'overflow-hidden'}`:"overflow-y-auto max-sm:overflow-y-auto"}`}>
        {screeningFirst ? <div data-screen-first>{screening}<details className="mt-2"><summary className="min-h-9 cursor-pointer text-meta text-ink-3">Reply options</summary><Button variant="secondary" onClick={()=>{setReplyAnyway(true);setReplying(true);}}>Reply anyway</Button></details></div> : automated ? (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-meta text-ink-3">
              {needsAttention?"Automated message · Needs your attention":"Automated message"}
            </p>
            {reader.replyTarget && !isNoReplyAddress(reader.replyTarget.toEmail) && (
              <Button variant="ghost" onClick={() => { setReplyAnyway(true); setReplying(true); }}>Reply anyway</Button>
            )}
            {needsAttention&&<Button variant="secondary" onClick={onMakeTodo}>Make to-do</Button>}

          </div>
        ) : !reader.replyTarget ? (
          <p className="text-meta text-ink-3">
            No incoming message to reply to.
          </p>
        ) : (
          <>
            {!isAI&&(composerExpanded(replying, draft) || draftOpen) && (
              <details className="mb-2 text-base text-ink-2 @4xl/page:text-body">
                <summary title={toEmail} className="min-h-8 cursor-pointer truncate py-1 font-semibold">
                  To: {reader.replyTarget.toName} &lt;{toEmail}&gt; · Email
                </summary>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-full border border-rule bg-card px-2 py-1">
                    To: {reader.replyTarget.toName} &lt;
                    <input
                      aria-label="Reply recipient"
                      type="email"
                      value={toEmail}
                      disabled={sending}
                      onChange={(e) => update({ toEmail: e.target.value })}
                      className="min-h-11 min-w-0 max-w-full bg-transparent text-base text-ink outline-none @4xl/page:text-body"
                    />
                    &gt;
                  </label>
                  <label className="inline-flex min-h-11 items-center gap-1">
                    <input
                      type="checkbox"
                      checked={replyAll}
                      onChange={(e) => saved.synced.setDraft(d=>({...d,cc:e.target.checked?reader.replyTarget!.cc:[]}))}
                    />
                    Reply all
                  </label>
                  {replyAll &&
                    reader.replyTarget.cc.map((email) => (
                      <Chip key={email} kind="ghost">
                        Cc: {email}
                      </Chip>
                    ))}
                </div>
              </details>
            )}
            {reviewActive&&<div className="mb-2 flex max-h-[40%] min-h-0 shrink-0 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-2 text-meta text-ink-3"><span>{reader.messages.length} {reader.messages.length===1?'message':'messages'}{latestInboundIndex(reader.messages)>0?` · ${latestInboundIndex(reader.messages)} earlier`:''}</span><button type="button" aria-expanded={showSource} className="min-h-8 text-accent-2 underline" onClick={()=>setShowSource(v=>!v)}>{showSource?'Hide full message':'Read full message'}</button>{!isAI&&!reviewExpanded&&<Button size="sm" variant="ghost" onClick={()=>setReviewExpanded(true)}>Expand review</Button>}</div>
              {!showSource&&<RequestExcerpt text={askExcerpt(incoming?.body??[],reader.subject)} compact={reviewExpanded} links={excerptLinks(splitQuotedText(incoming?.body??[]).text)}/>}
            </div>}
            {safety.controls}
            {suggestion&&!preview&&saved.accepted?.id!==suggestion.id&&<div className="rounded-md border border-ai/30 bg-ai-soft p-2 text-meta">
              <p>{suggestion.model==='hermes'?'Hermes':'Claude'} drafted a reply</p>
              <div className="flex flex-wrap gap-1"><Button size="sm" disabled={sending} onClick={()=>{saved.acceptSuggestion();setSent(false);}}>Use it</Button>
              <details><summary className="min-h-8 cursor-pointer px-2 py-1">Compare</summary><p className="whitespace-pre-line">Your reply: {draft}</p><p className="mt-2 whitespace-pre-line">{suggestion.body}</p><p className="text-ink-3">Based on: {suggestion.basedOn.replace(/^Based on:\s*/i,'')}</p></details>
              <Button size="sm" variant="ghost" disabled={sending} onClick={()=>startSend(async()=>{try{await dismissSuggestion(suggestion.id);setDismissed(suggestion.id);await saved.synced.refresh();window.dispatchEvent(new Event('inbox-drafts-changed'));}catch{setError('Could not dismiss the suggestion.');}})}>Dismiss</Button></div>
            </div>}
            {hasDraft&&<div aria-label="Regenerate reply intent" className="mb-1 flex shrink-0 flex-wrap gap-1">{['Yes, works','Need more info','Schedule a visit'].map(intent=><Button key={intent} size="sm" variant="ghost" className="min-h-9 @4xl/page:min-h-7" disabled={drafting||sending} onClick={()=>generate(intent)}>{intent}</Button>)}</div>}
            {isAI && hasDraft ? approval : composerExpanded(replying, draft) ? (
              <div className={`flex flex-col rounded-lg border border-rule bg-card p-2 ${reviewExpanded?'min-h-fit shrink-0':reviewActive?'min-h-0 flex-1':'min-h-0 shrink'}`}>
                <DraftBody
                  inputRef={composerRef}
                  expanded={reviewExpanded} fill={reviewActive}
                  aria-label="Reply body"
                  value={draft}
                  disabled={sending}
                  onChange={(e) => {
                    setSent(false);
                    update({ body: e.target.value, humanEdited:true });
                  }}
                  placeholder={reader.replyPlaceholder}
                  className="w-full resize-none bg-transparent text-body leading-relaxed text-ink outline-none"
                />
                <div className="grid grid-cols-2 gap-1">
                  <div className="order-last col-span-2 flex flex-wrap items-center gap-1">
                  {files.picker(sending)}
                  <Button variant="ai" size="sm" onClick={()=>generate()} disabled={drafting||sending}>Draft with AI</Button>
                  <VoiceButton
                    compact
                    onText={(t) => update({ body: mergeTranscript(draft, t), humanEdited:true })}
                  />
                  <Button variant="ghost" onClick={discard}>
                    Discard
                  </Button>
                  </div>

                </div>
              </div>
            ) : (
              <div className="flex min-h-13 items-center gap-2 rounded-lg border border-rule bg-card px-3">
                <button
                  type="button"
                  onFocus={() => {
                    setReplying(true);
                    requestAnimationFrame(() => composerRef.current?.focus());
                  }}
                  onClick={() => {
                    setReplying(true);
                    setSent(false);
                    requestAnimationFrame(() => composerRef.current?.focus());
                  }}
                  title="Reply (r)"
                  className="min-h-11 min-w-0 flex-1 truncate text-left text-body text-ink-3"
                >
                  {`Reply to ${reader.replyTarget.toName}…`}
                </button>
                <Button
                  variant="ai"
                  icon={Sparkles}
                  size="sm"
                  onClick={() => generate()}
                  disabled={drafting || sending}
                  className="min-h-11 shrink-0"
                >
                  Draft with AI
                </Button>
              </div>
            )}

            {!isAI && composerExpanded(replying, draft) && (
              <details className="mt-1"><summary className="cursor-pointer text-meta text-ink-3">Reply intent</summary><div className="flex flex-wrap items-center gap-1">
                {[
                  "Yes, works",
                  "Need more info",
                  "Schedule a visit",
                  "Thanks",
                ].map((intent) => (
                  <Button
                    key={intent}
                    variant="ghost"
                    size="sm"
                    onClick={() => generate(intent)}
                    disabled={drafting || sending}
                    className="min-h-11 shrink-0 @4xl/page:min-h-7"
                  >
                    {intent}
                  </Button>
                ))}
              </div></details>
            )}
            {drafting && (
              <p role="status" className="mt-1 text-meta text-ink-3">
                Drafting a reply…
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="mt-1 text-meta text-flag">
            {error}
          </p>
        )}
        {retryDone&&<Button variant="secondary" disabled={sending} onClick={()=>startSend(async()=>{const r=await retryDone();if(r.ok){setRetryDone(null);setError('');}else setError("Sent — couldn't mark done");})}>Retry marking done</Button>}
        {sent && (
          <p role="status" className="mt-1 text-meta text-ink-3">
            Reply sent ✓
          </p>
        )}
        {!isAI&&hasDraft&&!screeningFirst&&<DraftSyncFooter saved={saved} disabled={sending} localFiles={files.files.length>0}/>}
        </div>
        {reviewActive&&isAI&&<div data-draft-tools className="shrink-0 pt-1">
          <div className="flex flex-nowrap items-center gap-1 overflow-x-auto">
            {files.picker(sending,true)}
            <Button variant="ghost" size="sm" className="min-h-11 shrink-0 @4xl/page:min-h-8" onClick={()=>generate()} disabled={drafting||sending}>Regenerate</Button>
            <Button variant="ghost" size="sm" className="min-h-11 shrink-0 @4xl/page:min-h-8" onClick={discard} disabled={sending}>Discard</Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-meta text-ink-3"><span>Your Send click approves this draft.</span><DraftSyncFooter saved={saved} disabled={sending} localFiles={files.files.length>0}/></div>
        </div>}
        {!automated&&!screeningFirst&&reader.replyTarget&&(composerExpanded(replying,draft)||draftOpen)&&<div className="grid shrink-0 grid-cols-2 gap-1 bg-paper-2 pt-2">
          <Button data-draft-send={isAI||undefined} className="min-h-11 min-w-0 @4xl/page:min-h-8" icon={Send} disabled={!hasDraft||!toEmail.trim()||sending||drafting||sent} onClick={()=>send()}>{sending?'Sending…':'Send email'}</Button>
          {onSendDone&&<Button variant="secondary" className="min-h-11 min-w-0 @4xl/page:min-h-8" disabled={!hasDraft||!toEmail.trim()||sending||drafting||sent} onClick={()=>send(true)}>Send &amp; Done</Button>}
        </div>}

      </div>
    </div>
  );
}

/** Which mailbox this inbox is reading, pinned under the Channels rail. Before
 *  staff logins the answer was hardcoded in the rail label as "Email (joe@sjc)",
 *  which is exactly the kind of detail of Joe's that has no business on someone
 *  else's account. Now it reports the connected address, and offers the Connect
 *  / Disconnect controls for a person's own mailbox. */
function MailboxStrip({ mailbox }: { mailbox: MailboxState }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!mailbox.connected) {
    return (
      <div className="mt-1 rounded-md border border-dashed border-rule px-2 py-2">
        <p className="text-meta leading-snug text-ink-3">No email connected.</p>
        {mailbox.canConnect ? (
          <a
            href="/api/inbox/oauth/start"
            className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-meta font-semibold text-white hover:bg-accent-2"
          >
            <Mail className="size-3" strokeWidth={1.5} /> Connect your email
          </a>
        ) : (
          <p className="mt-1 text-meta leading-snug text-ink-3">
            Ask Joe to finish the Gmail app setup first.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1 px-2 py-1">
      <p
        className="truncate text-meta text-ink-3"
        title={mailbox.email ?? undefined}
      >
        {mailbox.email ?? "Gmail connected"}
      </p>
      {mailbox.linked && (
        <button
          onClick={() =>
            start(async () => {
              await runAction(() => disconnectMyMailboxAction(), {
                fallback: "Couldn't disconnect.",
              });
              router.refresh();
            })
          }
          disabled={pending}
          className="mt-0.5 text-meta text-ink-3 underline hover:text-flag disabled:opacity-50"
        >
          {pending ? "Disconnecting…" : "Disconnect"}
        </button>
      )}
    </div>
  );
}

/** Thread-list body when this account has no mailbox linked. Blank, not the
 *  demo mock and not Joe's mail (his rule, 2026-09-27: "link able to their
 *  email otherwise blank"). */
function NoMailboxPrompt() {
  return (
    <EmptyState
      icon={Inbox}
      title="Your conversations live here"
      description="Texts, portal messages and website forms appear here as they arrive. Your email will appear here once Gmail is connected."
      compact
    />
  );
}
