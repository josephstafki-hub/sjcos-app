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
} from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
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
  splitQuotedText,
  substantiveSnippet,
  channelCommitLabel,
  smsSegments,
  latestInboundIndex,
  composerExpanded,
  isNoReplyAddress,
} from "@/lib/inbox-rules";
import { remoteImagePolicy } from "@/lib/inbox-image-policy";
import { mergeTranscript } from "@/lib/append-transcript";
import {
  draftReplyAction,
  getThreadHtmlAction,
  sendReplyAction,
  sendChannelReplyAction,
  sendNewEmailAction,
  setThreadStarredAction,
  setThreadReadAction,
  setThreadImportantAction,
  archiveThreadAction,
  restoreThreadToInboxAction,
  trashThreadAction,
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
  orderedInboxThreads, rowDay, canLoadMore, completionQueue, attentionTaskTitle, draftGenerationResult,
  applyInboxPreferences,
  contextStripText, threadTodoCue, todoDateLabel, contextLayout,
  completeAfterSend,
  shortJobLabel,
  formatContactPhone,
  matchesInboxTab,
  tabCounts,
  shortcutFor,
  draftKey,
  readDraft,
  writeDraft,
  type InboxTab,
  type SavedInboxDraft,
} from "@/lib/inbox-experience";
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
}: {
  data: InboxData;
  /** The signed-in person's own address — the connected mailbox when there is
   *  one, else their login email. Used only to prefill Compose's To: field.
   *  Was `ownerEmail`, which handed Joe's address to every staff login. */
  selfEmail: string;
}) {
  const [lens, setLens] = useState<Lens>({ kind: "all" });
  const [tab, setTab] = useState<InboxTab | null>("needs");
  const [query, setQuery] = useState("");
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
  const [contextPreference,setContextPreference]=useState(true);
  const tabsRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{try{setContextPreference(localStorage.getItem('sjc:inbox:context')!=='closed');}catch{}},[]);
  useEffect(()=>{
    const root=rootRef.current;
    if(!root)return;
    const observer=new ResizeObserver(([entry])=>{
      const layout=contextLayout(entry.contentRect.width);
      setWideContext(layout.docked);setCompactList(layout.compact);
    });
    observer.observe(root);return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{tabsRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});},[tab]);
  function closeContext(){setContext(null);if(wideContext){setContextPreference(false);try{localStorage.setItem('sjc:inbox:context','closed');}catch{}}}
  function openContext(){setContext('job');if(wideContext){setContextPreference(true);try{localStorage.setItem('sjc:inbox:context','open');}catch{}}}

  const [task, setTask] = useState<{
    thread: InboxThread;
    remind: boolean;
  } | null>(null);
  const [help, setHelp] = useState(false);
  const [selectedId, setSelectedId] = useState(data.selectedId);
  // Mobile master/detail: below lg, show the thread list OR the reader, not both.
  const router = useRouter();
  const [mobileReader, setMobileReader] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("sjc:inbox-surface", {
        detail: Boolean(task || help || linking || context || composing),
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("sjc:inbox-surface", { detail: false }),
      );
    };
  }, [task, help, linking, context, composing]);
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

  useEffect(() => {
    try {
      setDraftIds(
        new Set(
          [...threads, ...(remoteData?.threads ?? [])]
            .filter((t) => {
              const d = readDraft(localStorage, draftKey(selfEmail, t.id));
              return t.view!=="done" && d?.ai && d.body.trim();
            })
            .map((t) => t.id),
        ),
      );
    } catch {}
  }, [selfEmail, threads, remoteData]);

  useEffect(()=>setPreferences({}),[selfEmail]);
  async function savePreference(thread:InboxThread,kind:'sender'|'thread',decision:string|null, offerUndo=true) {
    const target=kind==='sender'?thread.fromEmail:thread.id;if(!target)return false;
    const r=await runAction(()=>setInboxPreferenceAction(kind,target,decision),{fallback:'Could not save your decision.'});
    if(!r.ok){setNotice(r.error??'Could not save your decision.');return false;}
    setPreferences(p=>({...p,[`${kind}:${kind==='sender'?target.toLowerCase():target}`]:decision}));
    if(offerUndo){
      setNotice(decision==='other'?'Filed in Other.':'Screening decision saved.');
      setUndo({label:'Undo filing',run:async()=>{if(await savePreference(thread,kind,r.previous??null,false)){setNotice('Decision undone.');setUndo(null);}}});
    }
    router.refresh();return true;
  }
  function fileSender(thread:InboxThread,other:boolean){startTransition(async()=>{await savePreference(thread,'sender',other?'other':null);});}

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
            (lens.view === "needs_reply" && draftIds.has(t.id)),
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
  }, [threads, lens, remoteData, draftIds]);

  const baseVisible=useMemo(()=>sourceVisible.map(t=>applyInboxPreferences(t,preferences)),[sourceVisible,preferences]);

  const visible = useMemo(
    () =>
      orderedInboxThreads(baseVisible
        .filter(
          (t) =>
            (!tab || matchesInboxTab(t, tab, draftIds.has(t.id))) &&
            `${t.fromName} ${t.fromEmail??""} ${t.subject} ${t.preview} ${t.projectLabel ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .filter((t,i,all)=>tab!=='new'||all.findIndex(other=>other.fromEmail?.toLowerCase()===t.fromEmail?.toLowerCase())===i)),
    [baseVisible, tab, draftIds, query],
  );
  // Count of threads sitting in the Gmail inbox (the plain "Inbox" rail view).
  const inboxCount = useMemo(
    () => threads.filter((t) => t.inInbox).length,
    [threads],
  );

  const counts = useMemo(
    () => tabCounts(baseVisible, draftIds),
    [baseVisible, draftIds],
  );
  // Keep the selection valid as the lens narrows the list.
  const selected =
    visible.find((t) => t.id === selectedId) ?? visible[0] ?? null;
  const reader = selected ? readers[selected.id] : undefined;
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

  const selectLabel = (id: string, name: string) => {
    setLens({ kind: "label", id, name });
    fetchRemote(`label:${id}`, () => loadLabelInboxAction(id));
  };

  const selectSystem = (view: SystemViewKey) => {
    setLens({ kind: "system", view });
    fetchRemote(`system:${view}`, () => loadSystemViewAction(view));
  };

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
    const r=await runAction(()=>t.channel==='email'?archiveThreadAction(t.id):markChannelDoneAction(t.id,readers[t.id]?.messages.at(-1)?.date??0),{fallback:'Could not mark done.'});
    if(!r.ok){setNotice(sent?"Sent — couldn't mark done":r.error??'Could not mark done.');return r;}
    const queue=completionQueue([...new Map([...threads,...(remoteData?.threads??[])].map(t=>[t.id,applyInboxPreferences(t,preferences)])).values()],t.id,draftIds);
    const next=queue.next;
    const patch=(v:InboxThread)=>v.id===t.id?{...v,inInbox:false,view:'done' as const,needsMeReason:undefined,newSender:false}:v;
    setThreads(ts=>[...new Map([...ts,...(remoteData?.threads??[])].map(v=>[v.id,patch(v)])).values()]);setRemoteData(d=>d?{...d,threads:d.threads.map(patch)}:d);
    setDraftIds(ids=>new Set([...ids].filter(id=>id!==t.id)));
    setLens({kind:'all'});setTab('needs');setQuery('');setSelectedId(next?.id??'');setMobileReader(Boolean(next));
    setNotice(`${sent?'Sent and marked done.':'Marked done.'} ${queue.left} left in Needs me.`);
    setUndo({label:sent?'Undo Done — the message stays sent.':'Undo Done',run:async()=>{
      const result=await runAction(()=>t.channel==='email'?restoreThreadToInboxAction(t.id):undoChannelDoneAction(t.id),{fallback:'Could not undo Done.'});
      if(result.ok){setThreads(ts=>ts.map(v=>v.id===t.id?t:v));setRemoteData(d=>d?{...d,threads:d.threads.map(v=>v.id===t.id?t:v)}:d);setNotice('Done undone.');setUndo(null);setSelectedId(t.id);router.refresh();}else setNotice(result.error??'Could not undo Done.');
    }});
    router.refresh();return {ok:true};
  }
  const archiveSelected = () => {
    if (selected) startTransition(async()=>{await doneThread(selected);});
  };
  function navigate(delta: number) {
    const i = visible.findIndex((t) => t.id === selected?.id);
    const t = visible[Math.max(0, Math.min(visible.length - 1, i + delta))];
    if (t) {
      setSelectedId(t.id);
      rootRef.current
        ?.querySelector<HTMLElement>(`[data-thread-row="${CSS.escape(t.id)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (e.key === "Escape") {
        setMenuOpen(false);
        setShowSources(false);
        closeContext();
        return;
      }
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
        setTask({ thread: selected, remind: true });
      else if (action === "link") setLinking(true);
      else if (action === "search") {
        setMobileReader(false);
        searchRef.current?.focus();
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
        className={`${mobileReader ? "hidden @4xl/page:flex" : "flex"} min-h-12 flex-none flex-wrap items-center gap-2 border-b border-rule bg-paper px-3 py-1 @4xl/page:flex-nowrap`}
      >
        <Button
          onClick={() => setShowSources((v) => !v)}
          variant="ghost"
          icon={Filter}
          aria-expanded={showSources}
          className="min-h-11 @4xl/page:min-h-8"
        >
          Views
        </Button>
        <div ref={tabsRef} className="order-last w-full min-w-0 overflow-x-auto [mask-image:linear-gradient(to_right,black_94%,transparent)] @4xl/page:order-none @4xl/page:w-auto @4xl/page:flex-1">
          <Segmented
            aria-label="Inbox splits"
            value={tab ?? ""}
            onChange={(v) => {
              setTab(v as InboxTab);
              setMobileReader(false);
            }}
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
            onChange={(e) => setQuery(e.target.value)}
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
        {data.mailbox.connected && (
          <Button
            onClick={() => setComposing(true)}
            icon={PenSquare}
            className="min-h-11 @4xl/page:min-h-8"
          >
            Compose
          </Button>
        )}
      </div>
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
              setTab(null);
            }
          }}
          className={`flex-none flex-col overflow-y-auto bg-paper-2 p-3 ${showSources ? "absolute left-2 top-2 z-30 flex max-h-[calc(100%-1rem)] w-72 max-w-[calc(100%-1rem)] rounded-lg border border-rule shadow-pop" : "hidden"}`}
        >
          <button
            onClick={() => setLens({ kind: "inbox" })}
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
                onClick={() => setLens({ kind: "view", view: v.key })}
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
                  onClick={() => setLens({ kind: "channel", channel: c.key })}
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
                      onClick={() =>
                        setLens({ kind: "project", slug, label: p.label })
                      }
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
          className={[
            "min-w-0 w-full flex-none flex-col border-r border-rule-soft",
            compactList && (context || contextPreference) ? "@4xl/page:w-[260px]" : "@4xl/page:w-80 @[1100px]/page:w-[260px] @[1280px]/page:w-[340px]",
            mobileReader ? "hidden @4xl/page:flex" : "flex",
          ].join(" ")}
        >
          {lens.kind !== "all" && (
            <div className="flex min-h-11 items-center gap-2 border-b border-rule-soft px-3">
              <span className="min-w-0 flex-1 truncate text-meta text-ink-3">
                {lensLabel}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLens({ kind: "all" })}
              >
                Clear view
              </Button>
            </div>
          )}
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
                {(i===0||rowDay(t)!==rowDay(visible[i-1]))&&<p className="border-b border-rule-soft bg-paper-2 px-3 py-1.5 text-meta font-semibold text-ink-3">{rowDay(t)}</p>}
                <ThreadRow
                  thread={
                    draftIds.has(t.id) &&
                    !t.automated &&
                    !t.filedOther &&
                    !t.newSender
                      ? { ...t, needsMeReason: "Draft ready to review" }
                      : t
                  }
                  selected={selected?.id === t.id}
                  onDone={() => startTransition(async()=>{await doneThread(t);})}
                  onRemind={() => setTask({ thread: t, remind: true })}
                  compact={compactList && Boolean(context || contextPreference)}
                  onScreen={t.newSender?()=>{setScreeningThread(t);setLinking(true);}:undefined}
                  onAdd={t.newSender?kind=>setAdding({thread:t,kind}):undefined}
                  onOther={t.newSender?()=>fileSender(t,true):undefined}
                  onSelect={() => {
                    setSelectedId(t.id);
                    setMobileReader(true);
                  }}
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
        </section>

        {/* ─── Reader ───────────────────────────────────────────────── */}
        <section
          className={[
            "min-w-0 flex-1 flex-col group/reader",
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
                    disabled={pending}
                    className="min-h-11 @4xl/page:min-h-8"
                  >
                    Done
                  </Button>
                  <Button
                    onClick={() => setTask({ thread: selected, remind: true })}
                    icon={Clock}
                    variant="ghost"
                    title="Remind me (h)"
                    className="hidden @4xl/page:inline-flex"
                  >
                    Remind me
                  </Button>
                  <Button
                    onClick={() => setTask({ thread: selected, remind: false })}
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
                              setTask({ thread: selected, remind: true });
                            }}
                          >
                            Remind me
                          </MenuItem>
                          <MenuItem
                            icon={ListPlus}
                            onClick={() => {
                              setMenuOpen(false);
                              setTask({ thread: selected, remind: false });
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
                              <MenuItem icon={Star} onClick={toggleStar}>
                                {selectedStarred ? "Unstar" : "Star"}
                              </MenuItem>
                              <MenuItem
                                icon={MailOpen}
                                onClick={() => setReadSelected(true)}
                              >
                                Mark as read
                              </MenuItem>
                              <MenuItem
                                icon={Mail}
                                onClick={() => setReadSelected(false)}
                              >
                                Mark as unread
                              </MenuItem>
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
                              <MenuItem
                                icon={Archive}
                                onClick={archiveSelected}
                              >
                                Archive
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
                <div className="px-4 pb-3 max-sm:group-has-[[data-reply-active=true]]/reader:pb-1">
                  <h1 className="line-clamp-2 font-serif text-title font-medium leading-tight text-accent-2 max-sm:group-has-[[data-reply-active=true]]/reader:truncate max-sm:group-has-[[data-reply-active=true]]/reader:text-body">
                    {reader.subject}
                  </h1>
                  <button onClick={openContext} title="Open contact, job, money and to-dos" aria-label="Open person and job context" aria-expanded={Boolean(context || wideContext && contextPreference)} className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-md border border-rule bg-card px-3 text-left text-meta text-ink-2 @4xl/page:min-h-8">
                    <span className="min-w-0 flex-1 truncate">{contextStripText(selected,contextData)}</span><ChevronRight className="size-3.5 shrink-0"/>
                  </button>
                  {selected.automated&&<div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-ink-3"><span>{selected.automationKind??'Notification'}{(selected.attentionOverride??selected.attentionRequired)?` · ${selected.attentionEvidence??'Marked by you'}`:''}</span><Button variant="secondary" size="sm" disabled={pending} onClick={()=>startTransition(async()=>{await savePreference(selected,'thread',(selected.attentionOverride??selected.attentionRequired)?'other':'attention');})}>{(selected.attentionOverride??selected.attentionRequired)?'Keep in Other':'Needs my attention'}</Button></div>}
                  {(selected.newSender||selected.senderDecision)&&selected.fromEmail&&!selected.automated&&<div className="mt-1 flex flex-wrap items-center gap-1 text-meta text-ink-3">
                    <span title={selected.fromEmail} className="w-full truncate">{selected.newSender?'New sender':`Screened: ${selected.senderDecision}`} · {selected.fromEmail}</span>
                    {selected.newSender?<SenderScreening thread={selected} onLink={()=>{setScreeningThread(selected);setLinking(true);}} onAdd={kind=>setAdding({thread:selected,kind})} onOther={()=>fileSender(selected,true)}/>:<Button variant="ghost" size="sm" onClick={()=>startTransition(async()=>{if(await savePreference(selected,'sender','pending'))setTab('new');})}>Undo screening</Button>}
                  </div>}

                </div>
              </div>

              {readerIsEmail ? (
                <ReaderBody
                  key={selected.id}
                  reader={reader}
                  todos={selected.todos}
                  threadId={selected.id}
                  needsAttention={selected.attentionOverride??selected.attentionRequired}
                  onMakeTodo={()=>setTask({thread:selected,remind:false})}
                  onDone={archiveSelected}
                  onSendDone={()=>doneThread(selected,true)}
                  onDraftReady={onDraftReady}
                  mailbox={selfEmail}
                  blockImages={!selected.contactRole && !selected.projectSlug && !["linked","lead","sub","vendor"].includes(selected.senderDecision??"")}
                />
              ) : (
                <ChannelReaderBody
                  key={selected.id}
                  reader={reader}
                  todos={selected.todos}
                  threadId={selected.id}
                  visible={mobileReader}
                  onSendDone={()=>doneThread(selected,true)}
                  mailbox={selfEmail}
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
            onClose={closeContext}
            onLink={() => setLinking(true)}
            onSelect={(id) => {
              setLens({ kind: "all" });
              setTab(null);
              setQuery("");
              setSelectedId(id);
              setMobileReader(true);
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
          thread={task.thread}
          reader={readers[task.thread.id]}
          remind={task.remind}
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
          selfEmail={selfEmail}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}

function ComposeModal({
  selfEmail,
  onClose,
}: {
  selfEmail: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState(selfEmail);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, startSend] = useTransition();

  function send() {
    setError("");
    startSend(async () => {
      const res = await runAction(
        () => sendNewEmailAction({ to, subject, body }),
        { fallback: "Send failed." },
      );
      if (res.ok) {
        setSent(true);
        setTimeout(onClose, 900);
      } else setError(res.error ?? "Send failed.");
    });
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New message"
        className="max-h-[90dvh] w-full max-w-[560px] overflow-y-auto rounded-xl border border-rule-soft bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
          <h3 className="flex-1 text-subheading font-semibold text-ink">
            New message
          </h3>
          <Button
            onClick={onClose}
            icon={X}
            iconOnly
            aria-label="Close new message"
            title="Close new message"
          />
        </div>
        <div className="flex flex-col gap-2 p-4">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To"
            placeholder="To"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-body text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Subject"
            placeholder="Subject"
            className="rounded-md border border-rule bg-paper px-3 py-2 text-body text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            aria-label="Message"
            placeholder="Write your message…"
            className="resize-y rounded-md border border-rule bg-paper px-3 py-2 text-body leading-relaxed text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {error && <p className="text-meta text-flag">{error}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button
              onClick={()=>send()}
              icon={Send}
              disabled={!to.trim() || !body.trim() || sending || sent}
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

/** Where the quoted earlier conversation starts in a plain-text body: the
 *  "On <date>, <name> wrote:" line, or the first "> " quoted line. */
/** A rich email body. Wide newsletter / store emails (fixed 600–700px tables)
 *  are scaled down to the reading column instead of scrolling sideways; the
 *  quoted earlier conversation (blockquotes) folds behind "Show quoted text". */
function EmailHtml({ html }: { html: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [hasQuote, setHasQuote] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  useLayoutEffect(() => {
    const fit = () => {
      const o = outer.current,
        i = inner.current;
      if (!o || !i) return;
      i.style.zoom = "1";
      // Text wraps to the column; only a fixed-width layout (a 600–700px table)
      // overflows it — that one is scaled down to fit.
      const natural = i.scrollWidth,
        room = i.clientWidth;
      setZoom(
        natural > room + 2 && room > 0 ? Math.max(0.45, room / natural) : 1,
      );
    };
    fit();
    setHasQuote(!!inner.current?.querySelector("blockquote"));
    const ro = new ResizeObserver(fit);
    if (outer.current) ro.observe(outer.current);
    const imgs = Array.from(inner.current?.querySelectorAll("img") ?? []);
    const failed=(event:Event)=>{
      const im=event.target as HTMLImageElement;
      if(!im.getAttribute('src')){im.remove();return;}
      const placeholder=document.createElement('span');placeholder.className='inline-block rounded border border-rule px-2 py-1 text-meta text-ink-3';placeholder.textContent=im.alt?`Image unavailable · ${im.alt}`:'Image unavailable';im.replaceWith(placeholder);fit();
    };
    imgs.forEach(im=>{im.addEventListener('load',fit);im.addEventListener('error',failed);if(im.complete&&im.naturalWidth===0)failed({target:im} as unknown as Event);});
    return () => {
      ro.disconnect();
      imgs.forEach(im=>{im.removeEventListener('load',fit);im.removeEventListener('error',failed);});
    };
  }, [html]);
  return (
    <div ref={outer} className="min-w-0 overflow-x-auto">
      <div
        ref={inner}
        style={{ zoom }}
        className={`email-html text-body leading-relaxed text-ink [&_a]:text-accent [&_a]:underline [&_img]:my-1 [&_img]:rounded ${showQuote ? "" : "[&_blockquote]:hidden"}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
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
  const shown=(showQuote?[text,quote]:[text]).filter(Boolean);
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

function useInboxDraft(
  mailbox: string,
  threadId: string,
  toEmail: string,
  initialBody = "",
) {
  const key = draftKey(mailbox, threadId);
  const [value, setValue] = useState<SavedInboxDraft>({
    body: initialBody,
    toEmail,
    model: "",
    ai: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try {
      const d = readDraft(localStorage, key);
      if (d) setValue(d);
    } catch {
      setStorageError(true);
    }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (!loaded) return;
    try {
      if (!writeDraft(localStorage, key, value.body ? value : null))
        setStorageError(true);
    } catch {
      setStorageError(true);
    }
  }, [key, value, loaded]);
  const latest=useRef(value);latest.current=value;
  const revision=useRef(0);
  function set(next:SavedInboxDraft){revision.current++;latest.current=next;setValue(next);}
  function clear() {
    revision.current++;
    latest.current={body:'',toEmail,model:'',ai:false};
    try {
      writeDraft(localStorage, key, null);
    } catch {}
    setValue({ body: "", toEmail, model: "", ai: false });
  }
  return { value, set, clear, latest, revision, loaded, storageError };
}
/** The same conflict/restore flow protects drafts on every channel. */
function useSafeDraft(saved:ReturnType<typeof useInboxDraft>, threadId:string, onError:(message:string)=>void) {
  const [suggestion,setSuggestion]=useState<SavedInboxDraft|null>(null);
  const [previous,setPrevious]=useState<SavedInboxDraft|null>(null);
  const [pending,start]=useTransition();
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  function generate(intent='') {
    const snapshot={...saved.latest.current};
    const revision=saved.revision.current;
    onError('');
    start(async()=>{
      const r=await runAction(()=>draftReplyAction(threadId,'hermes',intent),{fallback:'Could not draft a reply.'});
      if(!alive.current)return;
      if(!r.ok){onError(r.error??'Could not draft a reply.');return;}
      const candidate:SavedInboxDraft={...snapshot,body:r.body??'',toEmail:snapshot.toEmail||r.toEmail||'',humanEdited:false,ai:true,model:r.model??'Hermes',basedOn:r.basedOn};
      const result=draftGenerationResult(snapshot,saved.latest.current,candidate,saved.revision.current!==revision);
      setPrevious(result.previous);setSuggestion(result.suggestion);
      if(!result.suggestion)saved.set(result.value);
    });
  }
  return {pending,generate,controls:<>
    {suggestion&&<div className="rounded border border-ai/30 bg-ai-soft p-2 text-meta">
      <p>Your reply is safe. Review the suggestion before replacing it.</p><details><summary className="cursor-pointer py-1">Compare</summary><p className="mb-2 whitespace-pre-line border-b border-rule pb-2">Your reply: {saved.value.body}</p><p className="whitespace-pre-line">{suggestion.body}</p></details>
      <div className="flex gap-2"><Button size="sm" onClick={()=>{setPrevious({...saved.latest.current});saved.set({...saved.latest.current,body:suggestion.body,ai:suggestion.ai,model:suggestion.model,basedOn:suggestion.basedOn,humanEdited:false});setSuggestion(null);}}>Use suggestion</Button><Button size="sm" variant="ghost" onClick={()=>setSuggestion(null)}>Keep mine</Button></div>
    </div>}
    {previous&&<Button variant="ghost" size="sm" onClick={()=>{saved.set(previous);setPrevious(null);setSuggestion(null);}}>Restore previous</Button>}
  </>};
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
  mailbox = "",
}: {
  reader: ThreadReader;
  todos?: InboxTodo[];
  threadId: string;
  visible?: boolean;
  onSendDone?:()=>Promise<{ok:boolean;error?:string}>;
  mailbox?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const saved = useInboxDraft(mailbox, threadId, "");
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
      const r = await completeAfterSend(()=>runAction(
        () => sendChannelReplyAction({ threadId, body }),
        { fallback: "Could not send your reply." },
      ),andDone?onSendDone:undefined);
      if (r.sent) {
        if(r.error){setError(r.error);setRetryDone(()=>r.retry??null);}
        saved.clear();
        setSent(true);
        router.refresh();
      } else setError(r.error ?? "Could not send your reply.");
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
                          New website inquiry
                          {reader.form.town ? ` · ${reader.form.town}` : ""}
                        </p>
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
                    ) : m.body.some((p) => p.trim()) ? (
                      <PlainBody paras={m.body} />
                    ) : (
                      <p className="text-body text-ink-3">
                        No text in this message. It may contain media that isn’t
                        available here.
                      </p>
                    )}
                  </div>
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
        className="flex-none border-t border-rule bg-paper-2 px-4 py-2 max-sm:max-h-[var(--inbox-composer-max)] max-sm:mb-[var(--inbox-keyboard-inset)] max-sm:overflow-y-auto"
        onFocusCapture={() =>
          window.dispatchEvent(
            new CustomEvent("sjc:inbox-surface", { detail: true }),
          )
        }
      >
        {canReply && <>
          <p title={reader.replyLabel} className="truncate text-meta font-semibold text-ink-2">{reader.replyLabel}</p>
          {reader.form&&<p className="truncate text-meta text-ink-3">Subject: {reader.form.outgoingSubject}</p>}
          {safety.controls}
          {expanded ? <>
            {saved.value.ai&&<p className="text-meta text-ai">Draft by {saved.value.model} · {saved.value.basedOn}</p>}
            <textarea ref={replyRef} aria-label={reader.channel==='sms'?'Text reply':'Reply'} value={body} disabled={pending} onChange={e=>{setBody(e.target.value);setSent(false);}} rows={2} placeholder="Write a reply…" className="max-h-[18dvh] min-h-16 w-full resize-y rounded-lg border border-rule bg-card p-2 text-body text-ink" />
            <div className="grid grid-cols-2 gap-1">
              <div className="order-last col-span-2 flex flex-wrap items-center gap-1">
              <Button variant="ai" size="sm" onClick={()=>generate()} disabled={safety.pending||pending}>Draft with AI</Button>
              <Button variant="ghost" size="sm" onClick={()=>{saved.clear();setReplying(false);}} disabled={pending}>Discard</Button>
              </div>
              <Button aria-label={channelCommitLabel(reader.channel)} className="min-w-0" onClick={()=>send()} disabled={!body.trim()||pending||safety.pending} icon={Send}>{pending?'Sending…':<><span className="@4xl/page:hidden">Send</span><span className="hidden @4xl/page:inline">{channelCommitLabel(reader.channel)}</span></>}</Button>
              {onSendDone&&<Button variant="secondary" disabled={!body.trim()||pending||safety.pending} onClick={()=>send(true)}>Send &amp; Done</Button>}
            </div>
            <details><summary className="cursor-pointer py-1 text-meta text-ink-3">Reply intent</summary><div className="flex flex-wrap gap-1">{['Yes, works','Need more info','Schedule a visit','Thanks'].map(intent=><Button key={intent} variant="ghost" size="sm" disabled={pending||safety.pending} onClick={()=>generate(intent)}>{intent}</Button>)}</div></details>
          </> : <div className="flex min-h-13 items-center gap-2 rounded-lg border border-rule bg-card px-3">
            <button onClick={()=>{setReplying(true);requestAnimationFrame(()=>replyRef.current?.focus());}} className="min-h-11 min-w-0 flex-1 truncate text-left text-body text-ink-3">Write a reply…</button>
            <Button variant="ai" size="sm" onClick={()=>generate()} disabled={safety.pending||pending}>Draft with AI</Button>
          </div>}
          {reader.channel==='sms'&&<p className="text-meta text-ink-3">{smsSegments(body)} segment{smsSegments(body)===1?'':'s'}</p>}
          {safety.pending&&<p role="status" className="text-meta text-ink-3">Drafting a reply…</p>}
        </>}
        {saved.storageError&&<p className="text-meta text-warn">Draft storage is unavailable in this browser. Keep this conversation open until you send.</p>}
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
    </>
  );
}

function ThreadRow({
  thread,
  selected,
  onSelect,
  onDone,
  onRemind,
  onScreen, compact=false,
}: {
  thread: InboxThread;
  selected: boolean;
  onSelect: () => void;
  onDone?: () => void;
  onRemind?: () => void;
  onScreen?:()=>void;
  compact?:boolean;
  onAdd?:(kind:"lead"|"sub"|"vendor")=>void;
  onOther?:()=>void;
}) {
  const Icon = CHANNEL_ICON[thread.channel];
  const [rowMenu, setRowMenu] = useState(false);
  const attention=thread.automated && (thread.attentionOverride??thread.attentionRequired) && thread.view==="needs_reply";
  const needs = Boolean(thread.needsMeReason) || thread.view === "needs_reply";
  return (
    <div
      className={`group relative border-b border-rule-soft ${selected ? "bg-selected" : "hover:bg-hover"}`}
    >
      {(selected||attention) && <span className={`absolute inset-y-0 left-0 w-[3px] ${attention?"bg-warn":"bg-accent"}`} />}
      <button
        data-thread-row={thread.id}
        onClick={onSelect}
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
          <span className="flex items-center gap-1.5">
            <span
              className={`min-w-0 flex-1 truncate text-label ${thread.unread ? "font-bold text-ink" : needs ? "font-semibold text-ink" : "text-ink-2"}`}
            >
              {thread.fromName}
            </span>
            {thread.unread && (
              <span
                aria-label="Unread"
                className="size-1.5 shrink-0 rounded-full bg-accent"
              />
            )}
            <span className="w-16 shrink-0 text-right text-meta text-ink-3 group-hover:invisible group-focus-within:invisible [@media(hover:none)]:!visible">{thread.when}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={`min-w-0 truncate text-meta ${attention?"rounded bg-warn-soft px-1 text-warn":needs?"text-accent-2":"text-ink-3"}`}
            >
              {attention ? "Action required" : thread.needsMeReason ??
                (thread.automated
                  ? `${thread.automationKind ?? "Notification"}${thread.inInbox===false?" · done":""}`
                  : thread.view === "done" && thread.inInbox === false
                    ? "Done"
                    : thread.view === "awaiting_them"
                      ? "Waiting for their reply"
                      : thread.unread
                        ? "Unread"
                        : thread.subject)}
            </span>
            {thread.projectLabel && (
              <span
                title={thread.projectLabel}
                className="min-w-0 truncate text-meta text-ink-3"
              >
                · {shortJobLabel(thread.projectLabel)}
              </span>
            )}
            <span title="Outstanding" className="ml-auto shrink-0 text-meta text-warn group-hover:invisible group-focus-within:invisible [@media(hover:none)]:!visible">
              {Boolean(thread.outstandingCents)&&new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(thread.outstandingCents!/100)}
            </span>
          </span>
          {threadTodoCue(thread)&&<span title={threadTodoCue(thread)} aria-label="Open to-do" className="block truncate text-meta text-accent-2">{threadTodoCue(thread)}</span>}
          {thread.newSender&&!compact&&<span title={thread.fromEmail} className="block truncate text-meta text-ink-3">{thread.fromEmail}</span>}
          <span className={`${compact?"hidden":"block"} truncate text-meta text-ink-3`}>
            {thread.preview || thread.subject}
          </span>

        </span>
      </button>
      {onScreen&&<div className="px-3 pb-1"><Button variant="secondary" size="sm" onClick={onSelect}>Screen…</Button></div>}
      <div className="absolute top-1 right-2 hidden items-center rounded-md border border-rule bg-card shadow-card group-hover:flex group-focus-within:flex [@media(hover:none)]:hidden">
        <Button
          variant="ghost"
          size="sm"
          icon={Check}
          iconOnly
          aria-label={`Done: ${thread.fromName}`}
          title="Done (e)"
          onClick={onDone}
          className="min-h-11 min-w-11 @4xl/page:min-h-7 @4xl/page:min-w-7"
        />
        <Button
          variant="ghost"
          size="sm"
          icon={Clock}
          iconOnly
          aria-label={`Remind me: ${thread.fromName}`}
          title="Remind me (h)"
          onClick={onRemind}
          className="min-h-11 min-w-11 @4xl/page:min-h-7 @4xl/page:min-w-7"
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
  blockImages=false, mailbox="",
}: {
  blockImages?:boolean; mailbox?:string;
  message: ThreadReader["messages"][number];
  threadId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [html, setHtml] = useState("");
  const imageKey=`sjc:inbox:images:v1:${mailbox.toLowerCase()}:${message.fromEmail?.toLowerCase()??''}`;
  const [allowedImages,setAllowedImages]=useState(false);
  useEffect(()=>{try{setAllowedImages(localStorage.getItem(imageKey)==='show');}catch{}},[imageKey]);
  const loaded = useRef(false);
  useEffect(() => {
    if (!expanded || loaded.current || !message.id) return;
    let alive = true;
    getThreadHtmlAction(threadId, message.id)
      .then((r) => {
        if (alive) {
          setHtml(r.html);
          loaded.current = true;
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [expanded, threadId, message.id]);
  return (
    <article className="overflow-hidden rounded-lg border border-rule bg-card">
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
            <summary className="min-h-11 cursor-pointer py-2 text-meta">
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
              {blockImages&&!allowedImages&&/<img\b|url\s*\(/i.test(html)&&<div className="mb-2 flex flex-wrap items-center gap-2 text-meta text-ink-3"><span>Remote images blocked for this sender.</span><Button variant="secondary" size="sm" onClick={()=>{setAllowedImages(true);try{localStorage.setItem(imageKey,'show');}catch{}}}>Show images</Button></div>}
              <EmailHtml key={`${imageKey}:${allowedImages}`} html={remoteImagePolicy(html,!blockImages||allowedImages)} />
            </>
          ) : (
            <PlainBody paras={message.body} />
          )}
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
// The AI draft is generated on demand (local-LLM, too slow to prebuild for every
// thread); the mock path may arrive with aiDraft.body already filled.
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
  blockImages=false,
}: {
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
  const saved = useInboxDraft(
    mailbox,
    threadId,
    reader.replyTarget?.toEmail ?? "",
    reader.aiDraft.body,
  );
  const {
    body: draft,
    toEmail,
    ai: isAI,
    model,
    replyAll = false,
  } = saved.value;
  const update = (patch: Partial<SavedInboxDraft>) =>
    saved.set({ ...saved.value, ...patch });
  const [replying, setReplying] = useState(false);
  // Filed as automated, but Joe may still answer it (the server only refuses no-reply addresses).
  const [replyAnyway, setReplyAnyway] = useState(false);
  const automated = Boolean(reader.automated) && !replyAnyway;
  const [draftOpen, setDraftOpen] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [retryDone,setRetryDone]=useState<null|(()=>Promise<{ok:boolean;error?:string}>)>(null);
  const safety=useSafeDraft(saved,threadId,setError);
  const drafting=safety.pending;
  const composerStyle=useComposerViewport();
  const [sending, startSend] = useTransition();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const latestPassage=useRef<HTMLDivElement>(null);
  const approvalRef = useRef<HTMLTextAreaElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const hasDraft = Boolean(draft.trim());
  useEffect(() => {
    onDraftReady?.(threadId, hasDraft && isAI && !sent);
  }, [threadId, hasDraft, isAI, sent, onDraftReady]);
  useEffect(() => {
    const root = regionRef.current?.closest("[data-inbox-root]");
    const reply = () => {
      if (automated || !reader.replyTarget) return;
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
  }, [isAI, automated, reader.replyTarget]);
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
    safety.generate(intent);
  }

  function discard() {
    saved.clear();
    setReplying(false);
    setDraftOpen(false);
    setSent(false);
    setError("");
    onDraftReady?.(threadId, false);
  }
  function send(andDone=false) {
    setError("");
    startSend(async () => {
      const r = await completeAfterSend(()=>runAction(
        () =>
          sendReplyAction({
            threadId,
            toEmail,
            replyAll,
            subject: reader.subject,
            body: draft,
          }),
        { fallback: "Send failed." },
      ),andDone?onSendDone:undefined);
      if (r.sent) {
        if(r.error){setError(r.error);setRetryDone(()=>r.retry??null);}
        saved.clear();
        setSent(true);
        setDraftOpen(false);
        setReplying(false);
        onDraftReady?.(threadId, false);
        router.refresh();
      } else setError(r.error ?? "Send failed.");
    });
  }
  const approval = (
    <div
      className="rounded-lg border border-ai/35 bg-card p-2"
    >
      <div className="mb-2 flex items-start gap-2">
        <Chip kind="ai">Draft by {model || "AI"}</Chip>
        <span className="flex-1" />

      </div>
      <p className="mb-2 break-words text-meta text-ink-3">
        To {reader.replyTarget?.toName} &lt;{toEmail}&gt; · via Email · not sent
      </p>
      <p className="text-meta text-ink-3">{saved.value.basedOn}</p>
      <textarea
        onFocus={() =>
          window.dispatchEvent(
            new CustomEvent("sjc:inbox-surface", { detail: true }),
          )
        }
        ref={approvalRef}
        aria-label="AI draft body"
        value={draft}
        disabled={sending}
        onChange={(e) => update({ body: e.target.value, humanEdited:true })}
        rows={3}
        className="max-h-[18dvh] min-h-16 w-full resize-y bg-transparent text-body leading-relaxed text-ink outline-none focus-visible:ring-1 focus-visible:ring-focus"
      />
      <div className="mt-2 grid grid-cols-2 gap-1">
        <Button
          data-draft-send
          onClick={()=>send()}
          disabled={!hasDraft || !toEmail.trim() || sending || drafting}
          icon={Send}
          className="min-h-11 @4xl/page:min-h-8"
        >
          {sending ? "Sending…" : "Send email"}
        </Button>
        {onSendDone&&<Button variant="secondary" disabled={!hasDraft||!toEmail.trim()||sending||drafting} onClick={()=>send(true)}>Send &amp; Done</Button>}
        <div className="col-span-2 flex flex-wrap gap-1">
        <Button
          variant="ghost"
          onClick={() => generate()}
          disabled={drafting || sending}
          className="min-h-11 @4xl/page:min-h-8"
        >
          Regenerate
        </Button>
        <Button
          variant="ghost"
          onClick={discard}
          disabled={sending}
          className="min-h-11 @4xl/page:min-h-8"
        >
          Discard
        </Button>
        </div>
      </div>
      <p className="mt-2 text-meta text-ink-3">
        Your Send click approves this draft.
      </p>
    </div>
  );
  return (
    <>
      <div ref={regionRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-[720px] flex-col gap-2">
          <ThreadSummary reader={reader} />
          {latestInboundIndex(reader.messages) > 0 && (
            <details>
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
                      blockImages={m.imagesBlocked??(blockImages&&!m.outbound)} mailbox={mailbox}
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
                  blockImages={m.imagesBlocked??(blockImages&&!m.outbound)} mailbox={mailbox}
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
        data-reply-active={composerExpanded(replying,draft)||draftOpen}
        style={composerStyle}
        className="flex-none border-t border-rule bg-paper-2 px-4 py-2 max-sm:max-h-[var(--inbox-composer-max)] max-sm:mb-[var(--inbox-keyboard-inset)] max-sm:overflow-y-auto"
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
        {automated ? (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-meta text-ink-3">
              {needsAttention?"Automated message · Needs your attention":"Automated message"}
            </p>
            {reader.replyTarget && !isNoReplyAddress(reader.replyTarget.toEmail) && (
              <Button variant="ghost" onClick={() => { setReplyAnyway(true); setReplying(true); }}>Reply anyway</Button>
            )}
            {needsAttention&&<Button variant="secondary" onClick={onMakeTodo}>Make to-do</Button>}
            <Button onClick={onDone}>Done</Button>
          </div>
        ) : !reader.replyTarget ? (
          <p className="text-meta text-ink-3">
            No incoming message to reply to.
          </p>
        ) : (
          <>
            {(composerExpanded(replying, draft) || draftOpen) && (
              <details className="mb-2 text-meta text-ink-2">
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
                      className="min-h-11 min-w-0 max-w-full bg-transparent text-base text-ink outline-none @4xl/page:text-meta"
                    />
                    &gt;
                  </label>
                  <label className="inline-flex min-h-11 items-center gap-1">
                    <input
                      type="checkbox"
                      checked={replyAll}
                      onChange={(e) => update({ replyAll: e.target.checked })}
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
            {safety.controls}
            {isAI && hasDraft ? approval : composerExpanded(replying, draft) ? (
              <div className="rounded-lg border border-rule bg-card p-2">
                <textarea
                  ref={composerRef}
                  aria-label="Reply body"
                  value={draft}
                  disabled={sending}
                  onChange={(e) => {
                    setSent(false);
                    update({ body: e.target.value, humanEdited:true });
                  }}
                  rows={3}
                  placeholder={reader.replyPlaceholder}
                  className="max-h-[30dvh] min-h-16 w-full resize-y bg-transparent text-body text-ink outline-none"
                />
                <div className="grid grid-cols-2 gap-1">
                  <div className="order-last col-span-2 flex flex-wrap items-center gap-1">
                  <Button variant="ai" size="sm" onClick={()=>generate()} disabled={drafting||sending}>Draft with AI</Button>
                  <VoiceButton
                    compact
                    onText={(t) => update({ body: mergeTranscript(draft, t), humanEdited:true })}
                  />
                  <Button variant="ghost" onClick={discard}>
                    Discard
                  </Button>
                  </div>
                  <Button
                    className="min-w-0"
                    onClick={()=>send()}
                    disabled={
                      !hasDraft || !toEmail.trim() || sending || drafting
                    }
                    icon={Send}
                  >
                    {sending ? "Sending…" : "Send email"}
                  </Button>
                  {onSendDone&&<Button variant="secondary" disabled={!hasDraft||!toEmail.trim()||sending||drafting} onClick={()=>send(true)}>Send &amp; Done</Button>}
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
        {saved.storageError && (
          <p className="mt-1 text-meta text-warn">
            Draft storage is unavailable in this browser. Keep this conversation
            open until you send.
          </p>
        )}
      </div>
    </>
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
