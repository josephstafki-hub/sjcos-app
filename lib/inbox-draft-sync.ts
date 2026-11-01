// Browser-independent sync controller: injected storage, clock and transport.
// Human text is never replaced by an AI suggestion without acceptSuggestion().
import { draftKey, readDraft, writeDraft } from './inbox-experience';
import type { DraftText, DraftWriteResult, InboxDraft, SaveDraftInput } from './inbox-draft-types';
import type { ThreadChannel } from './types';

export type DraftSyncStatus = 'saved' | 'saving' | 'local only' | 'conflict';
export interface DraftSyncSnapshot {
  draft: DraftText;
  localSaved?:boolean;
  status: DraftSyncStatus;
  suggestion: InboxDraft | null;
  conflict: { current: InboxDraft | null } | null;
  version: number;
  /** True once the server has been asked at least once for this thread. */
  checked?: boolean;
}
interface SyncOptions {
  mailbox: string;
  userId: string;
  threadKey: string;
  channel: ThreadChannel;
  initial?: Partial<DraftText>;
  latestMessageId?: string;
  /** Only the owner may adopt the old mailbox-only localStorage key. */
  importLegacy?: boolean;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  load: () => Promise<InboxDraft[]>;
  save: (input: SaveDraftInput) => Promise<DraftWriteResult>;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  onChange?: (state: DraftSyncSnapshot) => void;
}
const blank = (initial?: Partial<DraftText>): DraftText => ({ body: '', toEmail: '', cc: [], subject: '', ...initial });
const textOf = (row: InboxDraft | null, initial?: Partial<DraftText>): DraftText => row?.status === 'ready'
  ? { body: row.body, toEmail: row.toEmail, cc: row.cc, subject: row.subject,
      ...(row.model||row.basedOn||row.acceptedSuggestionId||row.humanEdited||row.sources?.length?{provenance:{...(row.sources?.length?{sources:row.sources}:{}),model:row.model??null,basedOn:row.basedOn??'',acceptedSuggestionId:row.acceptedSuggestionId??null,humanEdited:row.humanEdited??false}}:{}) } : blank(row ? { ...initial, body: '' } : initial);
function canonicalDraft(draft:DraftText):DraftText {
  const p=draft.provenance;
  if(p&&!p.model&&!p.basedOn&&!p.acceptedSuggestionId&&!p.humanEdited&&!p.sources?.length){
    const {provenance,...text}=draft;return text;
  }
  return draft;
}
const same = (a: DraftText, b: DraftText) => a.body === b.body && a.toEmail === b.toEmail && a.subject === b.subject && JSON.stringify(a.cc) === JSON.stringify(b.cc) && JSON.stringify(a.provenance) === JSON.stringify(b.provenance);

export function createDraftSync(options: SyncOptions) {
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const legacyKey = draftKey(options.mailbox, options.threadKey);
  const key = `${legacyKey}:sync:${encodeURIComponent(options.userId)}:${options.channel}`;
  let state: DraftSyncSnapshot = { draft: blank(options.initial), status: 'local only', suggestion: null, conflict: null, version: 0, checked: false };
  let dirty = false;
  let initialized = false;
  let busy = false;
  let loading = false;
  let pendingSave: Promise<void> | null = null;
  let disposed = false;
  let detached = false;
  let timer: unknown;
  let revision = 0;
  try {
    const local = JSON.parse(options.storage.getItem(key) ?? 'null');
    if (local && typeof local.body === 'string' && typeof local.toEmail === 'string' &&
        Number.isSafeInteger(local.version) && local.version >= 0) {
      state = { ...state, localSaved:true, version: local.version, draft: { body: local.body, toEmail: local.toEmail,
        cc: Array.isArray(local.cc) ? local.cc : [], subject: typeof local.subject === 'string' ? local.subject : '', ...(local.provenance?{provenance:local.provenance}:{}) } };
      dirty = local.dirty === true;
    } else if (options.importLegacy) {
      const legacy = readDraft(options.storage, legacyKey);
      if (legacy) { state.draft = { ...state.draft, body: legacy.body, toEmail: legacy.toEmail }; dirty = true; }
    }
  } catch { /* storage unavailable: server sync still works */ }
  state.draft=canonicalDraft(state.draft);
  // Upgrade the prior device-only authorship together with its existing text.
  // Namespace and version still belong to this user; a newer remote version
  // conflicts rather than adopting stale device metadata.
  if(state.draft.body&&!state.draft.provenance){
    try{
      const prior=JSON.parse(options.storage.getItem(JSON.stringify(['sjc:inbox:draft-meta',options.mailbox,options.userId,options.threadKey,options.channel]))??'null');
      const model=prior?.model?.toLowerCase();
      if(prior?.ai&&['claude','hermes','qwen'].includes(model)){
        state.draft={...state.draft,provenance:{model,basedOn:prior.basedOn??'',acceptedSuggestionId:prior.suggestionId??null,humanEdited:prior.humanEdited??false}};
        dirty=true;
      }
    }catch{ /* metadata from unavailable storage cannot be migrated */ }
  }
  if (!dirty && state.version === 0 && state.draft.body) dirty = true;

  function publish() { if (!disposed&&!detached) options.onChange?.(state); }
  function persist() {
    // readDraft/writeDraft remain compatible with the old local fallback. Sync
    // metadata goes in this user/channel key, never another staff user's key.
    const localSaved=writeDraft(options.storage, key, { ...state.draft, model: '', ai: false,
      version: state.version, dirty } as Parameters<typeof writeDraft>[2]);
    state={...state,localSaved};
  }
  function stopTimer() { if (timer !== undefined) { cancel(timer); timer = undefined; } }
  function enqueue() {
    stopTimer();
    if (!disposed && dirty && initialized && !busy && !state.conflict) {
      state = { ...state, status: 'saving' };
      timer = schedule(() => { timer = undefined; void startSave(); }, 800);
    }
  }
  async function flush() {
    if (disposed || busy || !dirty || !initialized || state.conflict) return;
    busy = true;
    const sentRevision = revision;
    const draft = state.draft;
    state = { ...state, status: 'saving' }; publish();
    try {
      const result = await options.save({ ...draft, threadKey: options.threadKey, channel: options.channel, baseVersion: state.version });
      if (disposed) return;
      if (result.conflict) {
        if(result.current?.status==='ready'&&same(textOf(result.current),draft)){
          dirty=revision!==sentRevision;
          state={...state,version:result.current.version,status:dirty?'saving':'saved'};
        }else state = { ...state, status: 'conflict', conflict: { current: result.current } };
      } else {
        dirty = revision !== sentRevision;
        state = { ...state, version: result.current.version, status: dirty ? 'saving' : 'saved' };
      }
    } catch {
      if (!disposed) state = { ...state, status: 'local only' };
    } finally {
      busy = false;
      if (!disposed) {
        persist();
        // Offline failures retry on refresh/online, not a tight timer loop.
        if (state.status !== 'local only') enqueue();
        publish();
      }
    }
  }
  function startSave(): Promise<void> {
    if (pendingSave) return pendingSave;
    pendingSave = flush().finally(() => { pendingSave = null; });
    return pendingSave;
  }
  async function refresh() {
    if (disposed || busy || loading) return;
    loading = true;
    const loadedVersion = state.version;
    try {
      const rows = await options.load();
      if (disposed || busy || state.version !== loadedVersion) return;
      initialized = true;
      const current = rows.find(r => r.source === 'human' && r.channel === options.channel && r.threadKey === options.threadKey) ?? null;
      const suggestion = rows.find(r => r.source === 'ai' && r.status === 'ready' && r.threadKey === options.threadKey &&
        (!options.latestMessageId || r.sourceMessageId === options.latestMessageId)) ?? null;
      state = { ...state, suggestion, checked: true };
      if (!state.conflict) {
        if (dirty && (current?.version ?? 0) !== state.version) {
          // Even identical body text may have been sent/discarded. Tombstones
          // always conflict with offline edits instead of resurrecting them.
          if (current?.status === 'ready' && same(textOf(current), state.draft)) {
            dirty = false; state = { ...state, version: current.version, status: 'saved' };
          } else state = { ...state, status: 'conflict', conflict: { current } };
        } else if (!dirty) {
          state = { ...state, draft: textOf(current, options.initial), version: current?.version ?? 0, status: 'saved' };
        }
      }
      persist(); enqueue(); publish();
    } catch {
      if (!disposed) { state = { ...state, status: state.conflict ? 'conflict' : 'local only' }; publish(); }
    } finally { loading = false; }
  }
  function setDraft(next: DraftText | ((draft: DraftText) => DraftText)) {
    if (disposed) return;
    revision++; dirty = true;
    state = { ...state, draft: canonicalDraft(typeof next === 'function' ? next(state.draft) : next),
      status: state.conflict ? 'conflict' : initialized ? 'saving' : 'local only' };
    persist(); enqueue(); publish();
  }
  function resolve(choice: 'mine' | 'server') {
    if (!state.conflict) return;
    const current = state.conflict.current;
    revision++;
    dirty = choice === 'mine';
    state = { ...state, version: current?.version ?? 0, conflict: null,
      draft: choice === 'server' ? textOf(current, options.initial) : state.draft, status: dirty ? 'saving' : 'saved' };
    persist(); enqueue(); publish();
  }
  return {
    getSnapshot: () => state,
    refresh,
    setDraft,
    acceptSuggestion() {
      const suggestion = state.suggestion;
      if (!suggestion) return;
      setDraft({ body: suggestion.body, toEmail: suggestion.toEmail, cc: suggestion.cc, subject: suggestion.subject, provenance:{...(suggestion.sources?.length?{sources:suggestion.sources}:{}),model:suggestion.model,basedOn:suggestion.basedOn,acceptedSuggestionId:suggestion.id,humanEdited:false} });
    },
    keepMine: () => resolve('mine'),
    resolve,
    /** Flush explicitly before a Send click, then use the returned version
     * for markDraftSent. UI must still handle an in-flight save/conflict. */
    flush: async () => {
      stopTimer(); await startSave();
      if (dirty && !state.conflict && state.status !== 'local only') { stopTimer(); await startSave(); }
      return state;
    },
    async flushForNavigation() {
      if(!dirty&&!state.conflict)return true;
      if(!initialized)await refresh();
      stopTimer();await startSave();
      if(dirty&&!state.conflict&&state.status!=='local only'){stopTimer();await startSave();}
      return !dirty&&!state.conflict;
    },
    detach() { detached=true;stopTimer(); },
    dispose() { disposed = true; stopTimer(); },
  };
}
