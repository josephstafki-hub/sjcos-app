"use client";

// Browser glue for one hand-ticked checklist: loads the snapshot, queues this
// device's edits, sends them one at a time, keeps unsent edits in IndexedDB
// while the connection is down, and surfaces conflicts and storage trouble.
// All decisions live in lib/checklist-coverage/client-queue.ts (unit-tested);
// this file only wires them to React, the network and browser events.

import { useCallback, useEffect, useRef, useState } from "react";
import { validateChecklistIdentity, loadChecklist, saveChecklistNotes, setChecklistItem } from "@/lib/actions/discovery-checklist";
import type { ChecklistSnapshot, CommandResult } from "@/lib/checklist-coverage/manual";
import type { CoverageState } from "@/lib/checklist-coverage/contract";
import {
  ackHead, classifyError, enqueueNotes, enqueueSetItem, keepMine, markHeadSent, normalizeSnapshot, onConflict, takeSaved,
  type QueuedOp, type SyncState,
} from "@/lib/checklist-coverage/client-queue";
import { openPendingStore, type PendingStore } from "@/lib/checklist-coverage/offline-store";
import { subscribePanelBus } from "@/components/panel/panelBus";
import { useBrowserOnline } from "./useClock";

import { errorCopy } from "@/lib/checklist-coverage/action-result";
import { clearAllPending } from "@/lib/checklist-coverage/offline-store";
import { SIGNED_IN_KEY, markSignedIn, signedInUser } from "./signed-in";
export { SIGNED_IN_KEY, markSignedIn, signedInUser };

export type SyncProblem =
  | { kind: "error"; message: string }
  | { kind: "user_switch" };

export interface ChecklistSync {
  snapshot: ChecklistSnapshot | null;
  queue: QueuedOp[];
  loadError: boolean;
  online: boolean;
  /** The browser refused storage: edits live only in this page. */
  storageDenied: boolean;
  /** Edits found from an earlier visit, waiting for Send now / Discard. */
  recovered: QueuedOp[] | null;
  conflict: SyncState["conflict"];
  problem: SyncProblem | null;
  sending: boolean;
  editsBlocked: boolean;
  setItem(input: { item_id: string; state: CoverageState; value: unknown; reason: string | null }): void;
  setNotes(notes: string): void;
  sendRecovered(): void;
  discardRecovered(): void;
  keepMine(): void;
  keepSaved(): void;
  /** Drop the edit the server refused and carry on with the rest. */
  discardFailed(): void;
  retry(): void;
  reload(): Promise<ChecklistSnapshot | null>;
  /** Run an online-only command (link, finish) once nothing is waiting to send. */
  whenIdle(): boolean;
}

function newId(): string {
  return crypto.randomUUID();
}


export function useChecklistSync(sessionId: string, userId: string): ChecklistSync {
  const [state, setState] = useState<SyncState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const browserOnline = useBrowserOnline();
  // The browser can claim online while requests fail (weak signal, captive Wi-Fi).
  const [netDown, setNetDown] = useState(false);
  const online = browserOnline && !netDown;
  const [storageDenied, setStorageDenied] = useState(false);
  const [editsBlocked, setEditsBlocked] = useState(true);
  const [recovered, setRecovered] = useState<QueuedOp[] | null>(null);
  const [problem, setProblem] = useState<SyncProblem | null>(null);
  const [sending, setSending] = useState(false);

  const stateRef = useRef<SyncState | null>(null);
  const storeRef = useRef<Promise<PendingStore<QueuedOp>> | null>(null);
  const createdAtRef = useRef<number | null>(null);
  const inFlight = useRef(false);
  const recoveryPending = useRef(true);
  const invalidated = useRef(false);
  const invalidate = useCallback(() => {
    invalidated.current = true; halted.current = true;
    stateRef.current = null; setState(null); setRecovered(null); setSending(false);
    setProblem({kind:"user_switch"});
    void clearAllPending(typeof indexedDB === "undefined" ? undefined : indexedDB);
  }, []);
  const halted = useRef(false); // conflict, user switch or a refused edit: stop sending
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // flush() re-schedules itself; it reaches the latest copy through this ref.
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const kick = useCallback(() => { void flushRef.current(); }, []);

  const commit = useCallback((next: SyncState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // ── persistence ────────────────────────────────────────────────────────
  const persist = useCallback(async (queue: QueuedOp[]) => {
    if (!storeRef.current || invalidated.current || recoveryPending.current) return;
    try {
      const store = await storeRef.current;
      if(invalidated.current || recoveryPending.current) return;
      if (queue.length === 0) { createdAtRef.current = null; await store.remove(sessionId); return; }
      createdAtRef.current ??= Date.now();
      await store.save(sessionId, { user_id: userId, created_at: createdAtRef.current, operations: queue });
      setStorageDenied(false);
    } catch {
      setStorageDenied(true);
    }
  }, [sessionId, userId]);

  const reload = useCallback(async () => {
    try {
      const identity = await validateChecklistIdentity(userId);
      if(!identity.ok) { invalidate(); return null; }
      if(invalidated.current) return null;
      const fresh = normalizeSnapshot(await loadChecklist(sessionId));
      if(invalidated.current) return null;
      setLoadError(false);
      const cur = stateRef.current;
      // Never replace what this device still has to send.
      if (!cur || (cur.queue.length === 0 && !inFlight.current)) commit({ snapshot: fresh, queue: [], conflict: null });
      else commit({ ...cur, snapshot: fresh });
      return fresh;
    } catch {
      if (!stateRef.current) setLoadError(true);
      return null;
    }
  }, [sessionId, userId, invalidate, commit]);

  // ── sending ────────────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (inFlight.current || halted.current || invalidated.current || recoveryPending.current) return;
    const cur = stateRef.current;
    if (!cur || cur.conflict || cur.queue.length === 0) { setSending(false); return; }
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setSending(false); return; }
    const who = signedInUser();
    if (who !== null && who !== userId) {
      invalidate(); return;
    }
    inFlight.current = true;
    setSending(true);
    const sentState = markHeadSent(cur);
    commit(sentState);
    const head = sentState.queue[0];
    try {
      const result: CommandResult = head.kind === "set_item" ? await setChecklistItem(head.op, userId) : await saveChecklistNotes(head.op, userId);
      inFlight.current = false;
      setNetDown(false);
      if(invalidated.current) return;
      const now = stateRef.current!;
      if (result.ok) {
        const next = ackHead(now, result);
        commit(next);
        void persist(next.queue);
        if (next.queue.length === 0) { setSending(false); void reload(); return; }
        kick();
        return;
      }
      if(result.code !== 'CHECKLIST_CONFLICT') {
        if(result.code==='CHECKLIST_USER_CHANGED' || result.code==='CHECKLIST_FORBIDDEN') { invalidate(); return; }
        halted.current=true; setSending(false); setProblem({kind:"error",message:errorCopy(result.code)}); return;
      }
      const r = onConflict(now, result.current, newId());
      commit(r.state);
      void persist(r.state.queue);
      if (r.ask) { setSending(false); return; }
      kick();
    } catch (error) {
      inFlight.current = false;
      const failure = classifyError(error, navigator.onLine !== false);
      if (failure.kind === "network") {
        setNetDown(true);
        void persist(stateRef.current!.queue);
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(kick, 5000);
        return;
      }
      setSending(false);
      if (failure.kind === "code" && failure.code === "CHECKLIST_OPERATION_REUSED") {
        // Same id, different payload: never retry it as-is. Ask, against the saved version.
        const fresh = await reload();
        if (fresh && stateRef.current) {
          const r = onConflict(stateRef.current, fresh, newId());
          commit(r.state); void persist(r.state.queue);
          if (!r.ask) kick();
        }
        return;
      }
      if (failure.kind === "code" && /CHECKLIST_INVALID_(ID|ITEM|REVISION|TARGET)|CHECKLIST_NOT_FOUND|CHECKLIST_UNAVAILABLE/.test(failure.code)) {
        await reload();
      }
      halted.current = true;
      setProblem({ kind: "error", message: failure.kind === "code" && failure.code === "CHECKLIST_INVALID_ANSWER" ? "That answer wasn't accepted. Open the row, check it, and save again — or discard the change." : "Couldn't save the last change. It's kept on this page." });
    }
  }, [commit, persist, reload, userId, kick, invalidate]);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  // ── load + recovery on open ────────────────────────────────────────────
  useEffect(() => {
    // One hook instance per session (the pane is keyed by session id).
    let cancelled = false;
    const store = openPendingStore<QueuedOp>(typeof indexedDB === "undefined" ? undefined : indexedDB, userId);
    storeRef.current = store;
    store.then(async (s) => {
      const entry = await s.load(sessionId);
      if (cancelled || invalidated.current) return;
      // Edits from an earlier page that never reached the server: offer them,
      // never replay them on their own (plan §4.3).
      if (entry?.operations.length) { createdAtRef.current = entry.created_at; setRecovered(entry.operations); }
      else { recoveryPending.current = false; setEditsBlocked(false); }
    }).catch(() => { if (!cancelled) { recoveryPending.current = false; setEditsBlocked(false); setStorageDenied(true); } });
    void Promise.resolve().then(reload);
    return () => { cancelled = true; store.then((s) => s.close()).catch(() => undefined); };
  }, [sessionId, userId, reload]);

  // ── browser events ─────────────────────────────────────────────────────
  useEffect(() => {
    const up = () => { setNetDown(false); kick(); };
    const onStorage = (e: StorageEvent) => {
      if (e.key === SIGNED_IN_KEY && e.newValue !== userId) invalidate();
    };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("sjcos-checklist-auth");
    if(channel) channel.onmessage = e => { if(e.data !== userId) invalidate(); };
    const check = () => { void validateChecklistIdentity(userId).then(r=>{if(!r.ok) invalidate();}).catch(()=>undefined); };
    const timer = setInterval(check,15000);
    window.addEventListener("focus",check);
    window.addEventListener("sjcos-checklist-logout",invalidate);
    window.addEventListener("online", up);
    window.addEventListener("storage", onStorage);
    return () => { clearInterval(timer); channel?.close(); window.removeEventListener("focus",check); window.removeEventListener("sjcos-checklist-logout",invalidate); window.removeEventListener("online", up); window.removeEventListener("storage", onStorage); };
  }, [kick, userId, invalidate]);

  const unsent = (state?.queue.length ?? 0) + (recovered?.length ?? 0);
  useEffect(() => {
    if (!unsent) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  // Another device or tab changed this checklist: pick it up when idle.
  useEffect(() => subscribePanelBus((msg) => {
    if (msg.type !== "changes" || !msg.scopes.includes("checklist_sessions")) return;
    const cur = stateRef.current;
    if (cur && cur.queue.length === 0 && !inFlight.current) void reload();
  }), [reload]);

  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current); }, []);

  // ── commands ───────────────────────────────────────────────────────────
  const setItem: ChecklistSync["setItem"] = useCallback((input) => {
    const cur = stateRef.current;
    if (!cur || recoveryPending.current || invalidated.current) return;
    const next = enqueueSetItem(cur, input, newId(), Date.now());
    commit(next);
    void persist(next.queue);
    kick();
  }, [commit, persist, kick]);

  const setNotes = useCallback((notes: string) => {
    const cur = stateRef.current;
    if (!cur || recoveryPending.current || invalidated.current) return;
    const next = enqueueNotes(cur, notes, newId(), Date.now());
    if (next === cur) return;
    commit(next);
    void persist(next.queue);
    kick();
  }, [commit, persist, kick]);

  const sendRecovered = useCallback(() => {
    const cur = stateRef.current;
    if (!cur || !recovered) return;
    // Recovered edits go first, exactly as saved: same ids, same revisions.
    const next = { ...cur, queue: [...recovered.map((q) => ({ ...q })), ...cur.queue] };
    recoveryPending.current = false;
    setEditsBlocked(false);
    setRecovered(null);
    commit(next);
    halted.current = false;
    void persist(next.queue);
    kick();
  }, [recovered, commit, persist, kick]);

  const discardRecovered = useCallback(() => {
    recoveryPending.current = false;
    setEditsBlocked(false);
    setRecovered(null);
    void persist(stateRef.current?.queue ?? []);
  }, [persist]);

  const chooseMine = useCallback(() => {
    const cur = stateRef.current;
    if (!cur) return;
    const next = keepMine(cur, newId());
    commit(next); halted.current = false; void persist(next.queue); kick();
  }, [commit, persist, kick]);

  const chooseSaved = useCallback(() => {
    const cur = stateRef.current;
    if (!cur) return;
    const next = takeSaved(cur);
    commit(next); halted.current = false; void persist(next.queue);
    if (next.queue.length) kick(); else void reload();
  }, [commit, persist, kick, reload]);

  const discardFailed = useCallback(() => {
    const cur = stateRef.current;
    if (!cur) return;
    const next = takeSaved({ ...cur, conflict: null });
    commit(next); halted.current = false; setProblem(null); void persist(next.queue);
    if (next.queue.length) kick(); else void reload();
  }, [commit, persist, kick, reload]);

  const retry = useCallback(() => {
    if (problem?.kind === "user_switch") return;
    halted.current = false; setProblem(null);
    if (!stateRef.current) { void reload(); return; }
    kick();
  }, [problem, kick, reload]);

  const whenIdle = useCallback(() => {
    const cur = stateRef.current;
    return !invalidated.current && !recoveryPending.current && !!cur && cur.queue.length === 0 && !inFlight.current && !cur.conflict && !recovered?.length;
  }, [recovered]);

  return {
    snapshot: state?.snapshot ?? null, queue: state?.queue ?? [], loadError, online, storageDenied, recovered,
    conflict: state?.conflict ?? null, problem, sending, editsBlocked,
    setItem, setNotes, sendRecovered, discardRecovered, keepMine: chooseMine, keepSaved: chooseSaved, discardFailed, retry, reload, whenIdle,
  };
}
