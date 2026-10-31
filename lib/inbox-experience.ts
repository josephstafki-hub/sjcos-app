import type { InboxThread, ThreadReader } from "./inbox";

export type InboxTab = "needs" | "clients" | "leads" | "subs" | "new" | "other";
export const INBOX_TABS: { value: InboxTab; label: string }[] = [
  { value: "needs", label: "Needs me" },
  { value: "clients", label: "Clients" },
  { value: "leads", label: "Leads" },
  { value: "subs", label: "Subs & vendors" },
  { value: "new", label: "New senders" },
  { value: "other", label: "Other" },
];
export function inboxBucket(t: InboxThread): Exclude<InboxTab, "needs"> {
  if (t.filedOther || t.automated) return "other";
  if (t.newSender) return "new";
  if (
    t.audience === "sub" ||
    t.audience === "money" ||
    t.contactRole === "vendor"
  )
    return "subs";
  if (
    t.contactRole === "lead" ||
    t.linkedType === "lead" ||
    t.channel === "site_form" ||
    t.id.startsWith("portal:lead:")
  )
    return "leads";
  if (
    t.projectSlug ||
    t.linkedType === "project" ||
    t.contactRole === "client" ||
    t.audience === "client"
  )
    return "clients";
  return "other";
}
export function matchesInboxTab(
  t: InboxThread,
  tab: InboxTab,
  draftReady = false,
): boolean {
  return tab === "needs"
    ? !t.filedOther && (!t.automated || Boolean(t.attentionOverride ?? t.attentionRequired)) && (t.automated || inboxBucket(t) !== "new") &&
        (draftReady || t.view === "needs_reply")
    : inboxBucket(t) === tab && !(tab === "other" && t.automated && matchesInboxTab(t, "needs", draftReady));
}
export function tabCounts(
  threads: InboxThread[],
  drafts: ReadonlySet<string> = new Set(),
) {
  const counts = { needs: 0, clients: 0, leads: 0, subs: 0, new: 0, other: 0 };
  for (const t of threads) {
    if(inboxBucket(t)!=="new" && matchesInboxTab(t,inboxBucket(t),drafts.has(t.id))) counts[inboxBucket(t)]++;
    if (matchesInboxTab(t, "needs", drafts.has(t.id))) counts.needs++;
  }
  counts.new=new Set(threads.filter(t=>inboxBucket(t)==="new").map(t=>t.fromEmail?.toLowerCase()??t.id)).size;
  return counts;
}
export const SHORTCUTS = {
  j: "next",
  k: "previous",
  Enter: "open",
  r: "reply",
  a: "approve",
  e: "done",
  h: "remind",
  l: "link",
  "/": "search",
  "?": "help",
} as const;
export function shortcutFor(e: {
  key: string;
  tagName?: string;
  listRow?: boolean;
  editable?: boolean;
  inDialog?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}) {
  if (
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.editable ||
    e.inDialog ||
    (!e.listRow && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(e.tagName ?? ""))
  )
    return null;
  return (
    SHORTCUTS[
      e.key === "Enter"
        ? "Enter"
        : (e.key.toLowerCase() as keyof typeof SHORTCUTS)
    ] ?? null
  );
}
function centralDay(now: Date) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}-${p.find((x) => x.type === "day")!.value}`;
}
/** Calendar arithmetic first, then resolve 08:00 Central; never add 24h over DST. */
export function reminderDueAt(
  preset: "tomorrow" | "monday" | "pick",
  now = new Date(),
  pick?: string,
) {
  const today = centralDay(now);
  const day = new Date(today + "T12:00:00Z");
  if (preset === "tomorrow") day.setUTCDate(day.getUTCDate() + 1);
  else if (preset === "monday")
    day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7 || 7));
  const iso = preset === "pick" ? (pick ?? "") : day.toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
    !Number.isFinite(Date.parse(iso)) ||
    new Date(iso).toISOString().slice(0, 10) !== iso
  )
    throw Error("Choose a valid day.");
  // At 14:00Z it is 8am in standard time, 9am in daylight time.
  const utc = new Date(iso + "T14:00:00Z");
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      hourCycle: "h23",
    }).format(utc),
  );
  utc.setUTCHours(utc.getUTCHours() + (8 - hour));
  if (utc.getTime() <= now.getTime())
    throw Error("Choose a future reminder day.");
  return utc.toISOString();
}
export function messageWorkItem(
  t: InboxThread,
  reader: Pick<ThreadReader, "messages">,
  opts: { title?: string; dueAt?: string; job?: string; assignees?: string[] },
) {
  const m =
    [...reader.messages].reverse().find((m) => !m.outbound) ??
    reader.messages.at(-1);
  if (t.channel === "email" && !m?.id)
    throw Error("Open the message again before making a to-do.");
  const fd = new FormData();
  fd.set(
    "title",
    opts.title?.trim() ||
      t.subject.replace(/^(?:re:\s*)+/i, "").slice(0, 160) ||
      `Follow up with ${t.fromName}`,
  );
  fd.set(
    "body",
    `${t.fromName} · ${t.subject}\n\n${m?.body.join("\n\n") ?? t.preview}`.slice(
      0,
      16000,
    ),
  );
  fd.set(
    "job",
    opts.job ??
      (t.projectSlug
        ? `project:${t.projectSlug}`
        : t.linkedType && t.linkedSlug
          ? `${t.linkedType}:${t.linkedSlug}`
          : ""),
  );
  fd.set("due_at", opts.dueAt ?? "");
  fd.set("source_id", t.id);
  for (const id of opts.assignees ?? []) fd.append("assigned_user_ids", id);
  if (t.channel === "email")
    fd.set(
      "email",
      JSON.stringify({
        message_id: m!.id,
        thread_id: t.id,
        from: m!.fromEmail,
        received_at: m!.date ? new Date(m!.date).toISOString() : undefined,
      }),
    );
  return fd;
}
export interface SavedInboxDraft {
  body: string;
  toEmail: string;
  model: string;
  ai: boolean;
  replyAll?: boolean;
  basedOn?: string;
}
type StorageRead = Pick<Storage, "getItem">;
type StorageWrite = Pick<Storage, "setItem" | "removeItem">;
export function draftKey(mailbox: string, thread: string) {
  return `sjc:inbox:draft:v1:${encodeURIComponent(mailbox.toLowerCase())}:${encodeURIComponent(thread)}`;
}
export function readDraft(
  storage: StorageRead,
  key: string,
): SavedInboxDraft | null {
  try {
    const d = JSON.parse(storage.getItem(key) ?? "null");
    return d &&
      typeof d.body === "string" &&
      typeof d.toEmail === "string" &&
      typeof d.model === "string" &&
      typeof d.ai === "boolean"
      ? d
      : null;
  } catch {
    return null;
  }
}
export function writeDraft(
  storage: StorageWrite,
  key: string,
  value: SavedInboxDraft | null,
): boolean {
  try {
    if (value) storage.setItem(key, JSON.stringify(value));
    else storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
export function relatedConversations(
  threads: InboxThread[],
  p: { threadId: string; email?: string; contactKey?: string },
) {
  return threads.filter(
    (t) =>
      t.id !== p.threadId &&
      ((p.email && t.fromEmail?.toLowerCase() === p.email.toLowerCase()) ||
        (p.contactKey && t.contactKey === p.contactKey)),
  );
}

/** Rank only; stable sorting preserves arrival order within each group. */
export function triageRank(t: InboxThread): number {
  if (t.automated && (t.attentionOverride ?? t.attentionRequired) && !t.filedOther && t.view === "needs_reply") return 1;
  if (inboxBucket(t) === "other") return 4;
  if (inboxBucket(t) === "new") return 3;
  return t.view === "needs_reply" ? 0 : 2;
}
export function senderPreferenceKey(mailbox: string, sender: string) {
  return `sjc:inbox:other:v1:${encodeURIComponent(mailbox.toLowerCase())}:${encodeURIComponent(sender.toLowerCase())}`;
}
export function applySenderPreference(
  t: InboxThread,
  other: boolean,
): InboxThread {
  return {
    ...t,
    filedOther: other,
    needsMeReason: other
      ? "Filed in Other"
      : t.newSender
        ? "New sender"
        : t.needsMeReason,
  };
}

/** Long imported notes belong in context, never in the job identity chip. */
export function shortJobLabel(name: string): string {
  const parts = name
    .split(/\s+·\s+/)
    .slice(0, 2)
    .join(" · ");
  return parts.length > 52 ? parts.slice(0, 49).trimEnd() + "…" : parts;
}

export function formatContactPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    : phone;
}

export function readOtherSenders(
  storage: StorageRead,
  mailbox: string,
  emails: string[],
): Set<string> {
  const senders = new Set<string>();
  for (const email of emails) {
    try {
      if (storage.getItem(senderPreferenceKey(mailbox, email)) === "other")
        senders.add(email.toLowerCase());
    } catch {
      /* Private mode: keep every sender visible. */
    }
  }
  return senders;
}
export function rememberOtherSender(
  storage: StorageWrite,
  mailbox: string,
  email: string,
  other: boolean,
): boolean {
  try {
    const key = senderPreferenceKey(mailbox, email);
    if (other) storage.setItem(key, "other");
    else storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function contextStripText(thread: Pick<InboxThread,'projectLabel'|'fromName'|'contactStage'>, context?: {job?: {name: string; stage: string; money?: {outstanding: number} | null} | null; schedule?: {label: string; day: string} | null; todos?: unknown[]} | null): string {
  const job = context?.job;
  const stage = (job?.stage || thread.contactStage || '').replaceAll('_', ' ');
  const identity = shortJobLabel(job?.name || thread.projectLabel || thread.fromName || 'No linked job');
  const cue = job?.money ? `${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(job.money.outstanding/100)} outstanding`
    : context?.schedule ? `Next: ${context.schedule.label} ${new Date(context.schedule.day+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'})}` : '';
  return ['Context', identity, stage === 'intake' ? 'New inquiry' : /^pre construction$/i.test(stage) ? 'Pre-construction' : stage ? stage[0].toUpperCase()+stage.slice(1) : '', cue, context?.todos?.length ? `${context.todos.length} open to-do${context.todos.length===1?'':'s'}` : ''].filter(Boolean).join(' · ');
}
type CompletionResult = {ok: boolean; error?: string};
/** Completion is separate so retrying it can never repeat a successful send. */
export async function completeAfterSend(send: () => Promise<CompletionResult>, done?: () => Promise<CompletionResult>) {
  let result: CompletionResult;
  try { result = await send(); } catch { result = {ok:false,error:'Send failed.'}; }
  if (!result.ok) return {sent:false, done:false, error:result.error};
  const retry = async () => {
    try { return await done!(); } catch { return {ok:false,error:'Could not mark done.'}; }
  };
  if (!done) return {sent:true,done:false};
  const completion = await retry();
  return {sent:true, done:completion.ok, error:completion.ok ? undefined : "Sent — couldn't mark done", retry};
}

/** Apply confirmed choices to all loaded rows while the server refresh arrives. */
export function applyInboxPreferences(t:InboxThread, preferences:Record<string,string|null>):InboxThread {
  const senderKey=`sender:${t.fromEmail?.toLowerCase()}`;
  const threadKey=`thread:${t.id}`;
  const decision=senderKey in preferences?preferences[senderKey]:t.senderDecision;
  const override=threadKey in preferences?preferences[threadKey]:undefined;
  const attentionOverride=override===undefined?t.attentionOverride:override===null?undefined:override==='attention';
  const attention=Boolean(t.automated&&(attentionOverride??t.attentionRequired));
  const actionable=attention&&t.inInbox&&t.inboundLast&&t.view!=='snoozed';
  return {...t,senderDecision:decision??undefined,filedOther:decision==='other',attentionOverride,
    view:actionable?'needs_reply':t.view,
    needsMeReason:t.automated?(actionable?`Needs attention · ${t.needsMeReason?.split(' · ').slice(1).join(' · ')||'Marked by you'}`:undefined):t.needsMeReason,
    newSender:decision==='pending'?t.view==='needs_reply':decision?false:t.newSender};
}

export function nextNeedsThread(threads:InboxThread[], currentId:string, drafts:ReadonlySet<string>=new Set()):InboxThread|undefined {
  const queue=orderedInboxThreads(threads.filter(t=>matchesInboxTab(t,'needs',drafts.has(t.id))));
  const index=queue.findIndex(t=>t.id===currentId);
  return queue.slice(index+1).find(t=>t.id!==currentId)??queue.find(t=>t.id!==currentId);
}

export function rowDay(thread: Pick<InboxThread,'receivedAt'|'when'>, now=new Date()): 'Today'|'Yesterday'|'Earlier' {
  if(!thread.receivedAt)return /am|pm/.test(thread.when??'')?'Today':thread.when==='Yesterday'?'Yesterday':'Earlier';
  const day=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(date);
  // Resolve yesterday by its Central calendar date, independent of browser zone/DST.
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=(kind:string)=>parts.find(p=>p.type===kind)!.value;
  const yesterday=new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`);yesterday.setUTCDate(yesterday.getUTCDate()-1);
  return day(new Date(thread.receivedAt))===day(now)?'Today':day(new Date(thread.receivedAt))===day(yesterday)?'Yesterday':'Earlier';
}
export function orderedInboxThreads(threads:InboxThread[],now=new Date()):InboxThread[] {
  const days={Today:0,Yesterday:1,Earlier:2};
  return [...threads].sort((a,b)=>days[rowDay(a,now)]-days[rowDay(b,now)]||triageRank(a)-triageRank(b));
}
export function canLoadMore(input:{token?:string;lens:string;channel?:string;remoteReady?:boolean;tab?:InboxTab|null;visibleCount?:number;knownTotal?:number}):boolean {
  if(!input.token)return false;
  if(input.lens==='label'||input.lens==='system')return Boolean(input.remoteReady);
  if(input.lens==='project'||input.lens==='channel'&&input.channel!=='email')return false;
  if(input.knownTotal!==undefined&&input.visibleCount!==undefined&&input.visibleCount>=input.knownTotal)return false;
  return true;
}
export function draftGenerationResult(snapshot:SavedInboxDraft,current:SavedInboxDraft,suggestion:SavedInboxDraft, changed=false) {
  const conflict=changed||JSON.stringify(snapshot)!==JSON.stringify(current);
  return {value:conflict?current:suggestion,previous:snapshot,suggestion:conflict?suggestion:null};
}
export function completionQueue(threads:InboxThread[],currentId:string,drafts:ReadonlySet<string>=new Set()) {
  const remaining=threads.filter(t=>t.id!==currentId);
  return {next:nextNeedsThread(threads,currentId,drafts),left:remaining.filter(t=>matchesInboxTab(t,'needs',drafts.has(t.id))).length};
}
export function attentionTaskTitle(thread:Pick<InboxThread,'subject'|'fromName'>):string {
  return `${thread.fromName}: ${thread.subject.replace(/^(?:re:\s*)+/i,'')}`.slice(0,160);
}
