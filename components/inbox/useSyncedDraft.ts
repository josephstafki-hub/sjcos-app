'use client';
import { useEffect, useRef, useState } from 'react';
import { loadDrafts, saveDraft } from '@/lib/actions/inbox-drafts';
import {registerInboxDraft} from '@/lib/inbox-navigation';
import { createDraftSync, type DraftSyncSnapshot } from '@/lib/inbox-draft-sync';
import type { DraftText } from '@/lib/inbox-draft-types';
import type { ThreadChannel } from '@/lib/types';

/** Supply the authenticated user id as well as the mailbox: local fallback
 * drafts must be separate even when two staff users link the same address.
 * The server always derives both identities independently from the session. */
export function useSyncedDraft(options: {
  mailbox: string;
  userId: string;
  threadKey: string;
  channel: ThreadChannel;
  owner?: boolean;
  initial?: Partial<DraftText>;
  latestMessageId?: string;
}) {
  const { mailbox, userId, threadKey, channel, owner, latestMessageId } = options;
  const initial = useRef(options.initial);
  initial.current = options.initial;
  const controller = useRef<ReturnType<typeof createDraftSync> | null>(null);
  const controllerKey = useRef('');
  const key = JSON.stringify([mailbox.toLowerCase(), userId, threadKey, channel, owner, latestMessageId]);
  const empty: DraftSyncSnapshot = {
    draft: { body: '', toEmail: '', cc: [], subject: '', ...options.initial },
    status: 'local only', suggestion: null, conflict: null, version: 0,
  };
  const [entry, setEntry] = useState({ key, state: empty });
  // Never expose the previous thread's text during the render before the
  // effect has installed the new controller.
  const state = entry.key === key ? entry.state : empty;
  const current = () => controllerKey.current === key ? controller.current : null;
  useEffect(() => {
    let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    try { storage = window.localStorage; }
    catch { storage = { getItem: () => null, setItem: () => {throw Error('Device storage unavailable.');}, removeItem: () => {} }; }
    const sync = createDraftSync({ mailbox, userId, threadKey, channel, initial: initial.current,
      importLegacy: owner === true, latestMessageId, storage, load: () => loadDrafts([threadKey]), save: saveDraft, onChange: next => setEntry({ key, state: next }) });
    controller.current = sync; controllerKey.current = key;
    setEntry({ key, state: sync.getSnapshot() });
    const unregister=registerInboxDraft(()=>sync.flushForNavigation());
    void sync.refresh();
    const refresh = () => { void sync.refresh(); };
    const timer = window.setInterval(refresh, 20_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      unregister();sync.detach();void sync.flushForNavigation().finally(()=>sync.dispose()); controller.current = null; controllerKey.current = '';
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [mailbox, userId, threadKey, channel, owner, latestMessageId, key]);
  return {
    ...state,
    setDraft: (next: DraftText | ((draft: DraftText) => DraftText)) => current()?.setDraft(next),
    acceptSuggestion: () => current()?.acceptSuggestion(),
    keepMine: () => current()?.keepMine(),
    resolve: (choice: 'mine' | 'server') => current()?.resolve(choice),
    refresh: () => current()?.refresh(),
    flush: () => current()?.flush(),
  };
}
