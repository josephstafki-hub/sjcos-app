// Browser storage for unsent checklist edits (plan §4.3, handoff "Offline
// queue contract"). IndexedDB database `sjcos-calls`, one object store per
// signed-in user (`pending:<user-id>`), keyed by checklist session id. Each
// entry is `{user_id, created_at, operations}` — human edits only: no
// transcript, audio, auth context or secrets.
//
// The IDBFactory is passed in so node tests can drive the same code with a
// small in-memory factory. Any storage failure (private mode, denied, full)
// rejects; the caller then keeps edits in memory and shows the "Can't save on
// this device" banner.

import { OFFLINE_QUEUE, recoverPending } from './manual.ts';

export interface StoredQueue<T> { user_id: string; created_at: number; operations: T[] }

export interface PendingStore<T> {
  /** This user's unexpired entry for a session; expired or foreign entries read as null. */
  load(sessionId: string, now?: number): Promise<StoredQueue<T> | null>;
  save(sessionId: string, entry: StoredQueue<T>): Promise<void>;
  remove(sessionId: string): Promise<void>;
  close(): void;
}

export function storeName(userId: string): string {
  return `${OFFLINE_QUEUE.storePrefix}${userId}`;
}

function openDb(factory: IDBFactory, version: number | undefined, store: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? factory.open(OFFLINE_QUEUE.database) : factory.open(OFFLINE_QUEUE.database, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab adding its user's store must not be blocked by this one.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IDB_OPEN_FAILED'));
    // Blocked = an older tab still has the database open; every tab closes on
    // versionchange, so wait — but never forever.
    const timer = setTimeout(() => reject(new Error('IDB_BLOCKED')), 4000);
    const done = () => clearTimeout(timer);
    const ok = req.onsuccess, bad = req.onerror;
    req.onsuccess = (e) => { done(); ok?.call(req, e); };
    req.onerror = (e) => { done(); bad?.call(req, e); };
  });
}

function tx<R>(db: IDBDatabase, store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> {
  return new Promise((resolve, reject) => {
    let t: IDBTransaction;
    try { t = db.transaction(store, mode); } catch (error) { reject(error); return; }
    let result: R;
    const req = run(t.objectStore(store));
    req.onsuccess = () => { result = req.result; };
    req.onerror = () => reject(req.error ?? new Error('IDB_REQUEST_FAILED'));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error ?? new Error('IDB_TX_FAILED'));
    t.onabort = () => reject(t.error ?? new Error('IDB_TX_ABORTED'));
  });
}

const liveStores = new Set<IDBDatabase>();
let generation = 0;

export async function openPendingStore<T>(factory: IDBFactory | undefined | null, userId: string): Promise<PendingStore<T>> {
  if (!factory) throw new Error('IDB_UNAVAILABLE');
  if (!userId) throw new Error('IDB_NO_USER');
  const openedGeneration = generation;
  const store = storeName(userId);
  let db = await openDb(factory, undefined, store);
  if (!db.objectStoreNames.contains(store)) {
    const next = db.version + 1;
    db.close();
    db = await openDb(factory, next, store);
  }
  const live = db;
  if(openedGeneration!==generation) { live.close(); throw new Error("IDB_SIGNED_OUT"); }
  liveStores.add(live);
  return {
    async load(sessionId, now = Date.now()) {
      const entry = await tx(live, store, 'readonly', (s) => s.get(sessionId) as IDBRequest<StoredQueue<T> | undefined>);
      if (!entry) return null;
      const ops = recoverPending(entry, userId, now);
      if (ops.length === 0) {
        await tx(live, store, 'readwrite', (s) => s.delete(sessionId)).catch(() => undefined);
        return null;
      }
      return { ...entry, operations: ops };
    },
    async save(sessionId, entry) {
      if(openedGeneration!==generation) throw new Error("IDB_SIGNED_OUT");
      if (entry.user_id !== userId) throw new Error('IDB_WRONG_USER');
      await tx(live, store, 'readwrite', (s) => s.put(entry, sessionId));
    },
    async remove(sessionId) {
      await tx(live, store, 'readwrite', (s) => s.delete(sessionId));
    },
    close() { liveStores.delete(live); live.close(); },
  };
}

/** Logout: drop every user's unsent checklist edits on this device. */
export function clearAllPending(factory: IDBFactory | undefined | null): Promise<void> {
  generation++;
  for(const db of liveStores) db.close();
  liveStores.clear();
  if (!factory) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const req = factory.deleteDatabase(OFFLINE_QUEUE.database);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      // Keep the deletion request alive: versionchange closes other tabs.
      req.onblocked = () => {};
    } catch { resolve(); }
  });
}
